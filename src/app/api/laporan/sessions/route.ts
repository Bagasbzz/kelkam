/**
 * /api/laporan/sessions
 *   GET  → daftar sesi Laporan milik user
 *   POST → buat sesi baru { title? }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const sessions = await prisma.reportSession.findMany({
    where: { ownerId: auth.user.id },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, stage: true, jobId: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json({ success: true, sessions }, NO_STORE);
}

export async function POST(req: Request) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

    const rl = enforceRateLimit(`laporan-session-create:${auth.user.id}`, { limit: 20, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const body = await readJsonBody<{ title?: unknown }>(req, 8 * 1024).catch((): { title?: unknown } => ({}));
    const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : null;

    const session = await prisma.reportSession.create({
      data: { ownerId: auth.user.id, title: title || null, brief: {}, sources: [], materials: [] },
      select: { id: true, title: true, stage: true, createdAt: true, updatedAt: true },
    });
    return NextResponse.json({ success: true, session }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    console.error("laporan sessions POST failed:", error);
    return publicErrorResponse(error, "Gagal membuat sesi.");
  }
}
