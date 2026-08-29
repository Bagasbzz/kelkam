import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReportDraft } from "@/lib/report/generate-report";
import { sanitizeForPersistence } from "@/lib/security/redact-secrets";
import { createUserScopedSupabase } from "@/lib/server/auth";

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
  owner_id: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  created_at: string;
  updated_at: string;
  result: string | null;
  source: string | null;
  error: string | null;
  project?: unknown;
};

const globalForJobs = globalThis as typeof globalThis & {
  __reportJobs?: Map<string, ReportJob>;
  __reportJobProjects?: Map<string, unknown>;
  __reportJobOwners?: Map<string, string>;
  __reportJobRunners?: Set<string>;
};

const jobs = globalForJobs.__reportJobs || new Map<string, ReportJob>();
const jobProjects = globalForJobs.__reportJobProjects || new Map<string, unknown>();
const jobOwners = globalForJobs.__reportJobOwners || new Map<string, string>();
const jobRunners = globalForJobs.__reportJobRunners || new Set<string>();
globalForJobs.__reportJobs = jobs;
globalForJobs.__reportJobProjects = jobProjects;
globalForJobs.__reportJobOwners = jobOwners;
globalForJobs.__reportJobRunners = jobRunners;

const STALE_JOB_MS = 20_000;
const MEMORY_JOB_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MEMORY_JOBS = 100;

const stages = [
  { progress: 8, stage: "Menyiapkan job laporan" },
  { progress: 18, stage: "Membaca konteks proyek" },
  { progress: 34, stage: "Menyusun struktur laporan" },
  { progress: 52, stage: "Menyusun tabel, diagram, dan referensi" },
  { progress: 72, stage: "Menulis draft laporan" },
  { progress: 92, stage: "Merapikan hasil akhir" },
];

function pruneMemoryJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt > MEMORY_JOB_TTL_MS) {
      jobs.delete(id);
      jobProjects.delete(id);
      jobOwners.delete(id);
      jobRunners.delete(id);
    }
  }

  if (jobs.size <= MAX_MEMORY_JOBS) return;
  const oldest = [...jobs.values()]
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(0, jobs.size - MAX_MEMORY_JOBS);
  for (const job of oldest) {
    jobs.delete(job.id);
    jobProjects.delete(job.id);
    jobOwners.delete(job.id);
    jobRunners.delete(job.id);
  }
}

function getUserClient(accessToken: string): SupabaseClient {
  return createUserScopedSupabase(accessToken);
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
  return Object.fromEntries(
    Object.entries({
      status: patch.status,
      progress: patch.progress,
      stage: patch.stage,
      updated_at: new Date().toISOString(),
      result: patch.result,
      source: patch.source,
      error: patch.error,
    }).filter(([, value]) => value !== undefined),
  );
}

async function readJobRow(id: string, ownerId: string, accessToken: string) {
  const supabase = getUserClient(accessToken);
  const { data, error } = await supabase
    .from("report_jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle<ReportJobRow>();

  if (error) console.error("report_jobs read failed:", error.code || "unknown");
  return data || null;
}

async function saveJob(
  job: ReportJob,
  project: unknown,
  ownerId: string,
  accessToken: string,
) {
  const supabase = getUserClient(accessToken);
  const { error } = await supabase.from("report_jobs").upsert({
    id: job.id,
    owner_id: ownerId,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    result: job.result || null,
    source: job.source || null,
    error: job.error || null,
    project,
  });

  if (error) console.error("report_jobs upsert failed:", error.code || "unknown");
}

async function patchJob(
  id: string,
  ownerId: string,
  accessToken: string,
  patch: Partial<ReportJob>,
) {
  const current = jobs.get(id);
  const updatedAt = new Date().toISOString();

  if (current && jobOwners.get(id) === ownerId) {
    jobs.set(id, { ...current, ...patch, updatedAt });
  }

  const supabase = getUserClient(accessToken);
  const { error } = await supabase
    .from("report_jobs")
    .update(toRowPatch(patch))
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (error) console.error("report_jobs update failed:", error.code || "unknown");
}

function getOwnedMemoryJob(id: string, ownerId: string) {
  return jobOwners.get(id) === ownerId ? jobs.get(id) || null : null;
}

export async function getReportJob(id: string, ownerId: string, accessToken: string) {
  pruneMemoryJobs();
  const row = await readJobRow(id, ownerId, accessToken);
  if (row) return fromRow(row);
  return getOwnedMemoryJob(id, ownerId);
}

export async function ensureReportJobRunning(
  id: string,
  ownerId: string,
  accessToken: string,
) {
  pruneMemoryJobs();
  const row = await readJobRow(id, ownerId, accessToken);
  const job = row ? fromRow(row) : getOwnedMemoryJob(id, ownerId);
  if (!job || job.status === "done" || job.status === "failed") return job;
  if (jobRunners.has(id)) return job;

  const project = row?.project || jobProjects.get(id);
  const stale = Date.now() - new Date(job.updatedAt).getTime() > STALE_JOB_MS;
  const shouldResume = job.status === "queued" || stale;

  if (!project || !shouldResume) return job;

  await runReportJob(id, project, ownerId, accessToken);
  return getReportJob(id, ownerId, accessToken);
}

export async function startReportJob(
  project: unknown,
  ownerId: string,
  accessToken: string,
) {
  pruneMemoryJobs();
  const safeProject = sanitizeForPersistence(project);
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
  jobProjects.set(id, safeProject);
  jobOwners.set(id, ownerId);
  await saveJob(job, safeProject, ownerId, accessToken);

  void runReportJob(id, safeProject, ownerId, accessToken);
  return job;
}

async function runReportJob(
  id: string,
  project: unknown,
  ownerId: string,
  accessToken: string,
) {
  if (jobRunners.has(id)) return;
  jobRunners.add(id);

  try {
    jobProjects.set(id, project);
    jobOwners.set(id, ownerId);
    await patchJob(id, ownerId, accessToken, {
      status: "running",
      progress: stages[0].progress,
      stage: stages[0].stage,
    });

    for (const item of stages.slice(1, 4)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await patchJob(id, ownerId, accessToken, {
        progress: item.progress,
        stage: item.stage,
      });
    }

    await patchJob(id, ownerId, accessToken, {
      progress: stages[4].progress,
      stage: stages[4].stage,
    });
    const draft = await generateReportDraft(project);
    await patchJob(id, ownerId, accessToken, {
      progress: stages[5].progress,
      stage: stages[5].stage,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await patchJob(id, ownerId, accessToken, {
      status: "done",
      progress: 100,
      stage:
        draft.source === "fallback-timeout"
          ? "Draft cepat selesai, siap direvisi/diperpanjang"
          : "Laporan selesai disusun",
      result: draft.content,
      source: draft.source,
    });
  } catch (error) {
    console.error("Report job failed:", error);
    await patchJob(id, ownerId, accessToken, {
      status: "failed",
      progress: 100,
      stage: "Generate laporan gagal",
      error: "Laporan gagal dibuat. Periksa bahan proyek lalu coba lagi.",
    });
  } finally {
    jobRunners.delete(id);
    const finalJob = jobs.get(id);
    if (finalJob?.status === "done" || finalJob?.status === "failed") {
      jobProjects.delete(id);
    }
  }
}
