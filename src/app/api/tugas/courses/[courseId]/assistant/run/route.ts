/**
 * /api/tugas/courses/[courseId]/assistant/run
 * -----------------------------------------------------------------------------
 *   GET  ?sessionId=  → run aktif untuk sesi (auto-attach saat halaman dibuka)
 *   POST { runId, action: "continue" | "pause" | "cancel" | "resume" }
 *        continue/resume → stream NDJSON; pause/cancel → JSON run terbaru
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { controlAgentRun, findActiveAgentRun, getAgentRun } from "@/lib/server/agent-runs/engine";
import { streamAgentRun } from "@/lib/server/agent-runs/stream";

export const maxDuration = 120;
export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().min(1),
  action: z.enum(["continue", "pause", "cancel", "resume"]),
});

export async function GET(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const admin = await requireCourseAdmin(courseId);
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ success: false, error: "sessionId wajib." }, { status: 400 });
    const run = await findActiveAgentRun(admin.id, "tugas", sessionId);
    return NextResponse.json({ success: true, run }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memuat status run.");
  }
}

export async function POST(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const admin = await requireCourseAdmin(courseId);
    const rl = enforceRateLimit(`tugas-run:${admin.id}`, { limit: 300, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;
    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 4 * 1024));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Input tidak valid." }, { status: 400 });

    const run = await getAgentRun(parsed.data.runId, admin.id);
    if (!run || run.kind !== "tugas") return NextResponse.json({ success: false, error: "Run tidak ditemukan." }, { status: 404 });

    if (parsed.data.action === "pause" || parsed.data.action === "cancel") {
      const updated = await controlAgentRun(run.id, admin.id, parsed.data.action);
      return NextResponse.json({ success: true, run: updated }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (parsed.data.action === "resume") await controlAgentRun(run.id, admin.id, "resume");
    return streamAgentRun(run.id, admin.id);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    console.error("tugas assistant run POST failed:", error);
    return publicErrorResponse(error, "Gagal mengontrol run.");
  }
}
