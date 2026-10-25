/**
 * src/lib/server/agent-runs/engine.ts
 * -----------------------------------------------------------------------------
 * Engine agent tool-calling yang TAHAN LAMA dan BISA DILANJUTKAN.
 *
 * Masalah yang dipecahkan: hosting (LiteSpeed/Passenger) memutus request idle
 * ±120 s, sedangkan tugas agent (ekstrak ZIP banyak mahasiswa, cari & verifikasi
 * puluhan sumber, menulis laporan) bisa butuh puluhan menit.
 *
 * Solusi:
 *  - State loop (riwayat pesan + tool result) disimpan di tabel `agent_runs`
 *    SETIAP langkah → proses bisa berhenti kapan saja (budget, putus koneksi,
 *    restart, user menjeda) dan dilanjutkan dari langkah terakhir, bukan dari awal.
 *  - Satu "worker" per run dijaga lewat `lockToken` + `heartbeatAt` (stale →
 *    boleh diambil alih). Request lain yang datang saat run sedang dikerjakan
 *    hanya "menempel" (attach) dan meneruskan event ke klien.
 *  - Event detail ("Mencari sumber…", "Membaca main.py…") dicatat agar user
 *    tahu proses benar-benar berjalan.
 *
 * Status: queued → running → (paused | waiting_user | done | failed | cancelled)
 * `queued` = siap dilanjutkan (oleh klien yang menyambung ulang atau cron tick).
 * -----------------------------------------------------------------------------
 */

import type OpenAI from "openai";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { aiClient, stripDashes, stripThinking, AI_MODEL, AI_MODEL_FAST } from "@/lib/ai/client";
import { detectInjection, injectionWarning } from "@/lib/ai/guard";
import { toPublicErrorMessage } from "@/lib/errors";

export type AgentKind = "laporan" | "tugas";
export type AgentRunStatus = "queued" | "running" | "paused" | "waiting_user" | "done" | "failed" | "cancelled";
export type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface AgentEvent { t: string; text: string; level?: "info" | "warn" | "error" | "tool" }
export interface AgentAttachment { fileId: string; name: string; url: string; size: number }
export interface PendingQuestion { question: string; options?: string[] }

export interface AgentRunRef {
  id: string;
  ownerId: string;
  kind: AgentKind;
  sessionId: string;
  meta: Record<string, unknown>;
}

export interface AgentToolContext {
  run: AgentRunRef;
  /** Laporkan progres detail ke user (disimpan + distream). */
  emit: (text: string) => void;
  attachments: AgentAttachment[];
  /** Nama tool yang sudah dipanggil di run ini (termasuk panggilan saat ini). */
  toolsUsed: readonly string[];
  /** Riwayat pesan run saat ini (read-only; untuk cek izin berbasis perintah user). */
  messages: readonly Msg[];
}

export interface AgentRunPublic {
  id: string;
  kind: AgentKind;
  sessionId: string;
  status: AgentRunStatus;
  stepCount: number;
  maxSteps: number;
  events: AgentEvent[];
  toolsUsed: string[];
  attachments: AgentAttachment[];
  pendingQuestion: PendingQuestion | null;
  reply: string | null;
  error: string | null;
  /** Detik sejak worker terakhir menyentuh run (deteksi macet). */
  idleSeconds: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export interface AgentDriver {
  kind: AgentKind;
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
  /** System prompt dibangun ulang tiap langkah agar selalu memakai state terbaru. */
  systemPrompt(run: AgentRunRef): Promise<string>;
  runTool(name: string, args: Record<string, unknown>, ctx: AgentToolContext): Promise<unknown>;
  /** Kalimat manusiawi untuk event "sedang apa" saat tool dipanggil. */
  describeToolCall?(name: string, args: Record<string, unknown>): string | null;
  /** Nama tool yang berarti "tanya user lalu berhenti" (status waiting_user). */
  askUserTool?: string;
  /** Dipanggil SEKALI saat run berakhir (done/waiting_user/failed/cancelled), simpan ke riwayat chat. */
  onFinish(run: AgentRunPublic & { meta: Record<string, unknown> }): Promise<void>;
  temperature?: number;
  maxTokens?: number;
}

export type AgentStreamEvent =
  | { type: "run"; run: AgentRunPublic }
  | { type: "event"; event: AgentEvent }
  | { type: "status"; phase: "heartbeat" }
  | { type: "result"; run: AgentRunPublic; continue: boolean }
  | { type: "error"; error: string };

// ---------------------------------------------------------------------------
// Konstanta
// ---------------------------------------------------------------------------

/** Lock dianggap mati bila heartbeat lebih tua dari ini → run boleh diambil alih. */
export const LOCK_STALE_MS = 90_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const STEP_TIMEOUT_MS = 90_000;
/** Sisa budget minimum untuk memulai langkah baru. */
const MIN_STEP_BUDGET_MS = 25_000;
const MAX_CONSECUTIVE_ERRORS = 3;
const EVENT_LIMIT = 300;
const TOOL_RESULT_MAX_CHARS = 14_000;
/** Model dengan thinking butuh ruang token; di bawah ini jawaban sering terpotong jadi kosong. */
const STEP_MIN_MAX_TOKENS = 4_000;
const FINAL_ANSWER_MAX_TOKENS = 4_000;
/** Berapa kali respons kosong/terpotong ditoleransi sebelum dipaksa menyimpulkan. */
const MAX_EMPTY_REPLIES = 3;
/** Jika total konteks melebihi ini, tool result lama dipangkas. */
const CONTEXT_SOFT_LIMIT_CHARS = 260_000;
const COMPACT_KEEP_LAST = 8;
const COMPACTED_RESULT_CHARS = 1_500;
export const DEFAULT_MAX_STEPS = 60;
/** Run lebih tua dari ini tidak dilanjutkan oleh cron. */
const RUN_TTL_MS = 24 * 60 * 60 * 1000;

const ACTIVE: AgentRunStatus[] = ["queued", "running"];
/** Batas tunggu rate-limit di dalam satu segmen; lebih dari ini → lepas lock, lanjut segmen berikutnya. */
const RATE_LIMIT_MAX_WAIT_MS = 70_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parse pesan 429 ("reset after 51s" / "1m 35s" / header retry-after) → ms tunggu, atau null bila bukan rate limit. */
function rateLimitWaitMs(err: unknown): number | null {
  const e = err as { status?: number; message?: string; headers?: Record<string, string> };
  const msg = e?.message ?? String(err);
  if (e?.status !== 429 && !/429|rate limit/i.test(msg)) return null;
  const ra = Number(e?.headers?.["retry-after"]);
  if (Number.isFinite(ra) && ra > 0) return ra * 1000;
  const m = /after\s+(?:(\d+)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?/i.exec(msg);
  const minutes = m?.[1] ? Number(m[1]) : 0;
  const seconds = m?.[2] ? Number(m[2]) : 0;
  const total = minutes * 60 + seconds;
  return total > 0 ? total * 1000 : 15_000;
}

/** Model alternatif saat model aktif kena rate limit (limit biasanya per model). */
function alternateModel(current: string) {
  return current === AI_MODEL_FAST ? AI_MODEL : AI_MODEL_FAST;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Row = Prisma.AgentRunGetPayload<Record<string, never>>;

const nowIso = () => new Date().toISOString();
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("AI timeout")), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

function toPublic(row: Row): AgentRunPublic {
  const heartbeat = row.heartbeatAt ?? row.updatedAt;
  return {
    id: row.id,
    kind: row.kind as AgentKind,
    sessionId: row.sessionId,
    status: row.status as AgentRunStatus,
    stepCount: row.stepCount,
    maxSteps: row.maxSteps,
    events: asArr(row.events) as AgentEvent[],
    toolsUsed: asArr(row.toolsUsed).map(String),
    attachments: asArr(row.attachments) as AgentAttachment[],
    pendingQuestion: row.pendingQuestion ? (row.pendingQuestion as unknown as PendingQuestion) : null,
    reply: row.reply,
    error: row.error,
    idleSeconds: Math.max(0, Math.round((Date.now() - heartbeat.getTime()) / 1000)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function toRef(row: Row): AgentRunRef {
  return { id: row.id, ownerId: row.ownerId, kind: row.kind as AgentKind, sessionId: row.sessionId, meta: asObj(row.meta) };
}

async function loadDriver(kind: AgentKind): Promise<AgentDriver> {
  // Dynamic import menghindari circular import (driver juga memakai engine).
  if (kind === "laporan") return (await import("@/lib/server/laporan/assistant")).laporanAgentDriver;
  if (kind === "tugas") return (await import("@/lib/server/tugas/assistant")).tugasAgentDriver;
  throw new Error(`Jenis agent tidak dikenal: ${kind}`);
}

function clipToolResult(obj: unknown): string {
  const s = JSON.stringify(obj ?? null);
  const clipped = s.length > TOOL_RESULT_MAX_CHARS ? `${s.slice(0, TOOL_RESULT_MAX_CHARS)}…[dipotong]` : s;
  // Hasil tool bisa memuat konten pihak ketiga (file mahasiswa, PDF, web) → scan pola prompt injection.
  const warning = injectionWarning(detectInjection(s), "Hasil tool ini");
  return warning ? `${JSON.stringify({ securityWarning: warning })}\n${clipped}` : clipped;
}

// ---------------------------------------------------------------------------
// Validasi argumen tool (output model = tak tepercaya)
// ---------------------------------------------------------------------------

type JsonSchemaLite = { type?: string | string[]; properties?: Record<string, JsonSchemaLite>; items?: JsonSchemaLite; required?: string[]; enum?: unknown[] };

const TOOL_STRING_MAX = 20_000;

/** Cek satu nilai terhadap skema ringan. Return pesan error atau null. */
function checkValue(value: unknown, schema: JsonSchemaLite | undefined, path: string, depth = 0): string | null {
  if (!schema || value === undefined || value === null) return null;
  if (depth > 5) return `${path}: struktur terlalu dalam`;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (schema.enum && !schema.enum.includes(value)) return `${path}: nilai di luar pilihan`;
  if (!types.length) return null;
  const actual = Array.isArray(value) ? "array" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
  // Model sering mengirim angka sebagai string ("85"); tetap aman karena bukan objek.
  const numericString = typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim());
  const ok = types.some((t) => t === actual || (t === "number" && actual === "integer") || ((t === "number" || t === "integer") && numericString));
  if (!ok) return `${path}: harus ${types.join("/")}, bukan ${actual}`;
  if (typeof value === "string" && value.length > TOOL_STRING_MAX) return `${path}: terlalu panjang`;
  if (Array.isArray(value)) {
    if (value.length > 200) return `${path}: terlalu banyak item`;
    for (let i = 0; i < value.length; i++) {
      const err = checkValue(value[i], schema.items, `${path}[${i}]`, depth + 1);
      if (err) return err;
    }
  }
  if (actual === "object" && schema.properties) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      const err = checkValue((value as Record<string, unknown>)[key], sub, `${path}.${key}`, depth + 1);
      if (err) return err;
    }
  }
  return null;
}

/**
 * Validasi argumen tool terhadap JSON schema di `driver.tools`.
 * Mencegah model (yang bisa terkena prompt injection) mengirim objek ke field
 * string/ID (mis. `{"not": ""}` → injeksi operator Prisma) atau tool fiktif.
 */
export function validateToolArgs(tools: AgentDriver["tools"], name: string, args: Record<string, unknown>): string | null {
  const tool = tools.find((t) => t.type === "function" && t.function.name === name);
  if (!tool || tool.type !== "function") return `Tool "${name.slice(0, 60)}" tidak tersedia.`;
  const schema = (tool.function.parameters ?? {}) as JsonSchemaLite;
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") return `Argumen wajib "${key}" kosong.`;
  }
  return checkValue(args, { ...schema, type: "object" }, "args");
}

/** Gambar yang ingin tool tunjukkan ke model vision (mis. halaman PDF scan). */
export interface ToolImage { dataUrl: string; label?: string }
export const TOOL_IMAGES_KEY = "__images";
const MAX_TOOL_IMAGES = 8;

/** Pisahkan `__images` dari hasil tool: JSON tetap ringkas, gambar dikirim sebagai pesan user terpisah. */
function splitToolImages(result: unknown): { result: unknown; images: ToolImage[] } {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { result, images: [] };
  const { [TOOL_IMAGES_KEY]: raw, ...rest } = result as Record<string, unknown>;
  if (!Array.isArray(raw)) return { result, images: [] };
  const images = raw
    .filter((x): x is ToolImage => !!x && typeof x === "object" && typeof (x as ToolImage).dataUrl === "string" && (x as ToolImage).dataUrl.startsWith("data:image/"))
    .slice(0, MAX_TOOL_IMAGES);
  return { result: rest, images };
}

function imagesToUserMessage(images: ToolImage[]): Msg {
  const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: `[SISTEM] ${images.length} gambar dari hasil tool terakhir (${images.map((i) => i.label || "gambar").join(", ")}). Baca isinya langsung dari gambar.` },
  ];
  for (const img of images) parts.push({ type: "image_url", image_url: { url: img.dataUrl, detail: "high" } });
  return { role: "user", content: parts };
}

/** Pangkas tool result lama supaya konteks model & ukuran row tetap terkendali. */
function compactMessages(messages: Msg[], force = false): Msg[] {
  const total = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
  if (!force && total < CONTEXT_SOFT_LIMIT_CHARS) return messages;
  const cutoff = Math.max(0, messages.length - COMPACT_KEEP_LAST);
  return messages.map((m, i) => {
    if (i >= cutoff) return m;
    // Gambar lama (halaman PDF) dibuang, sisakan keterangannya saja.
    if (m.role === "user" && Array.isArray(m.content) && m.content.some((p) => p.type === "image_url")) {
      const text = m.content.filter((p): p is OpenAI.Chat.Completions.ChatCompletionContentPartText => p.type === "text").map((p) => p.text).join("\n");
      return { role: "user", content: `${text}\n[gambar dihapus untuk hemat konteks]` };
    }
    if (m.role !== "tool" || typeof m.content !== "string" || m.content.length <= COMPACTED_RESULT_CHARS) return m;
    return { ...m, content: `${m.content.slice(0, COMPACTED_RESULT_CHARS)}…[hasil lama dipangkas untuk hemat konteks]` };
  });
}

/** Deskripsi default pemanggilan tool bila driver tidak menyediakan, tanpa nama/argumen teknis. */
function defaultDescribe() {
  return "Mengumpulkan data…";
}

/** Label manusiawi sebuah tool untuk event progres (fallback ke label generik). */
function describeTool(driver: AgentDriver, name: string) {
  const text = driver.describeToolCall?.(name, {}) || "";
  return text.replace(/[…:.\s]+$/u, "").replace(/\s*"\s*"$/u, "").trim() || "Langkah";
}

// ---------------------------------------------------------------------------
// Public API, baca
// ---------------------------------------------------------------------------

export async function getAgentRun(runId: string, ownerId: string): Promise<AgentRunPublic | null> {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, ownerId } });
  return row ? toPublic(row) : null;
}

/** Run yang belum selesai (queued/running/paused) untuk sesi ini, dipakai UI untuk auto-resume. */
export async function findActiveAgentRun(ownerId: string, kind: AgentKind, sessionId: string): Promise<AgentRunPublic | null> {
  const row = await prisma.agentRun.findFirst({
    where: { ownerId, kind, sessionId, status: { in: ["queued", "running", "paused"] }, createdAt: { gte: new Date(Date.now() - RUN_TTL_MS) } },
    orderBy: { createdAt: "desc" },
  });
  return row ? toPublic(row) : null;
}

export function isRunLive(run: AgentRunPublic) {
  return run.status === "running" && run.idleSeconds * 1000 < LOCK_STALE_MS;
}

// ---------------------------------------------------------------------------
// Public API, mutasi
// ---------------------------------------------------------------------------

export async function createAgentRun(input: {
  ownerId: string;
  kind: AgentKind;
  sessionId: string;
  model: string;
  messages: Msg[];
  meta?: Record<string, unknown>;
  maxSteps?: number;
}): Promise<AgentRunPublic> {
  const row = await prisma.agentRun.create({
    data: {
      ownerId: input.ownerId,
      kind: input.kind,
      sessionId: input.sessionId,
      model: input.model,
      status: "queued",
      maxSteps: Math.min(200, Math.max(1, input.maxSteps ?? DEFAULT_MAX_STEPS)),
      messages: input.messages as unknown as Prisma.InputJsonValue,
      meta: (input.meta ?? {}) as Prisma.InputJsonValue,
      events: [{ t: nowIso(), text: "Permintaan diterima, menyiapkan konteks…" }] as unknown as Prisma.InputJsonValue,
      toolsUsed: [],
      attachments: [],
      heartbeatAt: new Date(),
    },
  });
  return toPublic(row);
}

/**
 * Tambahkan pesan user ke run yang sedang dijeda/antre (mis. instruksi tambahan
 * saat user mengetik "lanjut, tapi fokus ke BAB 2"). Tidak boleh saat running.
 */
export async function appendUserMessage(runId: string, ownerId: string, content: string): Promise<boolean> {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, ownerId } });
  if (!row || !["queued", "paused"].includes(row.status)) return false;
  const messages = asArr(row.messages) as Msg[];
  messages.push({ role: "user", content });
  const events = asArr(row.events) as AgentEvent[];
  events.push({ t: nowIso(), text: `Instruksi tambahan dari user: ${content.slice(0, 120)}` });
  await prisma.agentRun.update({ where: { id: runId }, data: { messages: messages as unknown as Prisma.InputJsonValue, events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue } });
  return true;
}

/**
 * pause  : worker berhenti di batas langkah berikutnya (atau langsung bila tidak ada worker hidup).
 * cancel : hentikan permanen.
 * resume : paused → queued (caller lalu memanggil serveAgentRun).
 */
export async function controlAgentRun(runId: string, ownerId: string, action: "pause" | "cancel" | "resume"): Promise<AgentRunPublic | null> {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, ownerId } });
  if (!row) return null;
  const pub = toPublic(row);
  const finished = ["done", "failed", "cancelled", "waiting_user"].includes(row.status);

  if (action === "resume") {
    if (row.status === "paused") {
      const events = [...pub.events, { t: nowIso(), text: "Dilanjutkan oleh user" }].slice(-EVENT_LIMIT);
      const updated = await prisma.agentRun.update({ where: { id: runId }, data: { status: "queued", control: null, error: null, events: events as unknown as Prisma.InputJsonValue } });
      return toPublic(updated);
    }
    return pub;
  }

  if (finished) return pub;

  // Worker hidup → titip perintah, worker yang mengeksekusi di batas langkah.
  if (isRunLive(pub)) {
    const updated = await prisma.agentRun.update({ where: { id: runId }, data: { control: action } });
    return toPublic(updated);
  }

  // Tidak ada worker → eksekusi langsung.
  if (action === "pause") {
    const events = [...pub.events, { t: nowIso(), text: "Dijeda oleh user" }].slice(-EVENT_LIMIT);
    const updated = await prisma.agentRun.update({ where: { id: runId }, data: { status: "paused", control: null, lockToken: null, events: events as unknown as Prisma.InputJsonValue } });
    return toPublic(updated);
  }
  return finishRun(row.id, {
    status: "cancelled",
    reply: `Dihentikan oleh user. Aktivitas yang sudah dijalankan: ${pub.events.filter((e) => e.level === "tool").map((e) => e.text).slice(-8).join("; ") || "belum ada"}.`,
    events: [...pub.events, { t: nowIso(), text: "Dibatalkan oleh user", level: "warn" }],
  });
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

async function acquireLock(runId: string): Promise<string | null> {
  const token = randomUUID();
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const res = await prisma.agentRun.updateMany({
    where: {
      id: runId,
      status: { in: ACTIVE },
      OR: [{ lockToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: stale } }],
    },
    data: { lockToken: token, status: "running", heartbeatAt: new Date(), startedAt: new Date() },
  });
  return res.count === 1 ? token : null;
}

/** Tulis status akhir + panggil driver.onFinish tepat sekali (dijaga `finishedAt IS NULL`). */
async function finishRun(
  runId: string,
  patch: { status: AgentRunStatus; reply?: string | null; error?: string | null; events: AgentEvent[]; pendingQuestion?: PendingQuestion | null; messages?: Msg[]; toolsUsed?: string[]; attachments?: AgentAttachment[] },
): Promise<AgentRunPublic> {
  const res = await prisma.agentRun.updateMany({
    where: { id: runId, finishedAt: null },
    data: {
      status: patch.status,
      reply: patch.reply ?? undefined,
      error: patch.error ?? undefined,
      events: patch.events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue,
      pendingQuestion: patch.pendingQuestion ? (patch.pendingQuestion as unknown as Prisma.InputJsonValue) : undefined,
      messages: patch.messages ? (patch.messages as unknown as Prisma.InputJsonValue) : undefined,
      toolsUsed: patch.toolsUsed ? (patch.toolsUsed as unknown as Prisma.InputJsonValue) : undefined,
      attachments: patch.attachments ? (patch.attachments as unknown as Prisma.InputJsonValue) : undefined,
      control: null,
      lockToken: null,
      finishedAt: new Date(),
      heartbeatAt: new Date(),
    },
  });
  const row = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const pub = toPublic(row);
  if (res.count === 1) {
    try {
      const driver = await loadDriver(pub.kind);
      await driver.onFinish({ ...pub, meta: asObj(row.meta) });
    } catch (err) {
      console.error(`[agent-run ${runId}] onFinish gagal:`, err instanceof Error ? err.message : err);
    }
  }
  return pub;
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

interface LoopOptions { budgetMs: number; emit?: (ev: AgentStreamEvent) => void }

async function runLoop(runId: string, token: string, opts: LoopOptions): Promise<AgentRunPublic> {
  const startedAt = Date.now();
  const row0 = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
  const ref = toRef(row0);
  const driver = await loadDriver(ref.kind);

  let messages = asArr(row0.messages) as Msg[];
  const events = asArr(row0.events) as AgentEvent[];
  const toolsUsed = asArr(row0.toolsUsed).map(String);
  const attachments = asArr(row0.attachments) as AgentAttachment[];
  let stepCount = row0.stepCount;
  let consecutiveErrors = 0;
  let emptyReplies = 0;
  let model = row0.model;
  /** model → epoch ms saat kuota diperkirakan pulih (hanya untuk segmen ini). */
  const availableAt = new Map<string, number>();

  // Event ditulis ke DB dengan throttle supaya mode "attach" dan cron bisa melihat progres.
  let lastEventFlush = 0;
  let flushing: Promise<unknown> = Promise.resolve();
  const flushEvents = (force = false) => {
    if (!force && Date.now() - lastEventFlush < 2_000) return flushing;
    lastEventFlush = Date.now();
    flushing = flushing
      .then(() => prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue, heartbeatAt: new Date() } }))
      .catch(() => undefined);
    return flushing;
  };
  const emit = (text: string, level: AgentEvent["level"] = "info") => {
    const ev: AgentEvent = { t: nowIso(), text: text.slice(0, 400), level };
    events.push(ev);
    if (events.length > EVENT_LIMIT) events.splice(0, events.length - EVENT_LIMIT);
    opts.emit?.({ type: "event", event: ev });
    void flushEvents();
  };

  const heartbeat = setInterval(() => {
    void prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
  }, HEARTBEAT_INTERVAL_MS);

  const persistStep = async () =>
    prisma.agentRun.updateMany({
      where: { id: runId, lockToken: token },
      data: {
        messages: messages as unknown as Prisma.InputJsonValue,
        events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue,
        toolsUsed: toolsUsed as unknown as Prisma.InputJsonValue,
        attachments: attachments as unknown as Prisma.InputJsonValue,
        stepCount,
        heartbeatAt: new Date(),
      },
    });

  const release = async (status: AgentRunStatus, note: string) => {
    emit(note, "warn");
    await flushing;
    await prisma.agentRun.updateMany({
      where: { id: runId, lockToken: token },
      data: { status, lockToken: null, control: null, events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue, heartbeatAt: new Date() },
    });
    return getAgentRun(runId, ref.ownerId) as Promise<AgentRunPublic>;
  };

  const finish = async (patch: Omit<Parameters<typeof finishRun>[1], "events" | "messages" | "toolsUsed" | "attachments">) => {
    await flushing;
    return finishRun(runId, { ...patch, events, messages, toolsUsed, attachments });
  };

  /** Paksa model menulis jawaban akhir dari data yang sudah terkumpul. */
  const forceFinalAnswer = async (reason: string) => {
    emit("Menyusun jawaban akhir dari data yang sudah terkumpul…");
    const system = await driver.systemPrompt(ref).catch(() => "");
    const base: Msg[] = [
      { role: "system", content: system },
      ...compactMessages(messages, true),
      { role: "user", content: `[SISTEM] ${reason} Tulis jawaban akhir SEKARANG berdasarkan data yang sudah terkumpul: apa yang sudah dikerjakan, temuan utama, dan apa yang belum sempat (jika ada). Jangan memanggil tool. Langsung tulis jawabannya tanpa berpikir panjang.` },
    ];
    // Model cepat sering menghabiskan token untuk berpikir → kalau kosong, coba model utama.
    for (const m of [model, alternateModel(model)]) {
      try {
        const r = await withTimeout(
          aiClient.chat.completions.create({ model: m, messages: base, temperature: 0.2, max_tokens: FINAL_ANSWER_MAX_TOKENS }, { timeout: 80_000, maxRetries: 0 }),
          82_000,
        );
        const text = stripDashes(stripThinking(r.choices[0]?.message?.content));
        if (text) return text;
      } catch { /* coba model berikutnya */ }
    }
    return "";
  };

  try {
    for (;;) {
      // 1. Perintah user (pause/cancel) dicek di tiap batas langkah.
      const ctl = await prisma.agentRun.findUnique({ where: { id: runId }, select: { control: true, status: true, lockToken: true } });
      if (!ctl || ctl.lockToken !== token) return (await getAgentRun(runId, ref.ownerId)) as AgentRunPublic;
      if (ctl.control === "cancel") {
        return finish({ status: "cancelled", reply: `Dihentikan oleh user setelah ${stepCount} langkah. Aktivitas: ${events.filter((e) => e.level === "tool").map((e) => e.text).slice(-8).join("; ") || "-"}.` });
      }
      if (ctl.control === "pause") return release("paused", "Dijeda oleh user, ketik \"lanjut\" untuk meneruskan dari langkah terakhir.");

      // 2. Batas langkah → jawaban akhir.
      if (stepCount >= row0.maxSteps) {
        const reply = (await forceFinalAnswer("Batas langkah tercapai.")) || `Batas ${row0.maxSteps} langkah tercapai. Ketik "lanjut" untuk meneruskan.`;
        return finish({ status: "done", reply });
      }

      // 3. Budget segmen habis → lepas lock, status queued (klien/cron melanjutkan).
      const remaining = opts.budgetMs - (Date.now() - startedAt);
      if (remaining < MIN_STEP_BUDGET_MS) return release("queued", "Segmen waktu server habis, melanjutkan otomatis di segmen berikutnya…");

      // 4. Panggil model.
      const isLast = stepCount === row0.maxSteps - 1;
      emit(`Berpikir (langkah ${stepCount + 1})…`);
      messages = compactMessages(messages);
      let completion: OpenAI.Chat.Completions.ChatCompletion;
      try {
        const system = await driver.systemPrompt(ref);
        const timeout = Math.min(STEP_TIMEOUT_MS, remaining - 5_000);
        completion = await withTimeout(
          aiClient.chat.completions.create({
            model,
            messages: [{ role: "system", content: system }, ...messages],
            tools: driver.tools,
            tool_choice: isLast ? "none" : "auto",
            temperature: driver.temperature ?? 0.2,
            max_tokens: Math.max(driver.maxTokens ?? 1800, STEP_MIN_MAX_TOKENS),
          }, { timeout, maxRetries: 0 }), // retry SDK tidur mengikuti retry-after → bisa makan seluruh segmen
          timeout + 2_000,
        );
        consecutiveErrors = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agent-run ${runId}] AI error:`, msg.slice(0, 300));
        // Rate limit bukan kegagalan: ganti model, tunggu sesuai "reset after" bila masih muat di segmen.
        const waitMs = rateLimitWaitMs(err);
        if (waitMs !== null) {
          availableAt.set(model, Date.now() + waitMs);
          const next = alternateModel(model);
          const nextWait = Math.max(0, (availableAt.get(next) ?? 0) - Date.now());
          if (nextWait === 0) {
            emit(`Kuota AI penuh (reset ±${Math.ceil(waitMs / 1000)}s), beralih ke jalur cadangan…`, "warn");
            model = next;
            await prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { model } }).catch(() => undefined);
            continue;
          }
          // Kedua model dibatasi → tunggu yang paling cepat pulih bila masih muat di segmen.
          const wait = Math.min(waitMs, nextWait) + 1_000;
          const left = opts.budgetMs - (Date.now() - startedAt) - MIN_STEP_BUDGET_MS;
          model = waitMs <= nextWait ? model : next;
          await prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { model } }).catch(() => undefined);
          if (wait <= Math.min(left, RATE_LIMIT_MAX_WAIT_MS)) {
            emit(`Kuota AI penuh, menunggu ±${Math.ceil(wait / 1000)}s lalu lanjut…`, "warn");
            await sleep(wait);
          } else {
            return release("queued", `Kuota AI sedang dibatasi (±${Math.ceil(wait / 1000)}s), dilanjutkan otomatis setelah pulih…`);
          }
          continue;
        }
        consecutiveErrors += 1;
        emit(`AI belum merespons, percobaan ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`, "warn");
        if (/context|token|length|too large|maximum/i.test(msg)) messages = compactMessages(messages, true);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const reply = (await forceFinalAnswer("AI berulang kali gagal.")) || "";
          return finish({ status: reply ? "done" : "failed", reply: reply || null, error: reply ? null : toPublicErrorMessage(err, "Layanan AI sedang bermasalah. Coba lagi beberapa saat.") });
        }
        continue;
      }

      const msg = completion.choices[0]?.message;
      if (!msg) { consecutiveErrors += 1; continue; }
      const calls = msg.tool_calls ?? [];
      const truncated = completion.choices[0]?.finish_reason === "length";

      // 5. Jawaban akhir.
      if (!calls.length) {
        let reply = stripDashes(stripThinking(msg.content));
        // Respons kosong/terpotong (model berpikir sampai habis token) bukan kesimpulan → dorong lanjut.
        if ((!reply || truncated) && emptyReplies < MAX_EMPTY_REPLIES) {
          emptyReplies += 1;
          emit("Jawaban belum lengkap, melanjutkan pekerjaan…", "warn");
          if (reply) messages.push({ role: "assistant", content: reply });
          messages.push({ role: "user", content: "[SISTEM] Respons sebelumnya kosong atau terpotong. Lanjutkan pekerjaan: panggil tool berikutnya yang dibutuhkan, atau bila data sudah cukup tulis kesimpulan ringkas langsung tanpa berpikir panjang." });
          stepCount += 1;
          await persistStep();
          continue;
        }
        if (!reply) reply = await forceFinalAnswer("Jawaban kosong.");
        if (!reply) reply = `Saya sudah mengerjakan ${toolsUsed.length} langkah tetapi belum sampai kesimpulan. Ketik "lanjut" atau persempit permintaan.`;
        if (attachments.length) reply += `\n\nFile siap diunduh: ${attachments.map((a) => `[${a.name}](${a.url})`).join(", ")}`;
        emit("Selesai.");
        return finish({ status: "done", reply });
      }

      // 6. Eksekusi tool.
      messages.push({ role: "assistant", content: stripThinking(msg.content), tool_calls: calls });
      let pending: PendingQuestion | null = null;
      const pendingImages: ToolImage[] = [];
      for (const call of calls) {
        if (call.type !== "function") continue;
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try {
          const parsedArgs: unknown = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          args = asObj(parsedArgs);
        } catch { args = {}; }
        toolsUsed.push(name);

        if (driver.askUserTool && name === driver.askUserTool) {
          pending = {
            question: String(args.question ?? "Mohon konteks tambahan."),
            options: Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : undefined,
          };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true, note: "Pertanyaan diteruskan ke user." }) });
          continue;
        }

        emit(driver.describeToolCall?.(name, args) || defaultDescribe(), "tool");
        const t0 = Date.now();
        let result: unknown;
        const argError = validateToolArgs(driver.tools, name, args);
        if (argError) {
          console.warn(`[agent-run ${runId}] argumen tool ${name.slice(0, 60)} ditolak: ${argError}`);
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: `Argumen ditolak: ${argError}` }) });
          continue;
        }
        try {
          result = await driver.runTool(name, args, { run: ref, emit: (text) => emit(text), attachments, toolsUsed, messages });
        } catch (err) {
          // Pesan mentah hanya untuk konteks model (bukan user); log + event publik disaring.
          const raw = err instanceof Error ? err.message : "Tool gagal.";
          console.warn(`[agent-run ${runId}] tool ${name} gagal:`, raw.slice(0, 300));
          result = { error: raw.slice(0, 400) };
          emit(`${describeTool(driver, name)} gagal: ${toPublicErrorMessage(err, "terjadi gangguan")}`, "warn");
        }
        const secs = Math.round((Date.now() - t0) / 1000);
        if (secs >= 3) emit(`${describeTool(driver, name)} selesai (${secs}s)`);
        const split = splitToolImages(result);
        pendingImages.push(...split.images);
        messages.push({ role: "tool", tool_call_id: call.id, content: clipToolResult(split.result) });
      }
      // Gambar harus di pesan user (bukan tool) agar model vision bisa melihatnya.
      if (pendingImages.length) messages.push(imagesToUserMessage(pendingImages.slice(0, MAX_TOOL_IMAGES)));

      stepCount += 1;
      await persistStep();

      if (pending) {
        emit(`Bertanya ke user: ${pending.question.slice(0, 120)}`);
        return finish({ status: "waiting_user", reply: stripDashes(stripThinking(msg.content)) || pending.question, pendingQuestion: pending });
      }
    }
  } catch (err) {
    console.error(`[agent-run ${runId}] loop error:`, err instanceof Error ? err.message : err);
    const message = toPublicErrorMessage(err, "Terjadi kesalahan tak terduga.");
    emit(`${message}, run disimpan, bisa dilanjutkan.`, "error");
    await flushing;
    await prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { status: "queued", lockToken: null, error: message.slice(0, 300), events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue } });
    return (await getAgentRun(runId, ref.ownerId)) as AgentRunPublic;
  } finally {
    clearInterval(heartbeat);
  }
}

/** Mode "attach": ikuti event run yang sedang dikerjakan proses lain. */
async function attachLoop(runId: string, ownerId: string, opts: LoopOptions): Promise<AgentRunPublic | null> {
  const deadline = Date.now() + opts.budgetMs;
  let seen = -1;
  for (;;) {
    const run = await getAgentRun(runId, ownerId);
    if (!run) return null;
    if (seen < 0) seen = Math.max(0, run.events.length - 10);
    for (const ev of run.events.slice(seen)) opts.emit?.({ type: "event", event: ev });
    seen = run.events.length;
    if (run.status !== "running" || !isRunLive(run) || Date.now() > deadline) return run;
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

/**
 * Entry point untuk route: kerjakan run ini selama `budgetMs` (atau sampai
 * selesai). Kalau proses lain sedang mengerjakannya, tempel dan teruskan event.
 * Mengembalikan state terakhir; caller cek `status` untuk tahu perlu lanjut.
 */
export async function serveAgentRun(runId: string, ownerId: string, opts: LoopOptions): Promise<AgentRunPublic> {
  const deadline = Date.now() + opts.budgetMs;
  let last: AgentRunPublic | null = null;
  for (;;) {
    const run = await getAgentRun(runId, ownerId);
    if (!run) throw new Error("Run tidak ditemukan.");
    last = run;
    if (!ACTIVE.includes(run.status)) return run;
    const remaining = deadline - Date.now();
    if (remaining < MIN_STEP_BUDGET_MS) return run;

    const token = await acquireLock(runId);
    if (token) return runLoop(runId, token, { budgetMs: remaining, emit: opts.emit });

    const after = await attachLoop(runId, ownerId, { budgetMs: Math.min(remaining, 60_000), emit: opts.emit });
    if (!after) return last;
    if (!ACTIVE.includes(after.status)) return after;
  }
}

export function runNeedsContinue(run: AgentRunPublic) {
  return ACTIVE.includes(run.status);
}

/**
 * Dipanggil cron: lanjutkan run `queued` (atau running yang macet) yang tidak
 * sedang dikerjakan siapa pun, supaya pekerjaan terus jalan walau tab ditutup.
 */
export async function tickAgentRuns(limit = 1, budgetMs = 80_000) {
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const candidates = await prisma.agentRun.findMany({
    where: {
      status: { in: ACTIVE },
      createdAt: { gte: new Date(Date.now() - RUN_TTL_MS) },
      OR: [{ lockToken: null }, { heartbeatAt: null }, { heartbeatAt: { lt: stale } }],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, ownerId: true },
  });
  const processed: Array<{ id: string; status: string }> = [];
  for (const c of candidates) {
    try {
      const r = await serveAgentRun(c.id, c.ownerId, { budgetMs });
      processed.push({ id: c.id, status: r.status });
    } catch (err) {
      console.error(`[agent-run tick ${c.id}]`, err instanceof Error ? err.message : err);
    }
  }
  return { scanned: candidates.length, processed };
}

/** Kata kunci "lanjutkan saja", tidak perlu ditambahkan sebagai pesan baru. */
export function isContinueKeyword(text: string) {
  return /^(lanjut(kan)?|terus(kan)?|continue|resume|ok(e|ay)?|go|ya|yes|sip|gas)\W*$/i.test(text.trim());
}
