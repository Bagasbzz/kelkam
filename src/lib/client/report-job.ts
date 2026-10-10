/**
 * src/lib/client/report-job.ts
 * -----------------------------------------------------------------------------
 * Client-side runner untuk report job: start → poll (tiap poll mengerjakan
 * 1 BAB di server) → selesai. Menyimpan jobId di localStorage per mode supaya
 * setelah refresh/tab tertutup job bisa dilanjutkan, bukan mulai dari awal.
 * -----------------------------------------------------------------------------
 */

import { authenticatedFetch } from "@/components/AuthProvider";

export type ReportJobMode = "ringkas" | "lengkap";

export interface ReportJobEvent { t: string; level: "info" | "warn" | "error"; msg: string }
export interface ReportJobStep {
  index: number;
  title: string;
  status: "queued" | "running" | "done" | "fallback" | "failed";
  attempts: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  tokensUsed: number;
  words: number;
}
export interface ReportJob {
  id: string;
  title: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  stage: string;
  mode: ReportJobMode;
  createdAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  idleSeconds: number;
  needsResume: boolean;
  totalSteps: number;
  doneSteps: number;
  tokensUsed: number;
  result?: string;
  source?: string;
  error?: string;
  steps: ReportJobStep[];
  log: ReportJobEvent[];
}

interface JobPayload { success?: boolean; error?: string; job?: ReportJob; active?: ReportJob | null }

const KEY = (mode: ReportJobMode) => `report_job_active_${mode}`;

export function rememberJob(mode: ReportJobMode, jobId: string | null) {
  try {
    if (jobId) localStorage.setItem(KEY(mode), jobId);
    else localStorage.removeItem(KEY(mode));
  } catch { /* storage penuh/privat — abaikan */ }
}

export function rememberedJobId(mode: ReportJobMode) {
  try { return localStorage.getItem(KEY(mode)); } catch { return null; }
}

async function readJob(response: Response, fallback: string): Promise<ReportJob> {
  let payload: JobPayload | null = null;
  try { payload = (await response.json()) as JobPayload; } catch { payload = null; }
  if (!response.ok || !payload?.success || !payload.job) throw new Error(payload?.error || fallback);
  return payload.job;
}

export async function startJob(project: unknown, mode: ReportJobMode) {
  const response = await authenticatedFetch("/api/report-jobs/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project, mode }),
  });
  const job = await readJob(response, "Gagal memulai job laporan.");
  rememberJob(mode, job.id);
  return job;
}

/** Baca state tanpa memicu step. */
export async function peekJob(jobId: string) {
  const response = await authenticatedFetch(`/api/report-jobs/status/${jobId}?peek=1`, { cache: "no-store" });
  return readJob(response, "Gagal membaca status job.");
}

/** Satu poll = server kerjakan maks 1 BAB. */
export async function advanceJob(jobId: string) {
  const response = await authenticatedFetch(`/api/report-jobs/status/${jobId}`, { cache: "no-store" });
  return readJob(response, "Gagal membaca progres job.");
}

export async function jobAction(jobId: string, action: "cancel" | "retry", redoFallback = false) {
  const response = await authenticatedFetch(`/api/report-jobs/status/${jobId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, redoFallback }),
  });
  return readJob(response, "Gagal memproses aksi job.");
}

/** Job aktif terakhir di server (kalau localStorage hilang). */
export async function findActiveJob(mode: ReportJobMode) {
  const response = await authenticatedFetch(`/api/report-jobs?mode=${mode}&limit=1`, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => null)) as JobPayload | null;
  return payload?.active ?? null;
}

export interface RunOptions {
  onUpdate: (job: ReportJob) => void;
  signal?: AbortSignal;
  /** Jeda antar poll (ms). */
  intervalMs?: number;
  /** Batas poll — 900 × 1s = 15 menit idle sebelum menyerah (bukan batas kerja). */
  maxPolls?: number;
}

/**
 * Poll sampai job selesai. Kalau request gagal sementara (network), coba lagi
 * dengan backoff ringan; setelah 5 kegagalan beruntun → throw supaya UI
 * menampilkan tombol "Lanjutkan".
 */
export async function runJobUntilDone(jobId: string, opts: RunOptions): Promise<ReportJob> {
  const interval = opts.intervalMs ?? 1500;
  const maxPolls = opts.maxPolls ?? 2400;
  let consecutiveErrors = 0;

  for (let i = 0; i < maxPolls; i += 1) {
    if (opts.signal?.aborted) throw new Error("Dihentikan.");
    try {
      const job = await advanceJob(jobId);
      consecutiveErrors = 0;
      opts.onUpdate(job);
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled") return job;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 8) throw error;
      // Backoff lebih panjang saat server membatasi permintaan (429).
      const limited = error instanceof Error && /terlalu banyak/i.test(error.message);
      await new Promise((resolve) => setTimeout(resolve, (limited ? 5000 : 1500) * consecutiveErrors));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Polling berhenti karena terlalu lama. Klik \"Lanjutkan\" untuk meneruskan dari bagian terakhir.");
}
