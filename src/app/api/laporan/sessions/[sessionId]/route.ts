/**
 * /api/laporan/sessions/[sessionId]
 *   GET    → state sesi (brief/plan/sources/materials/draft/job) + riwayat pesan
 *   PATCH  → update draft manual { draft } (hasil edit user), title, atau
 *            centang sumber { sources: [{ id, selected }] }
 *   DELETE → hapus sesi
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { getSessionState } from "@/lib/server/laporan/assistant";
import { listImageJobs } from "@/lib/server/image-jobs";
import type { VerifiedSource } from "@/lib/references/find-sources";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, context: Ctx) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { sessionId } = await context.params;

  const found = await getSessionState(sessionId, auth.user.id);
  if (!found) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });

  const [messages, figures] = await Promise.all([
    prisma.reportMessage.findMany({
      where: { sessionId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
    }),
    listImageJobs(auth.user.id, { sessionId, limit: 30 }),
  ]);

  const { state, job } = found;
  return NextResponse.json({
    success: true,
    session: {
      id: state.id,
      title: state.title,
      stage: state.stage,
      brief: state.brief,
      plan: state.plan,
      // fullText tidak dikirim ke klien (besar); cukup jumlah karakternya.
      sources: state.sources.map((s) => {
        const copy: VerifiedSource = { ...s };
        delete copy.fullText;
        return copy;
      }),
      materials: state.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, fileName: m.fileName, chars: m.content.length })),
      jobId: state.jobId,
      draft: state.draft,
    },
    job,
    figures,
    messages,
  }, NO_STORE);
}

export async function PATCH(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const body = await readJsonBody<{ draft?: unknown; title?: unknown; sources?: unknown }>(req, 1_500_000);
    const data: { draft?: string; title?: string; sources?: object } = {};
    if (typeof body.draft === "string") data.draft = body.draft.slice(0, 1_200_000);
    if (typeof body.title === "string") data.title = body.title.trim().slice(0, 120);
    if (Array.isArray(body.sources)) {
      // Centang/lepas centang sumber: hanya field `selected` yang boleh diubah klien.
      const toggles = new Map<string, boolean>();
      for (const item of body.sources.slice(0, 200)) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          toggles.set((item as { id: string }).id, (item as { selected?: unknown }).selected !== false);
        }
      }
      if (toggles.size) {
        const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId: auth.user.id }, select: { sources: true } });
        if (!row) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
        const sources = (Array.isArray(row.sources) ? row.sources : []) as unknown as VerifiedSource[];
        data.sources = sources.map((s) => (toggles.has(s.id) ? { ...s, selected: toggles.get(s.id) } : s));
      }
    }
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
