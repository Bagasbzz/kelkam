/**
 * src/lib/report/report-jobs.ts
 * -----------------------------------------------------------------------------
 * Report generation job — persistent, per-BAB (step-based), resumable.
 *
 * ARSITEKTUR:
 *   - Job disimpan di `report_jobs`, tiap section outline jadi 1 row di
 *     `report_job_steps`. Payload project (sanitized) disimpan di job.
 *   - Tidak ada worker background panjang. Setiap request (status/tick)
 *     memanggil `advanceReportJob()` yang mengerjakan MAKSIMAL 1 step
 *     (1 panggilan AI) lalu return. Client polling ATAU cron eksternal
 *     (`/api/report-jobs/tick`) memicu step berikutnya. Aman untuk hosting
 *     single-process (Passenger) dan tahan restart: progres per BAB di DB.
 *   - Lock anti double-run per job via Set in-memory + step.status "running"
 *     dengan deteksi stale (>STALE_STEP_MS → dianggap mati, di-retry).
 *   - Event log detail disimpan di `job.log` (dipangkas LOG_LIMIT entri)
 *     supaya user melihat apa yang sedang dikerjakan, bukan sekadar spinner.
 *   - `heartbeatAt` = kapan server terakhir menyentuh job. UI pakai ini untuk
 *     memberi tahu user kalau proses macet dan perlu "Lanjutkan".
 *
 * STATE:
 *   job.status : queued → running → done | failed | cancelled
 *   step.status: queued → running → done | fallback | failed
 * -----------------------------------------------------------------------------
 */

import { Prisma } from "@prisma/client";
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

export type ReportJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ReportStepStatus = "queued" | "running" | "done" | "fallback" | "failed";

export interface ReportJobEvent {
  /** ISO timestamp */
  t: string;
  level: "info" | "warn" | "error";
  msg: string;
}

export interface ReportJobStep {
  index: number;
  title: string;
  status: ReportStepStatus;
  attempts: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  tokensUsed: number;
  /** Jumlah kata output (0 kalau belum ada). */
  words: number;
}

export interface ReportJob {
  id: string;
  title: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  mode: ReportMode;
  createdAt: string;
  updatedAt: string;
  heartbeatAt?: string;
  /** Detik sejak heartbeat terakhir — UI pakai untuk deteksi macet. */
  idleSeconds: number;
  /** true kalau job belum selesai dan tidak ada step yang sedang hidup. */
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

export interface ReportJobSummary {
  id: string;
  title: string;
  status: ReportJobStatus;
  progress: number;
  stage: string;
  mode: ReportMode;
  createdAt: string;
  updatedAt: string;
  totalSteps: number;
  doneSteps: number;
  needsResume: boolean;
}

// ---------------------------------------------------------------------------
// Constants & in-memory lock
// ---------------------------------------------------------------------------

/** Step "running" tanpa update lebih lama dari ini dianggap mati → retry. */
export const STALE_STEP_MS = 90_000;
/** Maks percobaan per step sebelum pakai fallback. */
const MAX_STEP_ATTEMPTS = 3;
/** Maks section yang diproses. */
const MAX_STEPS = 80;
/** Entri log terakhir yang disimpan. */
const LOG_LIMIT = 120;
/** Job lebih tua dari ini tidak dilanjutkan oleh tick. */
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

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

function parseLog(raw: unknown): ReportJobEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ReportJobEvent => (
    typeof item === "object" && item !== null && typeof (item as ReportJobEvent).msg === "string"
  ));
}

function countWords(text: string | null) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function isStepFinished(status: string) {
  return status === "done" || status === "fallback";
}

function isJobFinished(status: string) {
  return status === "done" || status === "failed" || status === "cancelled";
}

function hasLiveStep(row: JobRow, now = Date.now()) {
  return row.steps.some((step) => step.status === "running" && now - step.updatedAt.getTime() < STALE_STEP_MS);
}

function toPublic(row: JobRow): ReportJob {
  const now = Date.now();
  const heartbeat = row.heartbeatAt ?? row.updatedAt;
  const doneSteps = row.steps.filter((step) => isStepFinished(step.status)).length;
  const finished = isJobFinished(row.status);
  return {
    id: row.id,
    title: row.title,
    status: row.status as ReportJobStatus,
    progress: row.progress,
    stage: row.stage,
    mode: row.mode === "ringkas" ? "ringkas" : "lengkap",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    heartbeatAt: heartbeat.toISOString(),
    idleSeconds: Math.max(0, Math.round((now - heartbeat.getTime()) / 1000)),
    needsResume: !finished && !hasLiveStep(row, now),
    totalSteps: row.totalSteps,
    doneSteps,
    tokensUsed: row.steps.reduce((acc, step) => acc + step.tokensUsed, 0),
    result: row.result || undefined,
    source: row.source || undefined,
    error: row.error || undefined,
    steps: row.steps.map((step) => ({
      index: step.index,
      title: step.title,
      status: step.status as ReportStepStatus,
      attempts: step.attempts,
      error: step.error || undefined,
      startedAt: step.startedAt?.toISOString(),
      finishedAt: step.finishedAt?.toISOString(),
      tokensUsed: step.tokensUsed,
      words: countWords(step.output),
    })),
    log: parseLog(row.log),
  };
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

/**
 * Tambah event ke log job + update heartbeat. Dipanggil sering; log dipangkas
 * di memori lalu ditulis ulang (ukuran kecil, < 20 KB).
 */
async function appendLog(jobId: string, current: ReportJobEvent[], level: ReportJobEvent["level"], msg: string, extra?: Prisma.ReportJobUpdateInput) {
  const event: ReportJobEvent = { t: new Date().toISOString(), level, msg: msg.slice(0, 400) };
  current.push(event);
  if (current.length > LOG_LIMIT) current.splice(0, current.length - LOG_LIMIT);
  await prisma.reportJob.update({
    where: { id: jobId },
    data: { ...extra, log: current as unknown as Prisma.InputJsonValue, heartbeatAt: new Date() },
  });
  return event;
}

// ---------------------------------------------------------------------------
// Public API — read / list
// ---------------------------------------------------------------------------

/** Baca status job tanpa memicu step. */
export async function getReportJob(id: string, ownerId: string) {
  const row = await readJob(id, ownerId);
  return row ? toPublic(row) : null;
}

/** Daftar job milik user (terbaru dulu), tanpa result/log untuk hemat payload. */
export async function listReportJobs(ownerId: string, limit = 20): Promise<ReportJobSummary[]> {
  const rows = await prisma.reportJob.findMany({
    where: { ownerId },
    orderBy: { createdAt: "desc" },
    take: Math.min(50, Math.max(1, limit)),
    include: { steps: { select: { status: true, updatedAt: true } } },
  });
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status as ReportJobStatus,
    progress: row.progress,
    stage: row.stage,
    mode: row.mode === "ringkas" ? "ringkas" : "lengkap",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    totalSteps: row.totalSteps,
    doneSteps: row.steps.filter((step) => isStepFinished(step.status)).length,
    needsResume: !isJobFinished(row.status)
      && !row.steps.some((step) => step.status === "running" && now - step.updatedAt.getTime() < STALE_STEP_MS),
  }));
}

/** Job aktif terakhir milik user (untuk auto-resume di UI). */
export async function findActiveReportJob(ownerId: string, mode?: ReportMode) {
  const row = await prisma.reportJob.findFirst({
    where: {
      ownerId,
      status: { in: ["queued", "running"] },
      ...(mode ? { mode } : {}),
      createdAt: { gte: new Date(Date.now() - JOB_TTL_MS) },
    },
    orderBy: { createdAt: "desc" },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  return row ? toPublic(row) : null;
}

// ---------------------------------------------------------------------------
// Public API — mutations
// ---------------------------------------------------------------------------

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
  const title = (compact.title || compact.topic || "Laporan").slice(0, 160);
  const sourceCount = Array.isArray((safeProject as Record<string, unknown>)?.sources)
    ? ((safeProject as Record<string, unknown>).sources as unknown[]).length
    : 0;

  const log: ReportJobEvent[] = [
    { t: new Date().toISOString(), level: "info", msg: `Job dibuat: ${outline.length} bagian, mode ${mode}, ${sourceCount} sumber, ${compact.references.length} referensi, ${compact.diagrams.length} diagram` },
  ];

  const row = await prisma.reportJob.create({
    data: {
      id,
      ownerId,
      projectId,
      title,
      status: "queued",
      progress: 2,
      stage: `Menyiapkan ${outline.length} bagian laporan`,
      mode,
      totalSteps: outline.length,
      payload: safeProject as object,
      log: log as unknown as Prisma.InputJsonValue,
      heartbeatAt: new Date(),
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

/** Batalkan job yang belum selesai. */
export async function cancelReportJob(id: string, ownerId: string) {
  const row = await readJob(id, ownerId);
  if (!row) return null;
  if (isJobFinished(row.status)) return toPublic(row);
  const log = parseLog(row.log);
  await appendLog(id, log, "warn", "Job dibatalkan oleh pengguna", {
    status: "cancelled",
    stage: "Dibatalkan",
    error: "Dibatalkan oleh pengguna.",
  });
  const fresh = await readJob(id, ownerId);
  return fresh ? toPublic(fresh) : null;
}

/**
 * Buka kembali job yang failed/cancelled, atau reset step fallback/failed
 * agar dicoba ulang. Output BAB yang sudah "done" DIPERTAHANKAN.
 */
export async function retryReportJob(id: string, ownerId: string, opts: { redoFallback?: boolean } = {}) {
  const row = await readJob(id, ownerId);
  if (!row) return null;
  const log = parseLog(row.log);

  const resetStatuses = opts.redoFallback ? ["failed", "fallback"] : ["failed"];
  const reset = await prisma.reportJobStep.updateMany({
    where: { jobId: id, status: { in: resetStatuses } },
    data: { status: "queued", attempts: 0, error: null },
  });

  const stillTodo = await prisma.reportJobStep.count({ where: { jobId: id, status: { in: ["queued", "running", "failed"] } } });
  await appendLog(id, log, "info", `Dilanjutkan: ${reset.count} bagian diulang, ${stillTodo} bagian tersisa`, {
    status: stillTodo ? "running" : "queued",
    error: null,
    result: null,
    stage: "Melanjutkan pekerjaan",
  });
  const fresh = await readJob(id, ownerId);
  return fresh ? toPublic(fresh) : null;
}

/**
 * Kerjakan maksimal SATU step untuk job ini, lalu return state terbaru.
 * Idempotent: kalau job sudah selesai / sedang dikerjakan request lain,
 * hanya return state.
 */
export async function advanceReportJob(id: string, ownerId: string): Promise<ReportJob | null> {
  const row = await readJob(id, ownerId);
  if (!row) return null;
  if (isJobFinished(row.status)) return toPublic(row);
  if (jobLocks.has(id)) return toPublic(row);

  jobLocks.add(id);
  try {
    return await runNextStep(row, ownerId);
  } finally {
    jobLocks.delete(id);
  }
}

/**
 * Dipanggil cron eksternal: lanjutkan job-job aktif yang tidak sedang di-poll
 * (stale > STALE_STEP_MS), maksimal `limit` job per panggilan. Tiap job hanya
 * 1 step. Supaya laporan tetap jalan walau tab user ditutup.
 */
export async function tickReportJobs(limit = 2) {
  const now = Date.now();
  const candidates = await prisma.reportJob.findMany({
    where: {
      status: { in: ["queued", "running"] },
      createdAt: { gte: new Date(now - JOB_TTL_MS) },
    },
    orderBy: { updatedAt: "asc" },
    take: 20,
    include: { steps: { orderBy: { index: "asc" } } },
  });

  const processed: Array<{ id: string; status: string; stage: string }> = [];
  for (const row of candidates) {
    if (processed.length >= limit) break;
    if (jobLocks.has(row.id) || hasLiveStep(row, now)) continue;
    jobLocks.add(row.id);
    try {
      const result = await runNextStep(row, row.ownerId);
      processed.push({ id: row.id, status: result.status, stage: result.stage });
    } catch (error) {
      console.error(`tick job ${row.id}:`, error instanceof Error ? error.message : error);
    } finally {
      jobLocks.delete(row.id);
    }
  }
  return { scanned: candidates.length, processed };
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

async function runNextStep(row: JobRow, ownerId: string): Promise<ReportJob> {
  const now = Date.now();
  const steps = row.steps;
  const log = parseLog(row.log);

  // Step "running" milik proses lain yang masih hidup → tunggu.
  if (hasLiveStep(row, now)) return toPublic(row);

  // Kandidat: queued, running-stale (retry), atau failed yang masih punya attempt.
  const next = steps.find((step) =>
    step.status === "queued"
    || step.status === "running"
    || (step.status === "failed" && step.attempts < MAX_STEP_ATTEMPTS),
  );

  if (!next) return finalizeJob(row, ownerId, log);

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

  const attemptNo = next.attempts + 1;
  const doneBefore = steps.filter((step) => isStepFinished(step.status)).length;
  const wasStale = next.status === "running";

  if (wasStale) {
    log.push({ t: new Date().toISOString(), level: "warn", msg: `Bagian ${next.index + 1} terdeteksi macet (>${Math.round(STALE_STEP_MS / 1000)}s), diulang` });
  }

  await prisma.$transaction([
    prisma.reportJobStep.update({
      where: { id: next.id },
      data: { status: "running", attempts: { increment: 1 }, error: null, startedAt: new Date(), finishedAt: null },
    }),
    prisma.reportJob.update({
      where: { id: row.id },
      data: {
        status: "running",
        stage: `Menulis ${next.title} (${next.index + 1}/${row.totalSteps})`,
        progress: progressFor(doneBefore, row.totalSteps),
      },
    }),
  ]);
  await appendLog(row.id, log, "info", `Mulai bagian ${next.index + 1}/${row.totalSteps}: ${next.title}${attemptNo > 1 ? ` (percobaan ${attemptNo})` : ""}`);

  // Event dari generateChapter dibuffer lalu ditulis sekali agar hemat query,
  // tapi heartbeat tetap diperbarui supaya UI tahu proses hidup.
  let pendingWrite: Promise<unknown> = Promise.resolve();
  const onEvent = (message: string) => {
    pendingWrite = pendingWrite.then(() => appendLog(row.id, log, "info", `  ${message}`)).catch(() => undefined);
  };

  const chapterInput = {
    index: next.index,
    total: row.totalSteps,
    section,
    previousSummaries,
    mode: (row.mode === "ringkas" ? "ringkas" : "lengkap") as ReportMode,
    onEvent,
  };

  const stepStarted = Date.now();
  try {
    const chapter = await generateChapter(project, chapterInput);
    await pendingWrite;
    const seconds = Math.round((Date.now() - stepStarted) / 1000);
    await prisma.reportJobStep.update({
      where: { id: next.id },
      data: {
        status: chapter.source === "ai" ? "done" : "fallback",
        output: chapter.content,
        summary: chapter.summary,
        finishedAt: new Date(),
        tokensUsed: chapter.tokensUsed ?? 0,
      },
    });
    await appendLog(
      row.id,
      log,
      chapter.source === "ai" ? "info" : "warn",
      chapter.source === "ai"
        ? `Selesai bagian ${next.index + 1}: ${countWords(chapter.content)} kata, ${chapter.tokensUsed ?? 0} token, ${seconds}s`
        : `Bagian ${next.index + 1} dipakai placeholder (output tidak memadai), ${seconds}s`,
    );
  } catch (error) {
    await pendingWrite;
    const message = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    console.error(`report step ${row.id}#${next.index} failed (attempt ${attemptNo}):`, message);

    if (attemptNo >= MAX_STEP_ATTEMPTS) {
      // Habis percobaan → fallback placeholder supaya laporan tetap utuh.
      const fallback = fallbackChapter(chapterInput);
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "fallback", output: fallback.content, summary: fallback.summary, error: message, finishedAt: new Date() },
      });
      await appendLog(row.id, log, "error", `Bagian ${next.index + 1} gagal ${MAX_STEP_ATTEMPTS}x (${message}) → placeholder, bisa diisi lewat revisi`);
    } else {
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "failed", error: message },
      });
      await appendLog(row.id, log, "warn", `Bagian ${next.index + 1} gagal (${message}), akan diulang`);
    }
  }

  const fresh = await readJob(row.id, ownerId);
  if (!fresh) throw new Error("Job hilang saat diproses.");

  const remaining = fresh.steps.some((step) => !isStepFinished(step.status));
  if (!remaining) return finalizeJob(fresh, ownerId, parseLog(fresh.log));

  const doneCount = fresh.steps.filter((step) => isStepFinished(step.status)).length;
  const updated = await prisma.reportJob.update({
    where: { id: fresh.id },
    data: {
      progress: progressFor(doneCount, fresh.totalSteps),
      stage: `${doneCount}/${fresh.totalSteps} bagian selesai`,
      heartbeatAt: new Date(),
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  return toPublic(updated);
}

async function finalizeJob(row: JobRow, ownerId: string, log: ReportJobEvent[]): Promise<ReportJob> {
  const chapters = row.steps
    .filter((step) => isStepFinished(step.status) && step.output)
    .sort((a, b) => a.index - b.index)
    .map((step) => step.output as string);

  if (!chapters.length) {
    await appendLog(row.id, log, "error", "Tidak ada bagian yang berhasil ditulis", {
      status: "failed",
      progress: 100,
      stage: "Generate laporan gagal",
      error: "Tidak ada bagian yang berhasil ditulis. Periksa bahan proyek lalu coba lagi.",
    });
    const failed = await readJob(row.id, ownerId);
    return toPublic(failed as JobRow);
  }

  const fallbackCount = row.steps.filter((step) => step.status === "fallback").length;
  const result = assembleReport(row.payload, chapters);
  const totalWords = countWords(result);
  const totalTokens = row.steps.reduce((acc, step) => acc + step.tokensUsed, 0);
  await appendLog(
    row.id,
    log,
    fallbackCount ? "warn" : "info",
    `Laporan dirakit: ${chapters.length} bagian, ±${totalWords} kata, ${totalTokens} token${fallbackCount ? `, ${fallbackCount} bagian placeholder` : ""}`,
    {
      status: "done",
      progress: 100,
      stage: fallbackCount
        ? `Laporan selesai, ${fallbackCount} bagian perlu dilengkapi lewat revisi`
        : "Laporan selesai disusun",
      result,
      source: fallbackCount ? "ai-partial" : "ai",
      error: null,
    },
  );
  const done = await readJob(row.id, ownerId);
  return toPublic(done as JobRow);
}
