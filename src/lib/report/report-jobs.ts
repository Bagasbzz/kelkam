import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateReportDraft } from "@/lib/report/generate-report";

export type ReportJobStatus = "queued" | "running" | "done" | "failed";

export interface ReportJob {
  id: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  updatedAt: string;
  result?: string;
  source?: string;
  error?: string;
}

type ReportJobRow = {
  id: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  created_at: string;
  updated_at: string;
  result: string | null;
  source: string | null;
  error: string | null;
  project?: any;
};

const globalForJobs = globalThis as typeof globalThis & {
  __reportJobs?: Map<string, ReportJob>;
  __reportJobProjects?: Map<string, any>;
  __reportJobRunners?: Set<string>;
};
const jobs = globalForJobs.__reportJobs || new Map<string, ReportJob>();
const jobProjects = globalForJobs.__reportJobProjects || new Map<string, any>();
const jobRunners = globalForJobs.__reportJobRunners || new Set<string>();
globalForJobs.__reportJobs = jobs;
globalForJobs.__reportJobProjects = jobProjects;
globalForJobs.__reportJobRunners = jobRunners;

const STALE_JOB_MS = 20_000;

const stages = [
  { progress: 8, stage: "Menyiapkan job laporan" },
  { progress: 18, stage: "Membaca konteks proyek" },
  { progress: 34, stage: "Menyusun struktur laporan" },
  { progress: 52, stage: "Menyusun tabel, diagram, dan referensi" },
  { progress: 72, stage: "Menulis draft laporan" },
  { progress: 92, stage: "Merapikan hasil akhir" },
];

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function fromRow(row: ReportJobRow): ReportJob {
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result: row.result || undefined,
    source: row.source || undefined,
    error: row.error || undefined,
  };
}

function toRowPatch(patch: Partial<ReportJob>) {
  return {
    status: patch.status,
    progress: patch.progress,
    stage: patch.stage,
    updated_at: new Date().toISOString(),
    result: patch.result,
    source: patch.source,
    error: patch.error,
  };
}

async function readJobRow(id: string) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase.from("report_jobs").select("*").eq("id", id).maybeSingle<ReportJobRow>();
  if (error) console.warn("Supabase report_jobs read skipped:", error.message);
  return data || null;
}

async function saveJob(job: ReportJob, project?: any) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase.from("report_jobs").upsert({
    id: job.id,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    result: job.result || null,
    source: job.source || null,
    error: job.error || null,
    project: project || null,
  });

  if (error) console.warn("Supabase report_jobs upsert skipped:", error.message);
}

async function patchJob(id: string, patch: Partial<ReportJob>) {
  const current = jobs.get(id);
  const updatedAt = new Date().toISOString();

  if (current) jobs.set(id, { ...current, ...patch, updatedAt });

  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const { error } = await supabase.from("report_jobs").update(toRowPatch(patch)).eq("id", id);
  if (error) console.warn("Supabase report_jobs update skipped:", error.message);
}

export async function getReportJob(id: string) {
  const row = await readJobRow(id);
  if (row) return fromRow(row);
  return jobs.get(id) || null;
}

export async function ensureReportJobRunning(id: string) {
  const row = await readJobRow(id);
  const job = row ? fromRow(row) : jobs.get(id) || null;
  if (!job || job.status === "done" || job.status === "failed") return job;
  if (jobRunners.has(id)) return job;

  const project = row?.project || jobProjects.get(id);
  const stale = Date.now() - new Date(job.updatedAt).getTime() > STALE_JOB_MS;
  const shouldResume = job.status === "queued" || stale;

  if (!project || !shouldResume) return job;

  await runReportJob(id, project);
  return getReportJob(id);
}

export async function startReportJob(project: any) {
  const id = `report_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: ReportJob = {
    id,
    status: "queued",
    progress: 2,
    stage: "Masuk antrean generate laporan",
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  jobProjects.set(id, project);
  await saveJob(job, project);

  void runReportJob(id, project);
  return job;
}

async function runReportJob(id: string, project: any) {
  if (jobRunners.has(id)) return;
  jobRunners.add(id);

  try {
    jobProjects.set(id, project);
    await patchJob(id, { status: "running", progress: stages[0].progress, stage: stages[0].stage });

    for (const item of stages.slice(1, 4)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await patchJob(id, { progress: item.progress, stage: item.stage });
    }

    await patchJob(id, { progress: stages[4].progress, stage: stages[4].stage });
    const draft = await generateReportDraft(project);
    await patchJob(id, { progress: stages[5].progress, stage: stages[5].stage });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await patchJob(id, {
      status: "done",
      progress: 100,
      stage: draft.source === "fallback-timeout" ? "Draft cepat selesai, siap direvisi/diperpanjang" : "Laporan selesai disusun",
      result: draft.content,
      source: draft.source,
    });
  } catch (error: any) {
    await patchJob(id, {
      status: "failed",
      progress: 100,
      stage: "Generate laporan gagal",
      error: error.message || "Gagal membuat laporan.",
    });
  } finally {
    jobRunners.delete(id);
  }
}
