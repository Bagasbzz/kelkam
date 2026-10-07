/**
 * src/lib/report/report-jobs.ts
 * -----------------------------------------------------------------------------
 * Report generation job — persistent, per-BAB (step-based).
 *
 * ARSITEKTUR:
 *   - Job disimpan di `report_jobs`, tiap section outline jadi 1 row di
 *     `report_job_steps`. Payload project (sanitized) disimpan di job.
 *   - Tidak ada worker background panjang. Setiap request (start/status)
 *     memanggil `advanceReportJob()` yang mengerjakan MAKSIMAL 1 step
 *     (1 panggilan AI) lalu return. Client polling memicu step berikutnya.
 *     Ini aman untuk hosting single-process (Passenger) dan tahan restart.
 *   - Lock anti double-run per job via Set in-memory + step.status "running"
 *     dengan deteksi stale (>STALE_STEP_MS → dianggap mati, di-retry).
 *   - Status "done" hanya saat semua step done/fallback. Result = assembleReport().
 *
 * STATE:
 *   job.status : queued → running → done | failed
 *   step.status: queued → running → done | fallback | failed
 *
 * Dipakai oleh:
 *   - POST /api/report-jobs/start         → startReportJob()
 *   - GET  /api/report-jobs/status/[jobId] → advanceReportJob()
 * -----------------------------------------------------------------------------
 */

import { prisma } from "@/lib/db/prisma";
import {
  assembleReport,
  compactProject,
  fallbackChapter,
  generateChapter,
  type ReportMode,
} from "@/lib/report/generate-report";
import { sanitizeForPersistence } from "@/lib/security/redact-secrets";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportJobStatus = "queued" | "running" | "done" | "failed";
export type ReportStepStatus = "queued" | "running" | "done" | "fallback" | "failed";

export interface ReportJobStep {
  index: number;
  title: string;
  status: ReportStepStatus;
  error?: string;
}

export interface ReportJob {
  id: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  mode: ReportMode;
  createdAt: string;
  updatedAt: string;
  result?: string;
  source?: string;
  error?: string;
  steps?: ReportJobStep[];
}

// ---------------------------------------------------------------------------
// Constants & in-memory lock
// ---------------------------------------------------------------------------

/** Step "running" tanpa update lebih lama dari ini dianggap mati → retry. */
const STALE_STEP_MS = 90_000;
/** Maks percobaan per step sebelum pakai fallback. */
const MAX_STEP_ATTEMPTS = 2;
/** Maks section yang diproses. */
const MAX_STEPS = 50;

const globalForJobs = globalThis as typeof globalThis & { __reportJobLocks?: Set<string> };
const jobLocks = globalForJobs.__reportJobLocks || new Set<string>();
globalForJobs.__reportJobLocks = jobLocks;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JobRow = NonNullable<Awaited<ReturnType<typeof readJob>>>;

async function readJob(id: string, ownerId: string) {
  return prisma.reportJob.findFirst({
    where: { id, ownerId },
    include: { steps: { orderBy: { index: "asc" } } },
  });
}

function toPublic(row: JobRow): ReportJob {
  return {
    id: row.id,
    status: row.status as ReportJobStatus,
    progress: row.progress,
    stage: row.stage,
    mode: row.mode === "ringkas" ? "ringkas" : "lengkap",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    result: row.result || undefined,
    source: row.source || undefined,
    error: row.error || undefined,
    steps: row.steps.map((step) => ({
      index: step.index,
      title: step.title,
      status: step.status as ReportStepStatus,
      error: step.error || undefined,
    })),
  };
}

function isStepFinished(status: string) {
  return status === "done" || status === "fallback";
}

/** projectId valid dan milik owner → pakai, selain itu null (kolom nullable). */
async function resolveProjectId(project: unknown, ownerId: string) {
  if (!project || typeof project !== "object") return null;
  const raw = (project as Record<string, unknown>).projectId;
  if (typeof raw !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(raw)) return null;
  const found = await prisma.project.findFirst({ where: { projectId: raw, ownerId }, select: { projectId: true } });
  return found?.projectId ?? null;
}

/** Progress 5..95 proporsional ke step selesai; 100 hanya saat finalize. */
function progressFor(done: number, total: number) {
  if (total <= 0) return 5;
  return Math.min(95, 5 + Math.round((done / total) * 90));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Baca status job tanpa memicu step. */
export async function getReportJob(id: string, ownerId: string) {
  const row = await readJob(id, ownerId);
  return row ? toPublic(row) : null;
}

/**
 * Buat job + steps dari outline. Tidak memanggil AI di sini — step pertama
 * dijalankan oleh polling status (atau panggil advanceReportJob setelah ini).
 */
export async function startReportJob(project: unknown, ownerId: string, mode: ReportMode = "lengkap") {
  const safeProject = sanitizeForPersistence(project);
  const compact = compactProject(safeProject);
  const outline = compact.outline.slice(0, MAX_STEPS);
  if (!outline.length) throw new Error("Outline kosong.");

  const id = `report_${crypto.randomUUID()}`;
  const projectId = await resolveProjectId(safeProject, ownerId);

  const row = await prisma.reportJob.create({
    data: {
      id,
      ownerId,
      projectId,
      status: "queued",
      progress: 2,
      stage: `Menyiapkan ${outline.length} bagian laporan`,
      mode,
      totalSteps: outline.length,
      payload: safeProject as object,
      steps: {
        create: outline.map((section, index) => ({
          index,
          sectionId: section.id ?? null,
          title: section.title || `Bagian ${index + 1}`,
          status: "queued",
        })),
      },
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });

  return toPublic(row);
}

/**
 * Kerjakan maksimal SATU step untuk job ini, lalu return state terbaru.
 * Idempotent: kalau job sudah selesai / sedang dikerjakan request lain,
 * hanya return state.
 */
export async function advanceReportJob(id: string, ownerId: string): Promise<ReportJob | null> {
  const row = await readJob(id, ownerId);
  if (!row) return null;
  if (row.status === "done" || row.status === "failed") return toPublic(row);
  if (jobLocks.has(id)) return toPublic(row);

  jobLocks.add(id);
  try {
    return await runNextStep(row, ownerId);
  } finally {
    jobLocks.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

async function runNextStep(row: JobRow, ownerId: string): Promise<ReportJob> {
  const now = Date.now();
  const steps = row.steps;

  // Step "running" milik proses lain yang masih hidup → tunggu.
  const liveRunning = steps.find(
    (step) => step.status === "running" && now - step.updatedAt.getTime() < STALE_STEP_MS,
  );
  if (liveRunning) return toPublic(row);

  // Kandidat: queued, running-stale (retry), atau failed yang masih punya attempt.
  const next = steps.find((step) =>
    step.status === "queued"
    || step.status === "running"
    || (step.status === "failed" && step.attempts < MAX_STEP_ATTEMPTS),
  );

  if (!next) return finalizeJob(row, ownerId);

  const project = row.payload as unknown;
  const compact = compactProject(project);
  const section = compact.outline[next.index] ?? {
    id: next.sectionId ?? undefined,
    title: next.title,
    purpose: "",
    requiredDiagrams: [],
  };
  const previousSummaries = steps
    .filter((step) => step.index < next.index && step.summary)
    .map((step) => step.summary as string);

  await prisma.$transaction([
    prisma.reportJobStep.update({
      where: { id: next.id },
      data: { status: "running", attempts: { increment: 1 }, error: null },
    }),
    prisma.reportJob.update({
      where: { id: row.id },
      data: {
        status: "running",
        stage: `Menulis ${next.title} (${next.index + 1}/${row.totalSteps})`,
        progress: progressFor(steps.filter((step) => isStepFinished(step.status)).length, row.totalSteps),
      },
    }),
  ]);

  const chapterInput = {
    index: next.index,
    total: row.totalSteps,
    section,
    previousSummaries,
    mode: (row.mode === "ringkas" ? "ringkas" : "lengkap") as ReportMode,
  };

  try {
    const chapter = await generateChapter(project, chapterInput);
    await prisma.reportJobStep.update({
      where: { id: next.id },
      data: {
        status: chapter.source === "ai" ? "done" : "fallback",
        output: chapter.content,
        summary: chapter.summary,
      },
    });
  } catch (error) {
    const attemptsUsed = next.attempts + 1;
    const message = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    console.error(`report step ${row.id}#${next.index} failed (attempt ${attemptsUsed}):`, message);

    if (attemptsUsed >= MAX_STEP_ATTEMPTS) {
      // Habis percobaan → fallback placeholder supaya laporan tetap utuh.
      const fallback = fallbackChapter(chapterInput);
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "fallback", output: fallback.content, summary: fallback.summary, error: message },
      });
    } else {
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "failed", error: message },
      });
    }
  }

  const fresh = await readJob(row.id, ownerId);
  if (!fresh) throw new Error("Job hilang saat diproses.");

  const remaining = fresh.steps.some((step) => !isStepFinished(step.status));
  if (!remaining) return finalizeJob(fresh, ownerId);

  const doneCount = fresh.steps.filter((step) => isStepFinished(step.status)).length;
  const updated = await prisma.reportJob.update({
    where: { id: fresh.id },
    data: {
      progress: progressFor(doneCount, fresh.totalSteps),
      stage: `${doneCount}/${fresh.totalSteps} bagian selesai`,
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  return toPublic(updated);
}

async function finalizeJob(row: JobRow, ownerId: string): Promise<ReportJob> {
  const chapters = row.steps
    .filter((step) => isStepFinished(step.status) && step.output)
    .sort((a, b) => a.index - b.index)
    .map((step) => step.output as string);

  if (!chapters.length) {
    const failed = await prisma.reportJob.update({
      where: { id: row.id, ownerId },
      data: {
        status: "failed",
        progress: 100,
        stage: "Generate laporan gagal",
        error: "Tidak ada bagian yang berhasil ditulis. Periksa bahan proyek lalu coba lagi.",
      },
      include: { steps: { orderBy: { index: "asc" } } },
    });
    return toPublic(failed);
  }

  const fallbackCount = row.steps.filter((step) => step.status === "fallback").length;
  const result = assembleReport(row.payload, chapters);
  const done = await prisma.reportJob.update({
    where: { id: row.id, ownerId },
    data: {
      status: "done",
      progress: 100,
      stage: fallbackCount
        ? `Laporan selesai, ${fallbackCount} bagian perlu dilengkapi lewat revisi`
        : "Laporan selesai disusun",
      result,
      source: fallbackCount ? "ai-partial" : "ai",
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  return toPublic(done);
}
