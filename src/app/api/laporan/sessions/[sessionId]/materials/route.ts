/**
 * /api/laporan/sessions/[sessionId]/materials
 *   POST { kind, title, content, fileName? } → simpan bahan (hasil /api/context/extract atau catatan manual)
 *   DELETE { id } → hapus bahan
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { addSessionMaterial } from "@/lib/server/laporan/assistant";

export const runtime = "nodejs";
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
type Ctx = { params: Promise<{ sessionId: string }> };

const BodySchema = z.object({
  kind: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  content: z.string().min(1).max(120_000),
  fileName: z.string().max(200).optional(),
});

export async function POST(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const rl = enforceRateLimit(`laporan-material:${auth.user.id}`, { limit: 40, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 400 * 1024));
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });

    const item = await addSessionMaterial(sessionId, auth.user.id, parsed.data);
    await prisma.reportMessage.create({
      data: { sessionId, role: "user", content: `[Bahan diunggah: ${item.title} (${item.kind}, ${item.content.length} karakter)]` },
    });
    return NextResponse.json({ success: true, material: { id: item.id, kind: item.kind, title: item.title, fileName: item.fileName, chars: item.content.length } }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    if (error instanceof Error && /tidak ditemukan/i.test(error.message)) return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    return publicErrorResponse(error, "Gagal menyimpan bahan.");
  }
}

export async function DELETE(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;
    const body = await readJsonBody<{ id?: unknown }>(req, 4 * 1024);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ success: false, error: "id wajib." }, { status: 400 });

    const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId: auth.user.id }, select: { materials: true } });
    if (!row) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
    const materials = (Array.isArray(row.materials) ? row.materials : []).filter((m) => !(typeof m === "object" && m && (m as { id?: string }).id === id));
    await prisma.reportSession.update({ where: { id: sessionId }, data: { materials: materials as object[] } });
    return NextResponse.json({ success: true }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal menghapus bahan.");
  }
}
