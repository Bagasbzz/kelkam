/**
 * /api/laporan/sessions/[sessionId]/run
 * -----------------------------------------------------------------------------
 *   GET  → run aktif (queued/running/paused/waiting_user terakhir) untuk sesi ini,
 *          dipakai klien saat halaman dibuka untuk auto-attach.
 *   POST { runId, action: "continue" | "pause" | "cancel" | "resume" }
 *        continue/resume → stream NDJSON (lanjutkan/ikuti run)
 *        pause/cancel    → JSON run terbaru
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { controlAgentRun, findActiveAgentRun, getAgentRun } from "@/lib/server/agent-runs/engine";
import { streamAgentRun } from "@/lib/server/agent-runs/stream";

export const maxDuration = 120;
export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["continue", "pause", "cancel", "resume"]),
});

export async function GET(_req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;
    const run = await findActiveAgentRun(auth.user.id, "laporan", sessionId);
    return NextResponse.json({ success: true, run }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memuat status run.");
  }
}

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;
    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 4 * 1024));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Input tidak valid." }, { status: 400 });

    const run = await getAgentRun(parsed.data.runId, auth.user.id);
    if (!run || run.sessionId !== sessionId || run.kind !== "laporan") {
      return NextResponse.json({ success: false, error: "Run tidak ditemukan." }, { status: 404 });
    }

    if (parsed.data.action === "pause" || parsed.data.action === "cancel") {
      const updated = await controlAgentRun(run.id, auth.user.id, parsed.data.action);
      return NextResponse.json({ success: true, run: updated }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (parsed.data.action === "resume") await controlAgentRun(run.id, auth.user.id, "resume");
    return streamAgentRun(run.id, auth.user.id);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    console.error("laporan run POST failed:", error);
    return publicErrorResponse(error, "Gagal mengontrol run.");
  }
}
