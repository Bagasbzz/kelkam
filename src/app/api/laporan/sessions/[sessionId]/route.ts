/**
 * /api/laporan/sessions/[sessionId]
 *   GET    → state sesi (brief/plan/sources/materials/draft/job) + riwayat pesan
 *   PATCH  → update draft manual { draft } (hasil edit user) atau title
 *   DELETE → hapus sesi
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { getSessionState } from "@/lib/server/laporan/assistant";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, context: Ctx) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { sessionId } = await context.params;

  const found = await getSessionState(sessionId, auth.user.id);
  if (!found) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });

  const messages = await prisma.reportMessage.findMany({
    where: { sessionId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
  });

  const { state, job } = found;
  return NextResponse.json({
    success: true,
    session: {
      id: state.id,
      title: state.title,
      stage: state.stage,
      brief: state.brief,
      plan: state.plan,
      sources: state.sources,
      materials: state.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, fileName: m.fileName, chars: m.content.length })),
      jobId: state.jobId,
      draft: state.draft,
    },
    job,
    messages,
  }, NO_STORE);
}

export async function PATCH(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const body = await readJsonBody<{ draft?: unknown; title?: unknown }>(req, 1_500_000);
    const data: { draft?: string; title?: string } = {};
    if (typeof body.draft === "string") data.draft = body.draft.slice(0, 1_200_000);
    if (typeof body.title === "string") data.title = body.title.trim().slice(0, 120);
    if (!Object.keys(data).length) return NextResponse.json({ success: false, error: "Tidak ada perubahan." }, { status: 400 });

    const result = await prisma.reportSession.updateMany({ where: { id: sessionId, ownerId: auth.user.id }, data });
    if (!result.count) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ success: true }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal menyimpan.");
  }
}

export async function DELETE(_req: Request, context: Ctx) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { sessionId } = await context.params;
  const result = await prisma.reportSession.deleteMany({ where: { id: sessionId, ownerId: auth.user.id } });
  if (!result.count) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ success: true }, NO_STORE);
}
