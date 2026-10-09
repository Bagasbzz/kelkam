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
import { aiClient, stripThinking, AI_MODEL, AI_MODEL_FAST } from "@/lib/ai/client";

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
}

export interface AgentRunPublic {
  id: string;
  kind: AgentKind;
  sessionId: string;
  status: AgentRunStatus;
  model: string;
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
  /** Dipanggil SEKALI saat run berakhir (done/waiting_user/failed/cancelled) — simpan ke riwayat chat. */
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
    model: row.model,
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
  return s.length > TOOL_RESULT_MAX_CHARS ? `${s.slice(0, TOOL_RESULT_MAX_CHARS)}…[dipotong]` : s;
}

/** Pangkas tool result lama supaya konteks model & ukuran row tetap terkendali. */
function compactMessages(messages: Msg[], force = false): Msg[] {
  const total = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
  if (!force && total < CONTEXT_SOFT_LIMIT_CHARS) return messages;
  const cutoff = Math.max(0, messages.length - COMPACT_KEEP_LAST);
  return messages.map((m, i) => {
    if (i >= cutoff || m.role !== "tool" || typeof m.content !== "string" || m.content.length <= COMPACTED_RESULT_CHARS) return m;
    return { ...m, content: `${m.content.slice(0, COMPACTED_RESULT_CHARS)}…[hasil lama dipangkas untuk hemat konteks]` };
  });
}

/** Deskripsi default pemanggilan tool bila driver tidak menyediakan. */
function defaultDescribe(name: string, args: Record<string, unknown>) {
  const keys = Object.keys(args).slice(0, 3).map((k) => {
    const v = args[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}=${(s ?? "").slice(0, 40)}`;
  });
  return `Menjalankan ${name}${keys.length ? ` (${keys.join(", ")})` : ""}`;
}

// ---------------------------------------------------------------------------
// Public API — baca
// ---------------------------------------------------------------------------

export async function getAgentRun(runId: string, ownerId: string): Promise<AgentRunPublic | null> {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, ownerId } });
  return row ? toPublic(row) : null;
}

/** Run yang belum selesai (queued/running/paused) untuk sesi ini — dipakai UI untuk auto-resume. */
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
// Public API — mutasi
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
    try {
      const system = await driver.systemPrompt(ref);
      const r = await withTimeout(
        aiClient.chat.completions.create({
          model,
          messages: [
            { role: "system", content: system },
            ...compactMessages(messages, true),
            { role: "user", content: `[SISTEM] ${reason} Tulis jawaban akhir SEKARANG berdasarkan data yang sudah terkumpul: apa yang sudah dikerjakan, temuan utama, dan apa yang belum sempat (jika ada). Jangan memanggil tool.` },
          ],
          temperature: 0.2,
          max_tokens: driver.maxTokens ?? 1800,
        }, { timeout: 60_000 }),
        62_000,
      );
      return stripThinking(r.choices[0]?.message?.content);
    } catch {
      return "";
    }
  };

  try {
    for (;;) {
      // 1. Perintah user (pause/cancel) dicek di tiap batas langkah.
      const ctl = await prisma.agentRun.findUnique({ where: { id: runId }, select: { control: true, status: true, lockToken: true } });
      if (!ctl || ctl.lockToken !== token) return (await getAgentRun(runId, ref.ownerId)) as AgentRunPublic;
      if (ctl.control === "cancel") {
        return finish({ status: "cancelled", reply: `Dihentikan oleh user setelah ${stepCount} langkah. Aktivitas: ${events.filter((e) => e.level === "tool").map((e) => e.text).slice(-8).join("; ") || "-"}.` });
      }
      if (ctl.control === "pause") return release("paused", "Dijeda oleh user — ketik \"lanjut\" untuk meneruskan dari langkah terakhir.");

      // 2. Batas langkah → jawaban akhir.
      if (stepCount >= row0.maxSteps) {
        const reply = (await forceFinalAnswer("Batas langkah tercapai.")) || `Batas ${row0.maxSteps} langkah tercapai. Ketik "lanjut" untuk meneruskan.`;
        return finish({ status: "done", reply });
      }

      // 3. Budget segmen habis → lepas lock, status queued (klien/cron melanjutkan).
      const remaining = opts.budgetMs - (Date.now() - startedAt);
      if (remaining < MIN_STEP_BUDGET_MS) return release("queued", "Segmen waktu server habis — melanjutkan otomatis di segmen berikutnya…");

      // 4. Panggil model.
      const isLast = stepCount === row0.maxSteps - 1;
      emit(`Berpikir (langkah ${stepCount + 1}, ${model})…`);
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
            max_tokens: driver.maxTokens ?? 1800,
          }, { timeout }),
          timeout + 2_000,
        );
        consecutiveErrors = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Rate limit bukan kegagalan: ganti model, tunggu sesuai "reset after" bila masih muat di segmen.
        const waitMs = rateLimitWaitMs(err);
        if (waitMs !== null) {
          availableAt.set(model, Date.now() + waitMs);
          const next = alternateModel(model);
          const nextWait = Math.max(0, (availableAt.get(next) ?? 0) - Date.now());
          if (nextWait === 0) {
            emit(`Kuota model ${model} penuh (reset ±${Math.ceil(waitMs / 1000)}s) — beralih ke ${next}…`, "warn");
            model = next;
            continue;
          }
          // Kedua model dibatasi → tunggu yang paling cepat pulih bila masih muat di segmen.
          const wait = Math.min(waitMs, nextWait) + 1_000;
          const left = opts.budgetMs - (Date.now() - startedAt) - MIN_STEP_BUDGET_MS;
          model = waitMs <= nextWait ? model : next;
          if (wait <= Math.min(left, RATE_LIMIT_MAX_WAIT_MS)) {
            emit(`Kuota semua model penuh — menunggu ±${Math.ceil(wait / 1000)}s lalu lanjut dengan ${model}…`, "warn");
            await sleep(wait);
          } else {
            return release("queued", `Kuota AI sedang dibatasi (±${Math.ceil(wait / 1000)}s) — dilanjutkan otomatis setelah pulih…`);
          }
          continue;
        }
        consecutiveErrors += 1;
        emit(`Model gagal merespons (${msg.slice(0, 120)}) — percobaan ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}`, "warn");
        if (/context|token|length|too large|maximum/i.test(msg)) messages = compactMessages(messages, true);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const reply = (await forceFinalAnswer("Model berulang kali gagal.")) || "";
          return finish({ status: reply ? "done" : "failed", reply: reply || null, error: reply ? null : `AI gagal ${MAX_CONSECUTIVE_ERRORS}x: ${msg.slice(0, 200)}` });
        }
        continue;
      }

      const msg = completion.choices[0]?.message;
      if (!msg) { consecutiveErrors += 1; continue; }
      const calls = msg.tool_calls ?? [];

      // 5. Jawaban akhir.
      if (!calls.length) {
        let reply = stripThinking(msg.content);
        if (!reply) reply = await forceFinalAnswer("Jawaban kosong.");
        if (!reply) reply = `Saya sudah menjalankan ${toolsUsed.length} langkah (${Array.from(new Set(toolsUsed)).join(", ") || "-"}) tetapi belum sampai kesimpulan. Ketik "lanjut" atau persempit permintaan.`;
        if (attachments.length) reply += `\n\nFile siap diunduh: ${attachments.map((a) => `[${a.name}](${a.url})`).join(", ")}`;
        emit("Selesai.");
        return finish({ status: "done", reply });
      }

      // 6. Eksekusi tool.
      messages.push({ role: "assistant", content: stripThinking(msg.content), tool_calls: calls });
      let pending: PendingQuestion | null = null;
      for (const call of calls) {
        if (call.type !== "function") continue;
        const name = call.function.name;
        let args: Record<string, unknown> = {};
        try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
        toolsUsed.push(name);

        if (driver.askUserTool && name === driver.askUserTool) {
          pending = {
            question: String(args.question ?? "Mohon konteks tambahan."),
            options: Array.isArray(args.options) ? args.options.map(String).slice(0, 6) : undefined,
          };
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ ok: true, note: "Pertanyaan diteruskan ke user." }) });
          continue;
        }

        emit(driver.describeToolCall?.(name, args) || defaultDescribe(name, args), "tool");
        const t0 = Date.now();
        let result: unknown;
        try {
          result = await driver.runTool(name, args, { run: ref, emit: (text) => emit(text), attachments });
        } catch (err) {
          result = { error: err instanceof Error ? err.message : "Tool gagal." };
          emit(`${name} gagal: ${(err instanceof Error ? err.message : "").slice(0, 160)}`, "warn");
        }
        const secs = Math.round((Date.now() - t0) / 1000);
        if (secs >= 3) emit(`${name} selesai (${secs}s)`);
        messages.push({ role: "tool", tool_call_id: call.id, content: clipToolResult(result) });
      }

      stepCount += 1;
      await persistStep();

      if (pending) {
        emit(`Bertanya ke user: ${pending.question.slice(0, 120)}`);
        return finish({ status: "waiting_user", reply: stripThinking(msg.content) || pending.question, pendingQuestion: pending });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Kesalahan tak terduga.";
    console.error(`[agent-run ${runId}] loop error:`, message);
    emit(`Kesalahan: ${message.slice(0, 200)} — run disimpan, bisa dilanjutkan.`, "error");
    await flushing;
    await prisma.agentRun.updateMany({ where: { id: runId, lockToken: token }, data: { status: "queued", lockToken: null, error: message.slice(0, 500), events: events.slice(-EVENT_LIMIT) as unknown as Prisma.InputJsonValue } });
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

/** Kata kunci "lanjutkan saja" — tidak perlu ditambahkan sebagai pesan baru. */
export function isContinueKeyword(text: string) {
  return /^(lanjut(kan)?|terus(kan)?|continue|resume|ok(e|ay)?|go|ya|yes|sip|gas)\W*$/i.test(text.trim());
}
