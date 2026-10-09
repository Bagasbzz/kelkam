/**
 * src/lib/client/agent-run.ts
 * -----------------------------------------------------------------------------
 * Pembaca stream NDJSON agent run + loop sambung-ulang otomatis.
 * Dipakai Asisten Laporan (/dashboard) dan Asisten Dosen (tugas).
 */
"use client";

import { authenticatedFetch } from "@/components/AuthProvider";

export type AgentRunStatus = "queued" | "running" | "paused" | "waiting_user" | "done" | "failed" | "cancelled";
export interface AgentEvent { t: string; text: string; level?: "info" | "warn" | "error" | "tool" }
export interface AgentAttachment { fileId: string; name: string; url: string; size: number }
export interface AgentRunPublic {
  id: string;
  kind: "laporan" | "tugas";
  sessionId: string;
  status: AgentRunStatus;
  model: string;
  stepCount: number;
  maxSteps: number;
  events: AgentEvent[];
  toolsUsed: string[];
  attachments: AgentAttachment[];
  pendingQuestion: { question: string; options?: string[] } | null;
  reply: string | null;
  error: string | null;
  idleSeconds: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}

export type AgentStreamEvent =
  | { type: "run"; run: AgentRunPublic }
  | { type: "event"; event: AgentEvent }
  | { type: "status"; phase: "heartbeat" }
  | { type: "result"; run: AgentRunPublic; continue: boolean }
  | { type: "error"; error: string };

export interface RunObserver {
  onRun?: (run: AgentRunPublic) => void;
  onEvent?: (event: AgentEvent) => void;
  onHeartbeat?: () => void;
}

export const RUN_LIVE: readonly AgentRunStatus[] = ["queued", "running"];
export function isRunLive(status: AgentRunStatus) { return RUN_LIVE.includes(status); }

/** Baca satu respons NDJSON sampai `result`/`error`/EOF. */
export async function readRunStream(res: Response, obs: RunObserver, signal?: AbortSignal): Promise<{ run: AgentRunPublic | null; continue: boolean; error: string | null }> {
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* bukan JSON */ }
    return { run: null, continue: false, error: msg };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let last: AgentRunPublic | null = null;
  let cont = false;
  let error: string | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: AgentStreamEvent;
    try { ev = JSON.parse(line) as AgentStreamEvent; } catch { return; }
    switch (ev.type) {
      case "run": last = ev.run; obs.onRun?.(ev.run); break;
      case "event": obs.onEvent?.(ev.event); break;
      case "status": obs.onHeartbeat?.(); break;
      case "result": last = ev.run; cont = ev.continue; obs.onRun?.(ev.run); break;
      case "error": error = ev.error; break;
    }
  };
  try {
    while (true) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    }
    if (buf.trim()) handle(buf);
  } catch (err) {
    if (!signal?.aborted) error = err instanceof Error ? err.message : "Koneksi terputus.";
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return { run: last, continue: cont, error };
}

/**
 * Jalankan run sampai selesai: baca stream pertama, lalu sambung ulang via
 * `continueUrl` selama server bilang `continue` atau koneksi putus saat run
 * masih hidup. Mencoba ulang dengan backoff ringan (maks `maxRetries` gagal beruntun).
 */
export async function followRun(opts: {
  first: () => Promise<Response>;
  continueUrl: string;
  /** Id run; boleh getter karena id baru diketahui dari event `run` pertama. */
  runId: string | (() => string);
  observer: RunObserver;
  signal?: AbortSignal;
  maxRetries?: number;
}): Promise<AgentRunPublic | null> {
  const maxRetries = opts.maxRetries ?? 6;
  const getRunId = () => (typeof opts.runId === "function" ? opts.runId() : opts.runId);
  let failures = 0;
  let last: AgentRunPublic | null = null;
  let res = await opts.first();

  while (true) {
    const out = await readRunStream(res, opts.observer, opts.signal);
    if (out.run) last = out.run;
    if (opts.signal?.aborted) return last;

    const live = last ? isRunLive(last.status) : true;
    if (out.error) {
      failures += 1;
      if (!live || failures > maxRetries) throw new Error(out.error);
      await sleep(Math.min(1_500 * failures, 8_000));
    } else {
      failures = 0;
      if (!out.continue && !live) return last;
    }
    if (opts.signal?.aborted) return last;
    const runId = getRunId();
    if (!runId) throw new Error(out.error || "Run tidak dimulai.");
    // Sambung ulang.
    res = await authenticatedFetch(opts.continueUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, action: "continue" }),
      signal: opts.signal,
    });
  }
}

export async function controlRun(url: string, runId: string, action: "pause" | "cancel"): Promise<AgentRunPublic | null> {
  const res = await authenticatedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, action }),
  });
  const j = await res.json().catch(() => null);
  return (j?.run as AgentRunPublic | null) ?? null;
}

export async function fetchActiveRun(url: string): Promise<AgentRunPublic | null> {
  const res = await authenticatedFetch(url, { cache: "no-store" });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  return (j?.run as AgentRunPublic | null) ?? null;
}

/** Status manusiawi untuk badge progres. */
export function describeRunStatus(run: AgentRunPublic | null): string {
  if (!run) return "Menghubungkan…";
  switch (run.status) {
    case "queued": return "Antre — melanjutkan…";
    case "running": return `Berjalan (langkah ${run.stepCount}/${run.maxSteps})`;
    case "paused": return "Dijeda — ketik \"lanjut\" untuk meneruskan";
    case "waiting_user": return "Menunggu jawaban Anda";
    case "done": return "Selesai";
    case "failed": return "Gagal";
    case "cancelled": return "Dihentikan";
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
