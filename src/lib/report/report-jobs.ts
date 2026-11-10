/**
 * src/lib/report/report-jobs.ts
 * -----------------------------------------------------------------------------
 * Report generation job, persistent, per-BAB (step-based), resumable.
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
import { sanitizePublicErrorText, toPublicErrorMessage } from "@/lib/errors";
import { stripDashes } from "@/lib/ai/client";
import { figurePlaceholders, normalizeFigureKey, reconcileFigurePlaceholders } from "@/lib/report/figure-placeholders";
import { AiBudgetError, runWithAiOwner } from "@/lib/server/ai-budget";
import { blocksApproval, checkReportLocally, fixInstructions, MAX_FIX_ROUNDS, parseVerdict, reviewReport, type ReviewChapter, type ReviewSeverity } from "@/lib/report/final-review";

// ---------------------------------------------------------------------------
// Jenis step. Disimpan lewat prefix `sectionId` supaya tidak perlu kolom baru:
//   "diagram:<id>"       → buat diagram UML via engine UML Builder (sebelum bab)
//   "<sectionId>"        → tulis satu bab
//   "audit:<idx>"        → audit & perbaiki bab pada step index <idx> (setelah semua bab)
//   "review:<round>"     → audit akhir dokumen utuh oleh AI auditor (gerbang mutu)
//   "fix:<round>:<idx>"  → perbaiki bab <idx> sesuai temuan review putaran <round>
// Step review/fix ditambahkan dinamis: review menolak → fix per bab + review ulang.
// ---------------------------------------------------------------------------

export type ReportStepKind = "diagram" | "chapter" | "audit" | "review" | "fix";

const DIAGRAM_PREFIX = "diagram:";
const AUDIT_PREFIX = "audit:";
const REVIEW_PREFIX = "review:";
const FIX_PREFIX = "fix:";

export function stepKind(sectionId: string | null | undefined): ReportStepKind {
  if (sectionId?.startsWith(DIAGRAM_PREFIX)) return "diagram";
  if (sectionId?.startsWith(AUDIT_PREFIX)) return "audit";
  if (sectionId?.startsWith(REVIEW_PREFIX)) return "review";
  if (sectionId?.startsWith(FIX_PREFIX)) return "fix";
  return "chapter";
}

function reviewRound(sectionId: string | null | undefined) {
  return Number((sectionId || "").slice(REVIEW_PREFIX.length)) || 1;
}

function parseFixId(sectionId: string | null | undefined) {
  const [round, target] = (sectionId || "").slice(FIX_PREFIX.length).split(":").map(Number);
  return { round: round || 1, target: Number.isFinite(target) ? target : -1 };
}

/** Step gerbang mutu dibatasi strukturnya sendiri, tidak memakan batas langkah/percobaan penulisan. */
function isQualityGateStep(sectionId: string | null | undefined) {
  const kind = stepKind(sectionId);
  return kind === "review" || kind === "fix";
}

function countedAttempts(steps: Array<{ sectionId: string | null; attempts: number }>) {
  return steps.filter((step) => !isQualityGateStep(step.sectionId)).reduce((sum, step) => sum + step.attempts, 0);
}

function countedSteps(steps: Array<{ sectionId: string | null }>) {
  return steps.filter((step) => !isQualityGateStep(step.sectionId)).length;
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
  /** Jam server saat respons dibuat, UI pakai untuk hitung durasi tanpa tergantung jam klien. */
  serverNow: string;
  /** Detik sejak heartbeat terakhir, UI pakai untuk deteksi macet. */
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
  /** Hasil gerbang mutu (audit akhir). Tidak ada untuk job lama / sitasi saja. */
  review?: ReportReviewSummary;
}

export interface ReportReviewSummary {
  /** berjalan = audit belum selesai; lulus = disetujui auditor; catatan = dikirim dengan masalah tersisa (K17). */
  status: "berjalan" | "lulus" | "catatan";
  /** Jumlah audit yang sudah selesai. */
  rounds: number;
  /** Jumlah perbaikan bab yang berhasil diterapkan. */
  fixes: number;
  summary: string;
  aiUnavailable: boolean;
  remaining: Array<{ chapter: string | null; severity: ReviewSeverity; problem: string }>;
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
const MAX_STEPS = 20;
const MAX_TOTAL_STEPS = 60;
const MAX_TOTAL_ATTEMPTS = 120;
/** Entri log terakhir yang disimpan. */
const LOG_LIMIT = 120;
/** Job lebih tua dari ini tidak dilanjutkan oleh tick. */
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;

const globalForJobs = globalThis as typeof globalThis & { __reportJobLocks?: Map<string, number> };
/** jobId → epoch ms saat lock diambil. */
const jobLocks = globalForJobs.__reportJobLocks || new Map<string, number>();
globalForJobs.__reportJobLocks = jobLocks;
const controllers = new Map<string, AbortController>();

/** Lock lebih tua dari ini dianggap milik proses yang hang → boleh diambil alih. */
const LOCK_STALE_MS = CHAPTER_STEP_BUDGET_MS + 60_000;
/** Abort transport at the deadline; retain the local lock until work settles. */
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

async function executeStep(row: JobRow, ownerId: string): Promise<ReportJob> {
  const controller = new AbortController();
  controllers.set(row.id, controller);
  const timer = setTimeout(() => controller.abort(new Error("Batas waktu langkah laporan tercapai.")), STEP_HARD_TIMEOUT_MS);
  try { return await runWithAiOwner(ownerId, "report-step", () => runNextStep(row, ownerId, controller), controller.signal); }
  finally { clearTimeout(timer); if (controllers.get(row.id) === controller) controllers.delete(row.id); }
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
  )).map((event) => ({ ...event, msg: sanitizePublicErrorText(event.msg) }));
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

function hasLiveStep(row: { steps: Array<{ status: string; updatedAt: Date }> }, now = Date.now()) {
  return row.steps.some((step) => step.status === "running" && now - step.updatedAt.getTime() < STALE_STEP_MS);
}

function toPublic(row: JobRow): ReportJob {
  const now = Date.now();
  const heartbeat = row.heartbeatAt ?? row.updatedAt;
  const doneSteps = row.steps.filter((step) => isStepFinished(step.status)).length;
  const finished = isJobFinished(row.status);
  const review = reviewSummaryOf(row.steps);
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
    error: row.error ? toPublicErrorMessage(row.error) : undefined,
    steps: row.steps.map((step) => ({
      index: step.index,
      title: step.title,
      kind: stepKind(step.sectionId),
      status: step.status as ReportStepStatus,
      attempts: step.attempts,
      error: step.error ? toPublicErrorMessage(step.error) : undefined,
      startedAt: step.startedAt?.toISOString(),
      finishedAt: step.finishedAt?.toISOString(),
      tokensUsed: step.tokensUsed,
      // Output step review berupa JSON vonis, bukan teks laporan.
      words: stepKind(step.sectionId) === "review" ? 0 : countWords(step.output),
    })),
    log: parseLog(row.log),
    ...(review ? { review } : {}),
  };
}

/** Ringkasan gerbang mutu dari step review/fix. */
function reviewSummaryOf(steps: Array<{ sectionId: string | null; status: string; output: string | null }>): ReportReviewSummary | undefined {
  const reviews = steps.filter((step) => stepKind(step.sectionId) === "review").sort((a, b) => reviewRound(a.sectionId) - reviewRound(b.sectionId));
  if (!reviews.length) return undefined;
  const finishedReviews = reviews.filter((step) => isStepFinished(step.status));
  const fixes = steps.filter((step) => stepKind(step.sectionId) === "fix" && step.status === "done" && step.output).length;
  const pending = reviews.some((step) => !isStepFinished(step.status)) || steps.some((step) => stepKind(step.sectionId) === "fix" && !isStepFinished(step.status));
  const last = finishedReviews.at(-1);
  if (pending || !last) return { status: "berjalan", rounds: finishedReviews.length, fixes, summary: "", aiUnavailable: false, remaining: [] };
  const verdict = parseVerdict(last.output);
  if (!verdict) return { status: "catatan", rounds: finishedReviews.length, fixes, summary: "Audit akhir tidak dapat dijalankan; hasil belum diperiksa auditor.", aiUnavailable: true, remaining: [] };
  const remaining = verdict.issues.filter(blocksApproval).map((issue) => ({ chapter: issue.chapter, severity: issue.severity, problem: issue.problem }));
  return {
    status: verdict.verdict === "lulus" && !verdict.aiUnavailable ? "lulus" : "catatan",
    rounds: finishedReviews.length,
    fixes,
    summary: verdict.summary,
    aiUnavailable: verdict.aiUnavailable,
    remaining,
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
  const event: ReportJobEvent = { t: new Date().toISOString(), level, msg: sanitizePublicErrorText(msg).slice(0, 400) };
  current.push(event);
  if (current.length > LOG_LIMIT) current.splice(0, current.length - LOG_LIMIT);
  await prisma.reportJob.updateMany({
    where: { id: jobId, status: { in: ["queued", "running"] } },
    data: { ...extra, log: current as unknown as Prisma.InputJsonValue, heartbeatAt: new Date() } as Prisma.ReportJobUpdateManyMutationInput,
  });
  return event;
}

// ---------------------------------------------------------------------------
// Public API, read / list
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
// Public API, mutations
// ---------------------------------------------------------------------------

async function expireAbandonedJobs(tx: Prisma.TransactionClient) {
  const now = Date.now();
  await tx.reportJob.updateMany({
    where: {
      status: { in: ["queued", "running"] },
      createdAt: { lt: new Date(now - JOB_TTL_MS) },
      steps: { none: { status: "running", updatedAt: { gte: new Date(now - STALE_STEP_MS) } } },
    },
    data: { status: "failed", stage: "Kedaluwarsa", error: "Job kedaluwarsa. Buat laporan baru untuk melanjutkan." },
  });
}

/**
 * Buat job + steps dari outline. Tidak memanggil AI di sini, step pertama
 * dijalankan oleh polling status (atau panggil advanceReportJob setelah ini).
 */
export async function startReportJob(project: unknown, ownerId: string, mode: ReportMode = "lengkap") {
  let safeProject = sanitizeForPersistence(project);
  const compact = compactProject(safeProject);
  const deterministic = compact.intent.outputMode === "citations_only";
  if (!deterministic && isRecord(safeProject) && Array.isArray(safeProject.outline) && safeProject.outline.length > MAX_STEPS) throw new Error("Maksimal 20 bagian outline per laporan.");
  // Daftar pustaka dirakit otomatis dari sitasi (assembleReport); jangan jadi step AI (hasilnya dobel/ngarang).
  const isBibliography = (title: string) => /^(daftar\s+pustaka|referensi|references|bibliography)$/i.test(title.trim());
  const outline = compact.outline.filter((section) => !isBibliography(section.title)).slice(0, MAX_STEPS);
  if (!outline.length && !deterministic) throw new Error("Outline kosong.");
  safeProject = { ...(isRecord(safeProject) ? safeProject : {}), intent: compact.intent, outline };

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
  const withAudit = mode === "lengkap" && !deterministic;

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
  // Gerbang mutu (K17–K20): audit akhir dokumen utuh di semua mode; perbaikan + audit ulang ditambahkan dinamis.
  if (!deterministic) seeds.push({ sectionId: `${REVIEW_PREFIX}1`, title: "Audit akhir dokumen" });
  log.push({ t: new Date().toISOString(), level: "info", msg: `Rencana kerja: ${umlCount} diagram UML + ${plannedDiagrams.length - umlCount} diagram konsep → ${outline.length} bab → ${withAudit ? `${outline.length} audit bab` : "tanpa audit per bab (mode ringkas)"} → audit akhir (maks. ${MAX_FIX_ROUNDS} putaran perbaikan)` });

  if (countedSteps(seeds) > MAX_TOTAL_STEPS || illustrations.length > 3) throw new Error("Rencana laporan terlalu besar: maksimal 60 langkah dan 3 ilustrasi.");
  const row = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-report-admission'))`;
    await expireAbandonedJobs(tx);
    const active = { status: { in: ["queued", "running"] } };
    if (await tx.reportJob.count({ where: { ...active, ownerId } }) >= 2 || await tx.reportJob.count({ where: active }) >= 10) throw new Error("Antrean laporan penuh. Selesaikan atau batalkan job aktif terlebih dahulu.");
    return tx.reportJob.create({
    data: {
      id,
      ownerId,
      projectId,
      title,
      status: deterministic ? "done" : "queued",
      progress: deterministic ? 100 : 2,
      stage: deterministic ? "Sitasi terpilih selesai dirakit tanpa penulisan AI" : `Menyiapkan ${seeds.length} langkah laporan`,
      ...(deterministic ? { result: assembleReport(safeProject, []), source: "deterministic" } : {}),
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
  });

  // Admission must succeed before creating any paid child work.
  const sessionId = isRecord(safeProject) && typeof safeProject.reportSessionId === "string" ? safeProject.reportSessionId : undefined;
  for (const figure of illustrations) {
    try {
      await startImageJob({ ownerId, prompt: `${figure.prompt}\n\nStyle: clean technical illustration for an academic report, white background, flat vector look, high contrast, minimal text, no watermark.`, title: figure.title, sessionId });
    } catch (error) {
      await appendLog(id, log, "warn", `Ilustrasi "${figure.title}" tidak dimulai: ${toPublicErrorMessage(error, "gagal")}`);
    }
  }

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
  controllers.get(id)?.abort(new Error("Job dibatalkan oleh pengguna."));
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
  if (row.createdAt.getTime() < Date.now() - JOB_TTL_MS) throw new AiBudgetError("Job kedaluwarsa. Buat laporan baru untuk melanjutkan.");
  if (countedAttempts(row.steps) >= MAX_TOTAL_ATTEMPTS) throw new AiBudgetError("Batas percobaan laporan tercapai.");
  if (["failed", "cancelled", "done"].includes(row.status)) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ai-report-admission'))`;
      await expireAbandonedJobs(tx);
      const active = { status: { in: ["queued", "running"] } };
      if (await tx.reportJob.count({ where: { ...active, ownerId, id: { not: id } } }) >= 2 || await tx.reportJob.count({ where: { ...active, id: { not: id } } }) >= 10) throw new Error("Antrean laporan penuh.");
      await tx.reportJob.updateMany({ where: { id, ownerId, status: row.status }, data: { status: "queued" } });
    });
  }
  const log = parseLog(row.log);

  const resetStatuses = opts.redoFallback ? ["failed", "fallback"] : ["failed"];
  const reset = await prisma.reportJobStep.updateMany({
    where: { jobId: id, status: { in: resetStatuses }, attempts: { lt: MAX_STEP_ATTEMPTS } },
    data: { status: "queued", error: null },
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
  void executeStep(row, ownerId)
    .catch((error) => console.error(`advance job ${id}:`, sanitizePublicErrorText(error instanceof Error ? error.message : String(error))))
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
    void executeStep(row, row.ownerId)
      .catch((error) => console.error(`tick job ${row.id}:`, sanitizePublicErrorText(error instanceof Error ? error.message : String(error))))
      .finally(() => releaseLock(row.id, token));
    processed.push({ id: row.id, status: row.status, stage: row.stage });
  }
  return { scanned: candidates.length, processed };
}

// ---------------------------------------------------------------------------
// Step runner
// ---------------------------------------------------------------------------

async function runNextStep(row: JobRow, ownerId: string, controller: AbortController): Promise<ReportJob> {
  const now = Date.now();
  const steps = row.steps;
  const log = parseLog(row.log);

  // Step "running" milik proses lain yang masih hidup → tunggu.
  if (hasLiveStep(row, now)) return toPublic(row);
  if (countedSteps(steps) > MAX_TOTAL_STEPS || countedAttempts(steps) >= MAX_TOTAL_ATTEMPTS) {
    await appendLog(row.id, log, "error", "Batas langkah atau percobaan laporan tercapai.", { status: "failed", error: "Batas pemrosesan laporan tercapai." });
    return toPublic((await readJob(row.id, ownerId))!);
  }

  // Kandidat: queued, running-stale (retry), atau failed yang masih punya attempt.
  const next = steps.find((step) =>
    ["queued", "running", "failed"].includes(step.status) && step.attempts < MAX_STEP_ATTEMPTS,
  );

  if (!next) {
    if (steps.some((step) => !isStepFinished(step.status))) {
      await appendLog(row.id, log, "error", "Batas percobaan langkah tercapai.", { status: "failed", error: "Batas percobaan langkah tercapai." });
      return toPublic((await readJob(row.id, ownerId))!);
    }
    return finalizeJob(row, ownerId, log);
  }

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

  const verb = kind === "diagram" ? "Membuat" : kind === "audit" ? "Mengaudit" : kind === "fix" ? "Memperbaiki" : "Menulis";
  const stageLabel = kind === "review" ? next.title : `${verb} ${next.title.replace(/^(Diagram|Audit|Perbaikan):\s*/, "")}`;
  const claimTime = new Date();
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM report_jobs WHERE id = ${row.id} FOR UPDATE`;
    const current = await tx.reportJob.findFirst({ where: { id: row.id, ownerId, status: { in: ["queued", "running"] } }, include: { steps: true } });
    if (!current || hasLiveStep(current) || countedAttempts(current.steps) >= MAX_TOTAL_ATTEMPTS) return false;
    const claim = await tx.reportJobStep.updateMany({
      where: { id: next.id, status: next.status, attempts: next.attempts, updatedAt: next.updatedAt },
      data: { status: "running", attempts: { increment: 1 }, error: null, startedAt: claimTime, finishedAt: null },
    });
    if (claim.count !== 1) return false;
    await tx.reportJob.update({
      where: { id: row.id },
      data: {
        status: "running",
        stage: `${stageLabel} (${next.index + 1}/${row.totalSteps})`,
        progress: progressFor(doneBefore, row.totalSteps),
        heartbeatAt: new Date(),
      },
    });
    return true;
  });
  if (!claimed) return toPublic((await readJob(row.id, ownerId))!);
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
      prisma.reportJobStep.updateMany({ where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } }, data: { output: text } }),
      prisma.reportJob.updateMany({ where: { id: row.id, status: "running" }, data: { heartbeatAt: new Date(), stage: `${stageLabel} (${next.index + 1}/${row.totalSteps}) · ${countWords(text)} kata` } }),
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
  const heartbeat = setInterval(() => {
    void (async () => {
      const current = await prisma.reportJob.findFirst({ where: { id: row.id, ownerId, status: { in: ["queued", "running"] } }, select: { id: true } });
      if (!current) { controller.abort(new Error("Job tidak aktif.")); return; }
      const lease = await prisma.reportJobStep.updateMany({ where: { id: next.id, status: "running", attempts: attemptNo, startedAt: claimTime }, data: { updatedAt: new Date() } });
      if (!lease.count) controller.abort(new Error("Klaim langkah berubah."));
    })().catch(() => controller.abort(new Error("Heartbeat laporan gagal.")));
  }, 15_000);
  try {
    controller.signal.throwIfAborted();
    const staleDiagram = kind === "diagram" && !compact.diagrams.some((diagram) => diagram.id === (next.sectionId || "").slice(DIAGRAM_PREFIX.length) && !diagram.approved);
    const staleChapter = kind === "chapter" && outlineIndex < 0;
    const auditTarget = kind === "audit" ? row.steps.find((step) => step.index === Number((next.sectionId || "").slice(AUDIT_PREFIX.length))) : undefined;
    const staleAudit = kind === "audit" && !compact.outline.some((section, index) => (section.id || `section-${index + 1}`) === auditTarget?.sectionId);
    const fixTarget = kind === "fix" ? row.steps.find((step) => step.index === parseFixId(next.sectionId).target) : undefined;
    const staleFix = kind === "fix" && (!fixTarget || stepKind(fixTarget.sectionId) !== "chapter");
    if (compact.intent.outputMode === "citations_only" || staleDiagram || staleChapter || staleAudit || staleFix) {
      await prisma.reportJobStep.updateMany({
        where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } },
        data: { status: "done", output: "", summary: "Dilewati sesuai kontrak mode/scope/visual", finishedAt: new Date() },
      });
      onEvent("Langkah lama dilewati sesuai kontrak pengguna, tanpa panggilan AI.");
    } else if (kind === "diagram") {
      await runDiagramStep(row, { ...next, attempts: attemptNo, startedAt: claimTime }, project, onEvent);
    } else if (kind === "audit") {
      await runAuditStep(row, { ...next, attempts: attemptNo, startedAt: claimTime }, steps, project, mode, onEvent);
    } else if (kind === "review") {
      await runReviewStep(row, { ...next, attempts: attemptNo, startedAt: claimTime }, project, onEvent, controller.signal);
    } else if (kind === "fix") {
      await runFixStep(row, { ...next, attempts: attemptNo, startedAt: claimTime }, project, mode, onEvent);
    } else {
      const chapter = await generateChapter(project, chapterInput);
      controller.signal.throwIfAborted();
      await pendingWrite;
      const seconds = Math.round((Date.now() - stepStarted) / 1000);
      await prisma.reportJobStep.updateMany({
        where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } },
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
    const state = await readJob(row.id, ownerId);
    if (state && isJobFinished(state.status)) return toPublic(state);
    if (error instanceof AiBudgetError) {
      await appendLog(row.id, log, "error", error.message, { status: "failed", error: error.message });
      return toPublic((await readJob(row.id, ownerId))!);
    }
    const message = toPublicErrorMessage(error, "Langkah laporan gagal. Coba lagi.");
    console.error(`report step ${row.id}#${next.index} failed (attempt ${attemptNo}):`, sanitizePublicErrorText(error instanceof Error ? error.message : "unknown").slice(0, 300));
    // Teks parsial terbaik yang kita punya untuk dilanjutkan percobaan berikutnya.
    const partial = error instanceof ChapterTimeoutError && error.partial.length > (latestPartial?.length ?? 0)
      ? error.partial
      : latestPartial || previousPartial || null;

    if (kind !== "chapter") {
      // Diagram/audit tidak boleh menggagalkan laporan: tandai fallback, lanjut.
      await prisma.reportJobStep.updateMany({
        where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } },
        data: { status: "fallback", error: message, finishedAt: new Date() },
      });
      await appendLog(row.id, log, "warn", `${next.title} gagal (${message}) → dilewati`);
    } else if (attemptNo >= MAX_STEP_ATTEMPTS) {
      // Habis percobaan: pakai teks parsial kalau cukup panjang, kalau tidak placeholder.
      const usable = partial && countWords(partial) >= 250;
      const fallback = fallbackChapter(chapterInput, project);
      const content = usable ? `${partial.trimEnd()}\n\n[LANJUTAN ${next.title.toUpperCase()}: bagian ini belum selesai, gunakan fitur revisi untuk melengkapi]` : fallback.content;
      await prisma.reportJobStep.updateMany({
        where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } },
        data: { status: "fallback", output: content, summary: usable ? countWords(partial) + " kata (belum lengkap)" : fallback.summary, error: message, finishedAt: new Date() },
      });
      await appendLog(row.id, log, "error", `Bab "${next.title}" gagal ${MAX_STEP_ATTEMPTS}x (${message}) → ${usable ? "memakai teks yang sudah ada" : "placeholder"}, bisa dilengkapi lewat revisi`);
    } else {
      await prisma.reportJobStep.updateMany({
        where: { id: next.id, attempts: attemptNo, startedAt: claimTime, status: "running", job: { status: "running" } },
        data: { status: "failed", error: message, output: partial },
      });
      await appendLog(row.id, log, "warn", `Bab "${next.title}" terhenti (${message})${partial ? `, ${countWords(partial)} kata tersimpan` : ""} → akan dilanjutkan`);
    }
  } finally { clearInterval(heartbeat); }

  const fresh = await readJob(row.id, ownerId);
  if (!fresh) throw new Error("Job hilang saat diproses.");
  if (isJobFinished(fresh.status)) return toPublic(fresh);

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
  diagramData?: { nodes: unknown[]; edges: unknown[]; meta: { title: string; lanes: string[]; laneWidth?: number; diagramType: string } };
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
    const message = toPublicErrorMessage(error, "Diagram gagal dibuat.");
    const updatedDiagrams = diagrams.map((diagram) => (diagram.id === diagramId ? { ...diagram, status: "failed", error: message } : diagram));
    await prisma.reportJob.updateMany({
      where: { id: row.id, status: "running", steps: { some: { id: step.id, status: "running", attempts: step.attempts, startedAt: step.startedAt } } },
      data: { payload: { ...(row.payload as Record<string, unknown>), diagrams: updatedDiagrams } as Prisma.InputJsonValue },
    });
    await prisma.reportJobStep.updateMany({
      where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
      data: { status: "fallback", error: message, finishedAt: new Date() },
    });
    emit(`Diagram "${target.title}" tidak jadi dibuat: ${message} → bab menjelaskan secara naratif tanpa gambar`);
  };
  const persistArtifact = async (artifact: ReportDiagramArtifact, summary: string, output: Record<string, unknown>, doneMsg: string) => {
    const updatedDiagrams = diagrams.map((diagram) => (diagram.id === diagramId ? { ...diagram, ...artifact } : diagram));
    await prisma.reportJob.updateMany({
      where: { id: row.id, status: "running", steps: { some: { id: step.id, status: "running", attempts: step.attempts, startedAt: step.startedAt } } },
      data: { payload: { ...(row.payload as Record<string, unknown>), diagrams: updatedDiagrams } as Prisma.InputJsonValue },
    });
    await prisma.reportJobStep.updateMany({
      where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
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
  const svg = diagramToSvg({ nodes: data.nodes, edges: data.edges, lanes: data.lanes, laneWidth: data.laneWidth, title: data.title });
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
  await prisma.reportJobStep.updateMany({
    where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
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

// ---------------------------------------------------------------------------
// Gerbang mutu: audit akhir dokumen utuh → perbaikan per bab → audit ulang
// ---------------------------------------------------------------------------

interface FinalChapter extends ReviewChapter {
  /** index step bab asal (dipakai sebagai target perbaikan). */
  stepIndex: number;
}

/**
 * Isi final tiap bab, berurutan: perbaikan terakhir (fix) > hasil audit per bab > tulisan asli.
 * Hanya bab yang masih ada di outline dan sudah selesai ditulis.
 */
function finalChapters(row: Pick<JobRow, "payload" | "steps">): FinalChapter[] {
  const compact = compactProject(row.payload);
  const auditByTarget = new Map<number, string>();
  const fixByTarget = new Map<number, { round: number; output: string }>();
  for (const step of row.steps) {
    const kind = stepKind(step.sectionId);
    if (kind === "audit" && step.status === "done" && step.output) {
      auditByTarget.set(Number((step.sectionId || "").slice(AUDIT_PREFIX.length)), step.output);
    } else if (kind === "fix" && step.status === "done" && step.output) {
      const { round, target } = parseFixId(step.sectionId);
      const current = fixByTarget.get(target);
      if (!current || round > current.round) fixByTarget.set(target, { round, output: step.output });
    }
  }
  return row.steps
    .filter((step) => stepKind(step.sectionId) === "chapter" && compact.outline.some((section, index) => (section.id || `section-${index + 1}`) === step.sectionId))
    .filter((step) => isStepFinished(step.status) && step.output)
    .sort((a, b) => a.index - b.index)
    .map((step) => ({
      stepIndex: step.index,
      title: step.title,
      content: fixByTarget.get(step.index)?.output ?? auditByTarget.get(step.index) ?? (step.output as string),
      placeholder: step.status === "fallback",
    }));
}

async function runReviewStep(
  row: JobRow,
  step: JobRow["steps"][number],
  project: unknown,
  emit: (message: string) => void,
  signal: AbortSignal,
) {
  const round = reviewRound(step.sectionId);
  const chapters = finalChapters(row);
  const localIssues = checkReportLocally(project, chapters);
  const previousStep = row.steps.find((item) => stepKind(item.sectionId) === "review" && reviewRound(item.sectionId) === round - 1);
  const previousIssues = parseVerdict(previousStep?.output)?.issues.filter(blocksApproval);
  emit(`Pemeriksaan otomatis: ${localIssues.length ? `${localIssues.length} temuan` : "tidak ada temuan"}`);
  const verdict = await reviewReport(project, { chapters, round, localIssues, previousIssues, onEvent: emit, signal });
  signal.throwIfAborted();

  // Bab yang bisa diperbaiki otomatis: punya masalah berat/sedang, bukan placeholder (penulisan gagal total).
  const byChapter = new Map<string, FinalChapter>(chapters.map((chapter) => [chapter.title, chapter]));
  const targets = verdict.verdict === "perbaiki" && !verdict.aiUnavailable && round <= MAX_FIX_ROUNDS
    ? chapters.filter((chapter) => !chapter.placeholder && verdict.issues.some((issue) => issue.chapter === chapter.title && blocksApproval(issue)))
    : [];
  const unassigned = verdict.issues.filter((issue) => blocksApproval(issue) && (!issue.chapter || !byChapter.has(issue.chapter)));

  await prisma.$transaction(async (tx) => {
    const saved = await tx.reportJobStep.updateMany({
      where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
      data: {
        status: "done",
        output: JSON.stringify(verdict),
        summary: `${verdict.verdict === "lulus" ? "Lulus" : "Perlu perbaikan"}: ${verdict.summary}`.slice(0, 400),
        tokensUsed: verdict.tokensUsed,
        finishedAt: new Date(),
      },
    });
    if (saved.count !== 1 || !targets.length) return;
    const maxIndex = Math.max(...row.steps.map((item) => item.index));
    const extra = [
      ...targets.map((chapter, i) => ({ index: maxIndex + 1 + i, sectionId: `${FIX_PREFIX}${round}:${chapter.stepIndex}`, title: `Perbaikan: ${chapter.title}` })),
      { index: maxIndex + 1 + targets.length, sectionId: `${REVIEW_PREFIX}${round + 1}`, title: `Audit ulang setelah perbaikan ${round}/${MAX_FIX_ROUNDS}` },
    ];
    await tx.reportJobStep.createMany({ data: extra.map((item) => ({ ...item, jobId: row.id, status: "queued" })) });
    await tx.reportJob.update({ where: { id: row.id }, data: { totalSteps: { increment: extra.length } } });
  });

  if (verdict.verdict === "lulus") emit(`Audit akhir putaran ${round}: LULUS. ${verdict.summary}`);
  else if (targets.length) emit(`Audit akhir putaran ${round}: ${targets.length} bab diperbaiki lalu diaudit ulang (${targets.map((chapter) => chapter.title).join(", ")})`);
  else emit(`Audit akhir putaran ${round}: masih ada ${verdict.issues.filter(blocksApproval).length} masalah; ${round > MAX_FIX_ROUNDS ? "batas putaran tercapai" : "tidak bisa diperbaiki otomatis"}, hasil dikirim dengan catatan`);
  if (unassigned.length && targets.length) emit(`${unassigned.length} masalah umum dicatat untuk pengguna (tidak terkait satu bab)`);
}

async function runFixStep(
  row: JobRow,
  step: JobRow["steps"][number],
  project: unknown,
  mode: ReportMode,
  emit: (message: string) => void,
) {
  const { round, target } = parseFixId(step.sectionId);
  const chapters = finalChapters(row);
  const chapter = chapters.find((item) => item.stepIndex === target);
  const reviewStep = row.steps.find((item) => stepKind(item.sectionId) === "review" && reviewRound(item.sectionId) === round);
  const issues = parseVerdict(reviewStep?.output)?.issues.filter((issue) => chapter && issue.chapter === chapter.title) || [];
  if (!chapter || !issues.length) {
    await prisma.reportJobStep.updateMany({
      where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
      data: { status: "fallback", error: "tidak ada temuan untuk bab ini", finishedAt: new Date() },
    });
    emit("Tidak ada temuan auditor untuk bab ini, dilewati");
    return;
  }
  const position = Math.max(0, chapters.findIndex((item) => item.stepIndex === target));
  const result = await auditChapter(project, {
    content: chapter.content,
    sectionTitle: chapter.title,
    index: position,
    total: chapters.length || 1,
    mode,
    onEvent: emit,
    auditorIssues: fixInstructions(issues),
  });
  await prisma.reportJobStep.updateMany({
    where: { id: step.id, attempts: step.attempts, startedAt: step.startedAt, status: "running", job: { status: "running" } },
    data: {
      status: result.changed ? "done" : "fallback",
      output: result.changed ? result.content : null,
      summary: `${issues.length} temuan auditor`,
      tokensUsed: result.tokensUsed,
      error: result.changed ? null : "perbaikan tidak menghasilkan versi yang lebih baik",
      finishedAt: new Date(),
    },
  });
}

/** Keep recoverable markers intact; report missing/pending assets through logs. */
async function annotateMissingFigures(markdown: string, payload: unknown, ownerId: string) {
  const compact = compactProject(payload);
  if (compact.intent.diagrams === "omit" || compact.intent.outputMode === "citations_only") return { result: markdown.replace(/\[Gambar:[^\]]+\]/gi, ""), missing: [], pending: [], insertedTitles: [] };
  const available = new Set<string>();
  for (const diagram of payloadDiagrams(payload)) {
    if (typeof diagram.svg === "string" && diagram.svg.trim()) available.add(normalizeFigureKey(String(diagram.title || "")));
  }
  // Gambar dari bahan user (screenshot/foto) sudah tersimpan sebagai file.
  if (isRecord(payload) && Array.isArray(payload.figures)) {
    for (const figure of payload.figures) {
      if (isRecord(figure) && typeof figure.fileId === "string" && figure.fileId) available.add(normalizeFigureKey(String(figure.title || "")));
    }
  }
  const sessionId = isRecord(payload) && typeof payload.reportSessionId === "string" ? payload.reportSessionId : undefined;
  const pending = new Map<string, string>();
  const jobAssets: Array<{ title: string }> = [];
  if (sessionId) {
    const jobs = await listImageJobs(ownerId, { sessionId, limit: 50 }).catch(() => []);
    for (const job of jobs) {
      const key = normalizeFigureKey(job.title || "");
      if (!key) continue;
      if (compact.intent.diagrams === "include" || job.status === "done") jobAssets.push({ title: job.title });
      if (job.status === "done" && job.fileId) available.add(key);
      else if (job.status === "queued" || job.status === "running") pending.set(key, job.title);
    }
  }
  const assets = [...compact.diagrams.map((diagram) => ({ ...diagram, caption: diagram.caption || diagram.purpose })), ...compact.figures, ...jobAssets]
    .map((asset) => ({ ...asset, available: available.has(normalizeFigureKey(asset.title)) }));
  const { markdown: result, insertedTitles } = reconcileFigurePlaceholders(markdown, assets, compact.outline);
  const titles = assets.map((asset) => asset.title);
  const missing = new Map<string, string>();
  for (const asset of [...assets, ...figurePlaceholders(result, titles)]) {
    const key = normalizeFigureKey(asset.title);
    if (!available.has(key) && !pending.has(key)) missing.set(key, asset.title);
  }
  return { result, missing: [...missing.values()], pending: [...pending].filter(([key]) => !available.has(key)).map(([, title]) => title), insertedTitles };
}

async function finalizeJob(row: JobRow, ownerId: string, log: ReportJobEvent[]): Promise<ReportJob> {
  const compact = compactProject(row.payload);
  // Bab final = perbaikan auditor terakhir > audit per bab > tulisan asli.
  const finals = finalChapters(row);
  const chapters = finals.map((chapter) => chapter.content);
  const chapterSteps = row.steps.filter((step) => stepKind(step.sectionId) === "chapter" && compact.outline.some((section, index) => (section.id || `section-${index + 1}`) === step.sectionId));
  const auditedCount = row.steps.filter((step) => stepKind(step.sectionId) === "audit" && step.status === "done" && step.output).length;

  if (!chapters.length && compact.intent.outputMode !== "citations_only") {
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
  const review = reviewSummaryOf(row.steps);
  const assembled = assembleReport(row.payload, chapters);
  const annotated = await annotateMissingFigures(assembled, row.payload, ownerId);
  // Em/en dash are an AI hallmark; the final document never contains them (judul, daftar pustaka, catatan).
  const { missing, pending, insertedTitles } = annotated;
  const result = stripDashes(annotated.result);
  const totalWords = countWords(result);
  const totalTokens = row.steps.reduce((acc, step) => acc + step.tokensUsed, 0);
  if (missing.length) {
    await appendLog(row.id, log, "warn", `${missing.length} gambar belum tersedia; penanda dipertahankan untuk ekspor berikutnya: ${missing.slice(0, 4).join("; ")}${missing.length > 4 ? "; ..." : ""}`);
  }
  if (pending.length) await appendLog(row.id, log, "warn", `${pending.length} gambar masih diproses: ${pending.slice(0, 4).join("; ")}`);
  if (insertedTitles.length) await appendLog(row.id, log, "info", `${insertedTitles.length} penanda gambar dipulihkan dari rencana`);
  if (review) {
    await appendLog(row.id, log, review.status === "lulus" ? "info" : "warn", review.status === "lulus"
      ? `Lolos audit akhir (${review.rounds} audit, ${review.fixes} perbaikan bab)`
      : `Audit akhir selesai dengan catatan: ${review.remaining.length} masalah tersisa setelah ${review.rounds} audit${review.aiUnavailable ? " (auditor AI tidak tersedia)" : ""}`);
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
        : review?.status === "lulus"
          ? "Laporan selesai dan lolos audit"
          : review
            ? "Laporan selesai dengan catatan audit"
            : "Laporan selesai disusun",
      result,
      source: fallbackCount ? "ai-partial" : "ai",
      error: null,
    },
  );
  const done = await readJob(row.id, ownerId);
  return toPublic(done as JobRow);
}
