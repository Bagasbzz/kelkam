/**
 * src/lib/report/report-jobs.ts
 * -----------------------------------------------------------------------------
 * Report generation job — persistent, per-BAB (step-based), resumable.
 *
 * ARSITEKTUR:
 *   - Job disimpan di `report_jobs`, tiap section outline jadi 1 row di
 *     `report_job_steps`. Payload project (sanitized) disimpan di job.
 *   - Tidak ada worker terpisah. `advanceReportJob()` MEMULAI maksimal 1 step
 *     di background proses Node (tidak menunggu selesai) lalu langsung return
 *     state. Polling berikutnya hanya membaca state sampai step selesai, lalu
 *     memicu step berikutnya. Jadi satu step boleh > batas waktu request HTTP
 *     (proxy ~120 s). Cron (`/api/report-jobs/tick`) jadi pemicu cadangan saat
 *     tab ditutup atau proses restart.
 *   - Lock anti double-run per job via Map in-memory + step.status "running"
 *     dengan heartbeat per potongan teks; step tanpa heartbeat > STALE_STEP_MS
 *     dianggap mati dan di-retry. Teks parsial disimpan di step.output supaya
 *     percobaan berikutnya MELANJUTKAN, bukan menulis ulang.
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
  auditChapter,
  CHAPTER_STEP_BUDGET_MS,
  ChapterTimeoutError,
  compactProject,
  fallbackChapter,
  generateChapter,
  type ReportMode,
} from "@/lib/report/generate-report";
import { generateUmlForReport, isUmlDiagramType } from "@/lib/uml/pipeline";
import { diagramToSvg, summarizeDiagram } from "@/lib/uml/render-svg";
import { generateConceptForReport, isConceptDiagramType } from "@/lib/uml/render-concept";
import { startImageJob, listImageJobs } from "@/lib/server/image-jobs";
import { sanitizeForPersistence } from "@/lib/security/redact-secrets";

// ---------------------------------------------------------------------------
// Jenis step. Disimpan lewat prefix `sectionId` supaya tidak perlu kolom baru:
//   "diagram:<id>" → buat diagram UML via engine UML Builder (sebelum bab)
//   "<sectionId>"  → tulis satu bab
//   "audit:<idx>"  → audit & perbaiki bab pada step index <idx> (setelah semua bab)
// ---------------------------------------------------------------------------

export type ReportStepKind = "diagram" | "chapter" | "audit";

const DIAGRAM_PREFIX = "diagram:";
const AUDIT_PREFIX = "audit:";

export function stepKind(sectionId: string | null | undefined): ReportStepKind {
  if (sectionId?.startsWith(DIAGRAM_PREFIX)) return "diagram";
  if (sectionId?.startsWith(AUDIT_PREFIX)) return "audit";
  return "chapter";
}

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
  kind: ReportStepKind;
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
  /** Jam server saat respons dibuat — UI pakai untuk hitung durasi tanpa tergantung jam klien. */
  serverNow: string;
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

/** Step "running" tanpa heartbeat lebih lama dari ini dianggap mati → retry. Heartbeat diperbarui tiap potongan teks. */
export const STALE_STEP_MS = 120_000;
/** Maks percobaan per step sebelum pakai fallback. */
const MAX_STEP_ATTEMPTS = 4;
/** Maks section yang diproses. */
const MAX_STEPS = 80;
/** Entri log terakhir yang disimpan. */
const LOG_LIMIT = 120;
/** Job lebih tua dari ini tidak dilanjutkan oleh tick. */
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

const globalForJobs = globalThis as typeof globalThis & { __reportJobLocks?: Map<string, number> };
/** jobId → epoch ms saat lock diambil. */
const jobLocks = globalForJobs.__reportJobLocks || new Map<string, number>();
globalForJobs.__reportJobLocks = jobLocks;

/** Lock lebih tua dari ini dianggap milik proses yang hang → boleh diambil alih. */
const LOCK_STALE_MS = CHAPTER_STEP_BUDGET_MS + 60_000;
/** Batas keras satu step; lebih dari ini lock dilepas walau promise lama masih jalan. */
const STEP_HARD_TIMEOUT_MS = CHAPTER_STEP_BUDGET_MS + 30_000;

function acquireLock(id: string, now = Date.now()) {
  const held = jobLocks.get(id);
  if (held !== undefined && now - held < LOCK_STALE_MS) return false;
  jobLocks.set(id, now);
  return true;
}

function releaseLock(id: string, token: number) {
  if (jobLocks.get(id) === token) jobLocks.delete(id);
}

async function withHardTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(label)), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

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
    serverNow: new Date(now).toISOString(),
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
      kind: stepKind(step.sectionId),
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
  // Daftar pustaka dirakit otomatis dari sitasi (assembleReport); jangan jadi step AI (hasilnya dobel/ngarang).
  const isBibliography = (title: string) => /^(daftar\s+pustaka|referensi|references|bibliography)$/i.test(title.trim());
  const outline = compact.outline.filter((section) => !isBibliography(section.title)).slice(0, MAX_STEPS);
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

  // Semua diagram terencana jadi step SEBELUM bab, supaya penulis bab sudah tahu isinya:
  // UML (flowchart/usecase/activity/sequence) → engine UML Builder;
  // non-UML (arsitektur/ERD/kelas/peta konsep) → renderer vektor konsep.
  const plannedDiagrams = compact.diagrams.filter((diagram) => !diagram.approved && diagram.title && (isUmlDiagramType(diagram.type) || isConceptDiagramType(diagram.type)));
  const umlCount = plannedDiagrams.filter((diagram) => isUmlDiagramType(diagram.type)).length;
  const skipped = compact.diagrams.length - plannedDiagrams.length;
  if (skipped > 0) {
    log.push({ t: new Date().toISOString(), level: "info", msg: `${skipped} diagram sudah approved/tipe tak dikenal → tidak dibuat ulang` });
  }
  // Ilustrasi (gambar AI) dijalankan paralel di background; tidak memblokir bab.
  const illustrations = compact.figures.filter((figure) => figure.prompt && !figure.done);
  if (illustrations.length) {
    const sessionId = isRecord(safeProject) && typeof safeProject.reportSessionId === "string" ? safeProject.reportSessionId : undefined;
    let started = 0;
    for (const figure of illustrations) {
      try {
        await startImageJob({ ownerId, prompt: `${figure.prompt}\n\nStyle: clean technical illustration for an academic report, white background, flat vector look, high contrast, minimal text, no watermark.`, title: figure.title, sessionId });
        started += 1;
      } catch (error) {
        log.push({ t: new Date().toISOString(), level: "warn", msg: `Ilustrasi "${figure.title}" tidak dimulai: ${error instanceof Error ? error.message.slice(0, 120) : "gagal"}` });
      }
    }
    if (started) log.push({ t: new Date().toISOString(), level: "info", msg: `${started} ilustrasi dibuat di background (±2 menit/gambar)` });
  }
  const withAudit = mode === "lengkap";

  type StepSeed = { sectionId: string | null; title: string };
  const seeds: StepSeed[] = [
    ...plannedDiagrams.map((diagram, i) => ({ sectionId: `${DIAGRAM_PREFIX}${diagram.id || `diagram-${i + 1}`}`, title: `Diagram: ${diagram.title}` })),
    ...outline.map((section, index) => ({ sectionId: section.id ?? `section-${index + 1}`, title: section.title || `Bagian ${index + 1}` })),
  ];
  if (withAudit) {
    const chapterStart = plannedDiagrams.length;
    outline.forEach((section, index) => {
      seeds.push({ sectionId: `${AUDIT_PREFIX}${chapterStart + index}`, title: `Audit: ${section.title || `Bagian ${index + 1}`}` });
    });
  }
  log.push({ t: new Date().toISOString(), level: "info", msg: `Rencana kerja: ${umlCount} diagram UML + ${plannedDiagrams.length - umlCount} diagram konsep → ${outline.length} bab → ${withAudit ? `${outline.length} audit` : "tanpa audit (mode ringkas)"}` });

  const row = await prisma.reportJob.create({
    data: {
      id,
      ownerId,
      projectId,
      title,
      status: "queued",
      progress: 2,
      stage: `Menyiapkan ${seeds.length} langkah laporan`,
      mode,
      totalSteps: seeds.length,
      payload: safeProject as object,
      log: log as unknown as Prisma.InputJsonValue,
      heartbeatAt: new Date(),
      steps: {
        create: seeds.map((seed, index) => ({
          index,
          sectionId: seed.sectionId,
          title: seed.title,
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
 * Mulai maksimal SATU step untuk job ini di background, lalu return state
 * terbaru TANPA menunggu step selesai. Idempotent: kalau job sudah selesai /
 * step lain sedang hidup / lock dipegang, hanya return state.
 */
export async function advanceReportJob(id: string, ownerId: string): Promise<ReportJob | null> {
  const row = await readJob(id, ownerId);
  if (!row) return null;
  if (isJobFinished(row.status)) return toPublic(row);
  if (hasLiveStep(row)) return toPublic(row);
  const token = Date.now();
  if (!acquireLock(id, token)) return toPublic(row);

  // Jalankan di background: request poll tidak menunggu, jadi tidak kena batas proxy.
  void withHardTimeout(runNextStep(row, ownerId), STEP_HARD_TIMEOUT_MS, "Langkah melebihi batas waktu server")
    .catch((error) => console.error(`advance job ${id}:`, error instanceof Error ? error.message : error))
    .finally(() => releaseLock(id, token));

  // Beri waktu singkat agar transisi "running" tercatat sebelum state dibaca.
  await new Promise((resolve) => setTimeout(resolve, 400));
  const fresh = await readJob(id, ownerId);
  return fresh ? toPublic(fresh) : null;
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
    if (hasLiveStep(row, now)) continue;
    const token = Date.now();
    if (!acquireLock(row.id, token)) continue;
    // Tick juga tidak menunggu: hanya memicu step di background.
    void withHardTimeout(runNextStep(row, row.ownerId), STEP_HARD_TIMEOUT_MS, "Langkah melebihi batas waktu server")
      .catch((error) => console.error(`tick job ${row.id}:`, error instanceof Error ? error.message : error))
      .finally(() => releaseLock(row.id, token));
    processed.push({ id: row.id, status: row.status, stage: row.stage });
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

  const kind = stepKind(next.sectionId);
  const project = row.payload as unknown;
  const compact = compactProject(project);
  // Bab dicari berdasarkan sectionId (index step tidak lagi = index outline karena ada step diagram).
  const outlineIndex = compact.outline.findIndex((section, i) => (section.id ?? `section-${i + 1}`) === next.sectionId);
  const section = compact.outline[outlineIndex] ?? {
    id: next.sectionId ?? undefined,
    title: next.title,
    purpose: "",
    requiredDiagrams: [],
  };
  const chapterSteps = steps.filter((step) => stepKind(step.sectionId) === "chapter");
  const chapterPosition = Math.max(0, chapterSteps.findIndex((step) => step.id === next.id));
  const previousSummaries = chapterSteps
    .filter((step) => step.index < next.index && step.summary)
    .map((step) => step.summary as string);

  const attemptNo = next.attempts + 1;
  const doneBefore = steps.filter((step) => isStepFinished(step.status)).length;
  const wasStale = next.status === "running";

  if (wasStale) {
    log.push({ t: new Date().toISOString(), level: "warn", msg: `Langkah ${next.index + 1} terdeteksi macet (>${Math.round(STALE_STEP_MS / 1000)}s), diulang` });
  }

  const verb = kind === "diagram" ? "Membuat" : kind === "audit" ? "Mengaudit" : "Menulis";
  await prisma.$transaction([
    prisma.reportJobStep.update({
      where: { id: next.id },
      data: { status: "running", attempts: { increment: 1 }, error: null, startedAt: new Date(), finishedAt: null },
    }),
    prisma.reportJob.update({
      where: { id: row.id },
      data: {
        status: "running",
        stage: `${verb} ${next.title.replace(/^(Diagram|Audit):\s*/, "")} (${next.index + 1}/${row.totalSteps})`,
        progress: progressFor(doneBefore, row.totalSteps),
        heartbeatAt: new Date(),
      },
    }),
  ]);
  await appendLog(row.id, log, "info", `Mulai langkah ${next.index + 1}/${row.totalSteps}: ${next.title}${attemptNo > 1 ? ` (percobaan ${attemptNo})` : ""}`);

  // Event dari generator dibuffer lalu ditulis berurutan agar hemat query,
  // tapi heartbeat tetap diperbarui supaya UI tahu proses hidup.
  let pendingWrite: Promise<unknown> = Promise.resolve();
  const onEvent = (message: string) => {
    pendingWrite = pendingWrite.then(() => appendLog(row.id, log, "info", `  ${message}`)).catch(() => undefined);
  };
  // Teks parsial disimpan berkala: heartbeat step + bisa dilanjutkan kalau proses mati.
  let lastPartialSave = 0;
  let latestPartial = "";
  const savePartial = async (text: string) => {
    await prisma.$transaction([
      prisma.reportJobStep.update({ where: { id: next.id }, data: { output: text } }),
      prisma.reportJob.update({ where: { id: row.id }, data: { heartbeatAt: new Date(), stage: `${verb} ${next.title.replace(/^(Diagram|Audit):\s*/, "")} (${next.index + 1}/${row.totalSteps}) · ${countWords(text)} kata` } }),
    ]);
  };
  const onPartial = (text: string) => {
    latestPartial = text;
    const now = Date.now();
    if (now - lastPartialSave < 8_000) return;
    lastPartialSave = now;
    pendingWrite = pendingWrite.then(() => savePartial(text)).catch(() => undefined);
  };

  const mode = (row.mode === "ringkas" ? "ringkas" : "lengkap") as ReportMode;
  // Percobaan ulang bab melanjutkan teks parsial percobaan sebelumnya (bukan placeholder fallback).
  const previousPartial = kind === "chapter" && attemptNo > 1 && next.output && !/respons AI gagal/.test(next.output) ? next.output : undefined;
  const chapterInput = {
    index: chapterPosition,
    total: chapterSteps.length || 1,
    section,
    previousSummaries,
    mode,
    onEvent,
    onPartial,
    partial: previousPartial,
  };

  const stepStarted = Date.now();
  try {
    if (kind === "diagram") {
      await runDiagramStep(row, next, project, onEvent);
    } else if (kind === "audit") {
      await runAuditStep(row, next, steps, project, mode, onEvent);
    } else {
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
          ? `Selesai bab: ${countWords(chapter.content)} kata, ${chapter.tokensUsed ?? 0} token, ${seconds}s`
          : `Bab "${next.title}" dipakai placeholder (output tidak memadai), ${seconds}s`,
      );
    }
    await pendingWrite;
  } catch (error) {
    await pendingWrite;
    const message = error instanceof Error ? error.message.slice(0, 300) : "unknown";
    console.error(`report step ${row.id}#${next.index} failed (attempt ${attemptNo}):`, message);
    // Teks parsial terbaik yang kita punya untuk dilanjutkan percobaan berikutnya.
    const partial = error instanceof ChapterTimeoutError && error.partial.length > (latestPartial?.length ?? 0)
      ? error.partial
      : latestPartial || previousPartial || null;

    if (kind !== "chapter") {
      // Diagram/audit tidak boleh menggagalkan laporan: tandai fallback, lanjut.
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "fallback", error: message, finishedAt: new Date() },
      });
      await appendLog(row.id, log, "warn", `${next.title} gagal (${message}) → dilewati`);
    } else if (attemptNo >= MAX_STEP_ATTEMPTS) {
      // Habis percobaan: pakai teks parsial kalau cukup panjang, kalau tidak placeholder.
      const usable = partial && countWords(partial) >= 250;
      const fallback = fallbackChapter(chapterInput, project);
      const content = usable ? `${partial.trimEnd()}\n\n[LANJUTAN ${next.title.toUpperCase()}: bagian ini belum selesai, gunakan fitur revisi untuk melengkapi]` : fallback.content;
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "fallback", output: content, summary: usable ? countWords(partial) + " kata (belum lengkap)" : fallback.summary, error: message, finishedAt: new Date() },
      });
      await appendLog(row.id, log, "error", `Bab "${next.title}" gagal ${MAX_STEP_ATTEMPTS}x (${message}) → ${usable ? "memakai teks yang sudah ada" : "placeholder"}, bisa dilengkapi lewat revisi`);
    } else {
      await prisma.reportJobStep.update({
        where: { id: next.id },
        data: { status: "failed", error: message, output: partial },
      });
      await appendLog(row.id, log, "warn", `Bab "${next.title}" terhenti (${message})${partial ? `, ${countWords(partial)} kata tersimpan` : ""} → akan dilanjutkan`);
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
      stage: `${doneCount}/${fresh.totalSteps} langkah selesai`,
      heartbeatAt: new Date(),
    },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  return toPublic(updated);
}

// ---------------------------------------------------------------------------
// Step: diagram UML (engine UML Builder) → disimpan ke payload.diagrams[i]
// ---------------------------------------------------------------------------

/** Diagram hasil engine yang disimpan di payload job & disalin ke rencana sesi. */
export interface ReportDiagramArtifact {
  id: string;
  title: string;
  type: string;
  purpose: string;
  sectionId?: string;
  status: "approved" | "planned" | "failed";
  caption: string;
  /** Data siap render DiagramCanvas / diagramToSvg. */
  diagramData?: { nodes: unknown[]; edges: unknown[]; meta: { title: string; lanes: string[]; diagramType: string } };
  /** SVG string hasil render server (dipakai dashboard untuk preview + rasterisasi PNG saat ekspor). */
  svg?: string;
  flowSummary?: string;
  error?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function payloadDiagrams(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.diagrams)) return [];
  return payload.diagrams.filter(isRecord);
}

/** Ambil artefak diagram yang sudah jadi dari payload job (untuk sesi/dashboard). */
export function extractDiagramArtifacts(payload: unknown): ReportDiagramArtifact[] {
  return payloadDiagrams(payload)
    .filter((diagram) => diagram.status === "approved" && isRecord(diagram.diagramData))
    .map((diagram) => ({
      id: String(diagram.id || ""),
      title: String(diagram.title || ""),
      type: String(diagram.type || "flowchart"),
      purpose: String(diagram.purpose || ""),
      sectionId: typeof diagram.sectionId === "string" ? diagram.sectionId : undefined,
      status: "approved",
      caption: String(diagram.caption || diagram.title || ""),
      diagramData: diagram.diagramData as ReportDiagramArtifact["diagramData"],
      svg: typeof diagram.svg === "string" ? diagram.svg : undefined,
      flowSummary: typeof diagram.flowSummary === "string" ? diagram.flowSummary : undefined,
    }));
}

async function runDiagramStep(
  row: JobRow,
  step: JobRow["steps"][number],
  project: unknown,
  emit: (message: string) => void,
) {
  const diagramId = (step.sectionId || "").slice(DIAGRAM_PREFIX.length);
  const diagrams = payloadDiagrams(row.payload);
  const target = diagrams.find((diagram) => diagram.id === diagramId);
  if (!target) throw new Error(`Diagram ${diagramId} tidak ada di payload`);
  const diagramType = String(target.type || "");
  const compact = compactProject(project);
  const sectionTitle = compact.outline.find((section) => section.id && section.id === target.sectionId)?.title;
  const reportContext = {
    reportTitle: compact.title,
    topic: compact.topic,
    projectType: compact.projectType,
    section: sectionTitle,
    materials: compact.sources.slice(0, 4).map((source) => `${source.title}: ${source.content.slice(0, 500)}`),
  };
  const stepStarted = step.startedAt?.getTime() ?? Date.now();

  const persistFailure = async (error: string) => {
    const updatedDiagrams = diagrams.map((diagram) => (diagram.id === diagramId ? { ...diagram, status: "failed", error } : diagram));
    await prisma.reportJob.update({
      where: { id: row.id },
      data: { payload: { ...(row.payload as Record<string, unknown>), diagrams: updatedDiagrams } as Prisma.InputJsonValue },
    });
    await prisma.reportJobStep.update({
      where: { id: step.id },
      data: { status: "fallback", error: error.slice(0, 300), finishedAt: new Date() },
    });
    emit(`Diagram "${target.title}" tidak jadi dibuat: ${error} → bab menjelaskan secara naratif tanpa gambar`);
  };
  const persistArtifact = async (artifact: ReportDiagramArtifact, summary: string, output: Record<string, unknown>, doneMsg: string) => {
    const updatedDiagrams = diagrams.map((diagram) => (diagram.id === diagramId ? { ...diagram, ...artifact } : diagram));
    await prisma.reportJob.update({
      where: { id: row.id },
      data: { payload: { ...(row.payload as Record<string, unknown>), diagrams: updatedDiagrams } as Prisma.InputJsonValue },
    });
    await prisma.reportJobStep.update({
      where: { id: step.id },
      data: { status: "done", output: JSON.stringify(output), summary: summary.slice(0, 400), finishedAt: new Date() },
    });
    emit(doneMsg);
  };

  // Non-UML (arsitektur/ERD/kelas/peta konsep) → renderer vektor konsep.
  if (!isUmlDiagramType(diagramType)) {
    if (!isConceptDiagramType(diagramType)) throw new Error(`Tipe ${diagramType} tidak dikenal`);
    const result = await generateConceptForReport({
      diagramType,
      title: String(target.title || diagramId),
      purpose: String(target.purpose || target.caption || ""),
      reportContext,
      budgetMs: 70_000,
      onStatus: emit,
    });
    if (!result.ok || !result.spec || !result.svg) { await persistFailure(result.error || "gagal"); return; }
    const artifact: ReportDiagramArtifact = {
      id: diagramId,
      title: String(target.title || result.spec.title),
      type: diagramType,
      purpose: String(target.purpose || ""),
      sectionId: typeof target.sectionId === "string" ? target.sectionId : undefined,
      status: "approved",
      caption: String(target.caption || target.title || ""),
      // Diagram konsep tidak bisa dibuka di UML Builder (bukan nodes/edges) → diagramData berisi spec agar status approved terbaca.
      diagramData: { nodes: [], edges: [], meta: { title: result.spec.title, lanes: [], diagramType }, concept: result.spec } as ReportDiagramArtifact["diagramData"],
      svg: result.svg,
      flowSummary: result.summary,
    };
    await persistArtifact(artifact, result.summary || "", { id: diagramId, groups: result.spec.groups.length, relations: result.spec.relations.length },
      `Diagram "${artifact.title}" selesai: ${result.spec.groups.length} komponen, ${result.spec.relations.length} relasi, ${Math.round((Date.now() - stepStarted) / 1000)}s`);
    return;
  }

  const result = await generateUmlForReport({
    diagramType,
    title: String(target.title || diagramId),
    purpose: String(target.purpose || target.caption || ""),
    reportContext,
    budgetMs: 80_000,
    onStatus: emit,
  });

  if (!result.ok || !result.data) { await persistFailure(result.error || "gagal"); return; }

  const data = result.data;
  const svg = diagramToSvg({ nodes: data.nodes, edges: data.edges, lanes: data.lanes, title: data.title });
  const flowSummary = summarizeDiagram({ nodes: data.nodes, edges: data.edges, lanes: data.lanes });
  const artifact: ReportDiagramArtifact = {
    id: diagramId,
    title: String(target.title || data.title),
    type: diagramType,
    purpose: String(target.purpose || ""),
    sectionId: typeof target.sectionId === "string" ? target.sectionId : undefined,
    status: "approved",
    caption: String(target.caption || target.title || ""),
    diagramData: { nodes: data.nodes, edges: data.edges, meta: data.meta },
    svg,
    flowSummary,
  };
  await persistArtifact(artifact, flowSummary, { id: diagramId, nodes: data.nodes.length, edges: data.edges.length, warnings: result.warnings },
    `Diagram "${artifact.title}" selesai: ${data.nodes.length} elemen, ${data.edges.length} relasi${result.warnings.length ? `, ${result.warnings.length} peringatan` : ""}, ${Math.round((Date.now() - stepStarted) / 1000)}s`);
}

// ---------------------------------------------------------------------------
// Step: audit satu bab (pass kedua) → output step audit = versi final bab
// ---------------------------------------------------------------------------

async function runAuditStep(
  row: JobRow,
  step: JobRow["steps"][number],
  steps: JobRow["steps"],
  project: unknown,
  mode: ReportMode,
  emit: (message: string) => void,
) {
  const targetIndex = Number((step.sectionId || "").slice(AUDIT_PREFIX.length));
  const target = steps.find((item) => item.index === targetIndex);
  if (!target || !target.output) {
    await prisma.reportJobStep.update({ where: { id: step.id }, data: { status: "fallback", error: "bab belum ada", finishedAt: new Date() } });
    emit("Bab target audit tidak punya output, dilewati");
    return;
  }
  if (target.status === "fallback") {
    await prisma.reportJobStep.update({ where: { id: step.id }, data: { status: "fallback", error: "bab placeholder", finishedAt: new Date() } });
    emit("Bab target masih placeholder, audit dilewati");
    return;
  }
  const chapterSteps = steps.filter((item) => stepKind(item.sectionId) === "chapter");
  const position = Math.max(0, chapterSteps.findIndex((item) => item.id === target.id));
  const result = await auditChapter(project, {
    content: target.output,
    sectionTitle: target.title,
    index: position,
    total: chapterSteps.length || 1,
    mode,
    onEvent: emit,
  });
  await prisma.reportJobStep.update({
    where: { id: step.id },
    data: {
      status: result.changed ? "done" : "fallback",
      output: result.changed ? result.content : null,
      summary: result.issues.join("; ").slice(0, 400) || null,
      tokensUsed: result.tokensUsed,
      error: result.changed ? null : "tidak ada perubahan",
      finishedAt: new Date(),
    },
  });
}

/**
 * Placeholder `[Gambar: Judul - caption]` yang tidak punya sumber gambar (diagram
 * tidak dibuat / ilustrasi gagal) diganti catatan eksplisit agar tidak lolos
 * diam-diam ke DOCX. Ilustrasi yang masih diproses dibiarkan (eksport akan
 * mengambilnya bila sudah jadi).
 */
async function annotateMissingFigures(markdown: string, payload: unknown, ownerId: string) {
  const available = new Set<string>();
  for (const diagram of payloadDiagrams(payload)) {
    if (diagram.status === "approved" && typeof diagram.svg === "string") available.add(String(diagram.title || "").trim().toLowerCase());
  }
  const sessionId = isRecord(payload) && typeof payload.reportSessionId === "string" ? payload.reportSessionId : undefined;
  const pending = new Set<string>();
  if (sessionId) {
    const jobs = await listImageJobs(ownerId, { sessionId, limit: 40 }).catch(() => []);
    for (const job of jobs) {
      const key = (job.title || "").trim().toLowerCase();
      if (!key) continue;
      if (job.status === "done") available.add(key);
      else if (job.status !== "failed") pending.add(key);
    }
  }
  const missing: string[] = [];
  const result = markdown.replace(/^\[Gambar:\s*(.+?)\]\s*$/gim, (line, inner: string) => {
    const title = inner.split(" - ")[0].trim();
    const key = title.toLowerCase();
    if (available.has(key) || pending.has(key)) return line;
    missing.push(title);
    return `> **Catatan gambar:** "${title}" belum tersedia (diagram/ilustrasi gagal dibuat). Minta lewat chat untuk membuat ulang, atau sisipkan gambar manual.`;
  });
  return { result, missing };
}

async function finalizeJob(row: JobRow, ownerId: string, log: ReportJobEvent[]): Promise<ReportJob> {
  // Bab final = output audit (bila ada & berhasil) atau output bab.
  const auditByTarget = new Map<number, string>();
  for (const step of row.steps) {
    if (stepKind(step.sectionId) === "audit" && step.status === "done" && step.output) {
      auditByTarget.set(Number((step.sectionId || "").slice(AUDIT_PREFIX.length)), step.output);
    }
  }
  const chapterSteps = row.steps
    .filter((step) => stepKind(step.sectionId) === "chapter")
    .sort((a, b) => a.index - b.index);
  const chapters = chapterSteps
    .filter((step) => isStepFinished(step.status) && step.output)
    .map((step) => auditByTarget.get(step.index) ?? (step.output as string));

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

  const fallbackCount = chapterSteps.filter((step) => step.status === "fallback").length;
  const diagramsDone = extractDiagramArtifacts(row.payload).length;
  const auditedCount = auditByTarget.size;
  const assembled = assembleReport(row.payload, chapters);
  // Placeholder gambar yang tidak punya sumber (diagram gagal / ilustrasi belum jadi) tidak boleh lolos diam-diam.
  const { result, missing } = await annotateMissingFigures(assembled, row.payload, ownerId);
  const totalWords = countWords(result);
  const totalTokens = row.steps.reduce((acc, step) => acc + step.tokensUsed, 0);
  if (missing.length) {
    await appendLog(row.id, log, "warn", `${missing.length} gambar tidak tersedia & diberi catatan di laporan: ${missing.slice(0, 4).join("; ")}${missing.length > 4 ? "; …" : ""}`);
  }
  await appendLog(
    row.id,
    log,
    fallbackCount ? "warn" : "info",
    `Laporan dirakit: ${chapters.length} bab, ${diagramsDone} diagram, ${auditedCount} bab diaudit, ±${totalWords} kata, ${totalTokens} token${fallbackCount ? `, ${fallbackCount} bab placeholder` : ""}`,
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
