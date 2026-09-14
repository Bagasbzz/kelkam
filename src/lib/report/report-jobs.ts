/**
 * src/lib/report/report-jobs.ts
 * -----------------------------------------------------------------------------
 * Async job queue untuk Report Generation.
 *
 * ARSITEKTUR:
 *   - Setiap job punya ID `report_<uuid>`, disimpan di tabel `report_jobs`
 *     (DB) + Map di memory (untuk fast access dari polling).
 *   - Runner background di-spawn saat `startReportJob()`. Status di-update
 *     tiap stage (lihat array `stages` di bawah) → client polling liat
 *     progress real-time.
 *   - Job "queued" yang stale (worker restart) akan di-resume otomatis
 *     saat ada GET /status request (lihat ensureReportJobRunning).
 *
 * STATE TRANSITIONS:
 *
 *   queued → running → done
 *                ↘ failed
 *
 * FIELDS:
 *   - status  : ReportJobStatus
 *   - progress: 0-100
 *   - stage   : label human-readable untuk UI
 *   - result  : string draft (kalau done)
 *   - source  : "ai" | "fallback-timeout" (untuk UI indicator)
 *   - error   : string error (kalau failed)
 *
 * MEMORY MAPS (globalThis):
 *   - jobs: Map<jobId, ReportJob> — cache state in-memory
 *   - jobOwners: Map<jobId, ownerId> — ownership check
 *   - jobRunners: Set<jobId> — runner yang lagi aktif (anti double-run)
 *
 * Dipakai oleh:
 *   - POST /api/report-jobs/start → startReportJob()
 *   - GET /api/report-jobs/status/[jobId] → getReportJob() / ensureReportJobRunning()
 * -----------------------------------------------------------------------------
 */

import { prisma } from "@/lib/db/prisma";
import { generateReportDraft } from "@/lib/report/generate-report";
import { sanitizeForPersistence } from "@/lib/security/redact-secrets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// In-memory state (di-attach ke globalThis supaya konsisten di hot-reload)
// ---------------------------------------------------------------------------

const globalForJobs = globalThis as typeof globalThis & {
  __reportJobs?: Map<string, ReportJob>;
  __reportJobOwners?: Map<string, string>;
  __reportJobRunners?: Set<string>;
};

const jobs = globalForJobs.__reportJobs || new Map<string, ReportJob>();
const jobOwners = globalForJobs.__reportJobOwners || new Map<string, string>();
const jobRunners = globalForJobs.__reportJobRunners || new Set<string>();
globalForJobs.__reportJobs = jobs;
globalForJobs.__reportJobOwners = jobOwners;
globalForJobs.__reportJobRunners = jobRunners;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Kalau job stuck di status "queued"/"running" > 20 detik tanpa update,
 *  anggap stale — next polling akan resume. */
const STALE_JOB_MS = 20_000;

/** Memory entries expire setelah 6 jam (untuk pruning). */
const MEMORY_JOB_TTL_MS = 6 * 60 * 60 * 1000;

/** Hard cap jumlah memory entries. */
const MAX_MEMORY_JOBS = 100;

/**
 * Stage progress. Real AI call ada di stage ke-5 ("Menulis draft laporan").
 * Stage 1-4 fake progress supaya UI kelihatan hidup (UX trick).
 * Total: 6 stage, progress 8 → 18 → 34 → 52 → 72 → 92 → 100.
 */
const stages = [
  { progress: 8, stage: "Menyiapkan job laporan" },
  { progress: 18, stage: "Membaca konteks proyek" },
  { progress: 34, stage: "Menyusun struktur laporan" },
  { progress: 52, stage: "Menyusun tabel, diagram, dan referensi" },
  { progress: 72, stage: "Menulis draft laporan" },
  { progress: 92, stage: "Merapikan hasil akhir" },
];

// ---------------------------------------------------------------------------
// Memory pruning
// ---------------------------------------------------------------------------

/** Hapus memory entries yang expired + trim kalau overflow. */
function pruneMemoryJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const updatedAt = new Date(job.updatedAt).getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt > MEMORY_JOB_TTL_MS) {
      jobs.delete(id);
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
    jobOwners.delete(job.id);
    jobRunners.delete(job.id);
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

type RowSnapshot = {
  id: string;
  ownerId: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  createdAt: Date;
  updatedAt: Date;
  result: string | null;
  source: string | null;
  error: string | null;
  payload: unknown;
};

/** DB row → ReportJob (untuk response API). */
function fromRow(row: RowSnapshot): ReportJob {
  return {
    id: row.id,
    status: row.status,
    progress: row.progress,
    stage: row.stage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    result: row.result || undefined,
    source: row.source || undefined,
    error: row.error || undefined,
  };
}

/** Patch object → data field untuk Prisma update. */
function toPatch(patch: Partial<ReportJob>) {
  return {
    status: patch.status,
    progress: patch.progress,
    stage: patch.stage,
    updatedAt: new Date(),
    result: patch.result,
    source: patch.source,
    error: patch.error,
  };
}

// ---------------------------------------------------------------------------
// DB ops
// ---------------------------------------------------------------------------

/** Baca row dari DB. Return null kalau bukan milik owner. */
async function readJobRow(id: string, ownerId: string): Promise<RowSnapshot | null> {
  const row = await prisma.reportJob.findUnique({
    where: { id },
  });
  if (!row || row.ownerId !== ownerId) return null;
  return row as RowSnapshot;
}

/** Insert or update job row + simpan payload (project sanitized). */
async function saveJob(job: ReportJob, payload: unknown, ownerId: string) {
  try {
    await prisma.reportJob.upsert({
      where: { id: job.id },
      create: {
        id: job.id,
        ownerId,
        projectId: extractProjectId(payload),
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        result: job.result || null,
        source: job.source || null,
        error: job.error || null,
        payload: (payload as object) ?? undefined,
      },
      update: {
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        result: job.result || null,
        source: job.source || null,
        error: job.error || null,
        payload: (payload as object) ?? undefined,
      },
    });
  } catch (err) {
    console.error("report_jobs upsert failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** Update sebagian field (partial update). Update memory cache + DB. */
async function patchJob(id: string, ownerId: string, patch: Partial<ReportJob>) {
  const current = jobs.get(id);
  const updatedAt = new Date().toISOString();

  if (current && jobOwners.get(id) === ownerId) {
    jobs.set(id, { ...current, ...patch, updatedAt });
  }

  try {
    await prisma.reportJob.updateMany({
      where: { id, ownerId },
      data: toPatch({ ...patch, updatedAt } as Partial<ReportJob>) as never,
    });
  } catch (err) {
    console.error("report_jobs update failed:", err instanceof Error ? err.message : "unknown");
  }
}

/** Ambil job dari memory (kalau ada & owner match). */
function getOwnedMemoryJob(id: string, ownerId: string) {
  return jobOwners.get(id) === ownerId ? jobs.get(id) || null : null;
}

/**
 * Extract projectId dari payload (kalau ada) atau fallback ke "unscoped".
 * Dipakai untuk FK constraint di tabel `report_jobs`.
 */
function extractProjectId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "unscoped";
  const obj = payload as Record<string, unknown>;
  const id = obj.projectId || obj.project_id || obj.id;
  if (typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(id)) return id;
  return "unscoped";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ambil status job (DB → memory fallback). Return null kalau bukan milik user. */
export async function getReportJob(id: string, ownerId: string) {
  pruneMemoryJobs();
  const row = await readJobRow(id, ownerId);
  if (row) return fromRow(row);
  return getOwnedMemoryJob(id, ownerId);
}

/**
 * Pastikan job lagi running. Kalau queued tapi stale (>20s tanpa update),
 * resume runner. Dipakai untuk recovery setelah server restart.
 */
export async function ensureReportJobRunning(id: string, ownerId: string) {
  pruneMemoryJobs();
  const row = await readJobRow(id, ownerId);
  const job = row ? fromRow(row) : getOwnedMemoryJob(id, ownerId);
  if (!job || job.status === "done" || job.status === "failed") return job;
  if (jobRunners.has(id)) return job;  // Runner sudah jalan → return state.

  const payload = (row?.payload as unknown) ?? null;
  const stale = Date.now() - new Date(job.updatedAt).getTime() > STALE_JOB_MS;
  const shouldResume = job.status === "queued" || stale;

  if (!payload || !shouldResume) return job;

  await runReportJob(id, payload, ownerId);
  return getReportJob(id, ownerId);
}

/** Kick off job baru: insert DB row, spawn background runner. Return initial state. */
export async function startReportJob(project: unknown, ownerId: string) {
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
  jobOwners.set(id, ownerId);
  await saveJob(job, safeProject, ownerId);

  // Fire-and-forget: jalan di background. Client poll via /status endpoint.
  void runReportJob(id, safeProject, ownerId);
  return job;
}

/**
 * Background runner. Update progress tiap stage, panggil AI di stage 5,
 * finalize di stage akhir. Catch error → set status "failed".
 *
 * Anti double-run: pakai `jobRunners` Set.
 */
async function runReportJob(id: string, project: unknown, ownerId: string) {
  if (jobRunners.has(id)) return;
  jobRunners.add(id);

  try {
    jobOwners.set(id, ownerId);
    await patchJob(id, ownerId, {
      status: "running",
      progress: stages[0].progress,
      stage: stages[0].stage,
    });

    // Fake progress 1→4 (UX trick, supaya user tau lagi proses)
    for (const item of stages.slice(1, 4)) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await patchJob(id, ownerId, {
        progress: item.progress,
        stage: item.stage,
      });
    }

    // Real work — panggil AI.
    await patchJob(id, ownerId, {
      progress: stages[4].progress,
      stage: stages[4].stage,
    });
    const draft = await generateReportDraft(project);
    await patchJob(id, ownerId, {
      progress: stages[5].progress,
      stage: stages[5].stage,
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    await patchJob(id, ownerId, {
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
    await patchJob(id, ownerId, {
      status: "failed",
      progress: 100,
      stage: "Generate laporan gagal",
      error: "Laporan gagal dibuat. Periksa bahan proyek lalu coba lagi.",
    });
  } finally {
    jobRunners.delete(id);
  }
}