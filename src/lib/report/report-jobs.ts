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

const globalForJobs = globalThis as typeof globalThis & { __reportJobs?: Map<string, ReportJob> };
const jobs = globalForJobs.__reportJobs || new Map<string, ReportJob>();
globalForJobs.__reportJobs = jobs;

const stages = [
  { progress: 8, stage: "Menyiapkan job laporan" },
  { progress: 18, stage: "Membaca konteks proyek" },
  { progress: 34, stage: "Menyusun struktur laporan" },
  { progress: 52, stage: "Menyusun tabel, diagram, dan referensi" },
  { progress: 72, stage: "Menulis draft laporan" },
  { progress: 92, stage: "Merapikan hasil akhir" },
];

function patchJob(id: string, patch: Partial<ReportJob>) {
  const current = jobs.get(id);
  if (!current) return;
  jobs.set(id, { ...current, ...patch, updatedAt: new Date().toISOString() });
}

export function getReportJob(id: string) {
  return jobs.get(id) || null;
}

export function startReportJob(project: any) {
  const id = `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

  void runReportJob(id, project);
  return job;
}

async function runReportJob(id: string, project: any) {
  try {
    patchJob(id, { status: "running", progress: stages[0].progress, stage: stages[0].stage });

    for (const item of stages.slice(1, 4)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      patchJob(id, { progress: item.progress, stage: item.stage });
    }

    patchJob(id, { progress: stages[4].progress, stage: stages[4].stage });
    const draft = await generateReportDraft(project);
    patchJob(id, { progress: stages[5].progress, stage: stages[5].stage });

    await new Promise((resolve) => setTimeout(resolve, 250));
    patchJob(id, {
      status: "done",
      progress: 100,
      stage: draft.source === "fallback-timeout" ? "Draft cepat selesai, siap direvisi/diperpanjang" : "Laporan selesai disusun",
      result: draft.content,
      source: draft.source,
    });
  } catch (error: any) {
    patchJob(id, {
      status: "failed",
      progress: 100,
      stage: "Generate laporan gagal",
      error: error.message || "Gagal membuat laporan.",
    });
  }
}
