/**
 * /api/tugas/courses/[courseId]/assistant
 * -----------------------------------------------------------------------------
 * Admin AI chatbot untuk 1 course (tool-calling atas data tugas/submission).
 *
 *   POST body { message, sessionId?, answerTo?, deep? }
 *        → NDJSON stream progres agent run (header x-run-id, x-session-id);
 *          event terakhir `result{run, continue}`. Lanjutkan via ./assistant/run.
 *   GET  ?sessionId=   → riwayat pesan sesi
 *   GET  (tanpa param) → daftar sesi admin ini di course ini
 *
 * Auth: requireCourseAdmin. Rate limit 40 giliran / 10 menit per admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { startTugasAssistantRun } from "@/lib/server/tugas/assistant";
import { streamAgentRun } from "@/lib/server/agent-runs/stream";

export const maxDuration = 120;
export const runtime = "nodejs";

const BodySchema = z.object({
  message: z.string().trim().min(1, "Pesan kosong.").max(6000, "Pesan terlalu panjang."),
  sessionId: z.string().min(1).nullable().optional(),
  answerTo: z.string().max(2000).nullable().optional(),
  deep: z.boolean().optional(),
});

export async function POST(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const admin = await requireCourseAdmin(courseId);

    const rl = enforceRateLimit(`tugas-assistant:${admin.id}`, { limit: 40, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const body = await readJsonBody<unknown>(req, 32 * 1024);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });
    }

    const { runId, sessionId } = await startTugasAssistantRun({
      courseId,
      adminId: admin.id,
      sessionId: parsed.data.sessionId ?? null,
      message: parsed.data.message,
      answerTo: parsed.data.answerTo ?? null,
      deep: parsed.data.deep ?? false,
    });

    const res = streamAgentRun(runId, admin.id);
    res.headers.set("x-run-id", runId);
    res.headers.set("x-session-id", sessionId);
    return res;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    if (error instanceof Error && /timeout/i.test(error.message)) {
      return NextResponse.json({ success: false, error: "AI terlalu lama merespons. Coba persempit permintaan." }, { status: 504 });
    }
    console.error("API tugas assistant POST failed:", error);
    // Endpoint khusus admin: tampilkan penyebab (status provider / kode Prisma) agar bisa didiagnosis.
    const detail = describeAssistantError(error);
    return publicErrorResponse(error, `Asisten gagal memproses permintaan.${detail ? ` (${detail})` : ""}`);
  }
}

function describeAssistantError(error: unknown): string {
  if (!(error instanceof Error)) return "";
  const e = error as Error & { status?: number; code?: string };
  const parts: string[] = [];
  if (typeof e.status === "number") parts.push(`AI ${e.status}`);
  if (typeof e.code === "string") parts.push(`kode ${e.code}`);
  parts.push(e.message.replace(/\s+/g, " ").slice(0, 220));
  return parts.join(": ");
}

export async function GET(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const admin = await requireCourseAdmin(courseId);
    const sessionId = new URL(req.url).searchParams.get("sessionId");

    if (sessionId) {
      const session = await prisma.adminChatSession.findFirst({
        where: { id: sessionId, courseId, userId: admin.id },
        select: { id: true, title: true, memory: true, createdAt: true },
      });
      if (!session) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
      const messages = await prisma.adminChatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
        take: 200,
      });
      return NextResponse.json({ success: true, session, messages });
    }

    const sessions = await prisma.adminChatSession.findMany({
      where: { courseId, userId: admin.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, updatedAt: true, _count: { select: { messages: true } } },
      take: 30,
    });
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API tugas assistant GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat sesi.");
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const admin = await requireCourseAdmin(courseId);
    const sessionId = new URL(req.url).searchParams.get("sessionId");
    if (!sessionId) return NextResponse.json({ success: false, error: "sessionId wajib." }, { status: 400 });
    await prisma.adminChatSession.deleteMany({ where: { id: sessionId, courseId, userId: admin.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    return publicErrorResponse(error, "Gagal menghapus sesi.");
  }
}
