/**
 * src/lib/server/agent-runs/stream.ts
 * -----------------------------------------------------------------------------
 * Response NDJSON untuk run agent: heartbeat tiap 5 s (LiteSpeed tidak memutus
 * koneksi idle), event progres real-time, dan event `result` di akhir dengan
 * flag `continue` — klien otomatis menyambung ulang kalau run belum selesai.
 */
import { serveAgentRun, runNeedsContinue, type AgentStreamEvent } from "@/lib/server/agent-runs/engine";
import { toPublicErrorMessage } from "@/lib/errors";

/** Budget per segmen HTTP; di bawah batas 120 s hosting dengan sisa untuk jawaban. */
export const SEGMENT_BUDGET_MS = 95_000;

export function streamAgentRun(runId: string, ownerId: string, budgetMs = SEGMENT_BUDGET_MS): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: AgentStreamEvent) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { closed = true; }
      };
      const heartbeat = setInterval(() => write({ type: "status", phase: "heartbeat" }), 5_000);
      try {
        const run = await serveAgentRun(runId, ownerId, { budgetMs, emit: write });
        write({ type: "result", run, continue: runNeedsContinue(run) });
      } catch (err) {
        write({ type: "error", error: toPublicErrorMessage(err, "Run gagal. Coba lanjutkan lagi.") });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try { controller.close(); } catch { /* sudah ditutup */ }
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
