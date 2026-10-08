/**
 * POST /api/laporan/sessions/[sessionId]/execute  { ignoreMinSources? }
 * → mulai job penulisan dari rencana yang sudah disetujui (tombol UI).
 */
import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { executeSession } from "@/lib/server/laporan/assistant";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const rl = enforceRateLimit(`laporan-execute:${auth.user.id}`, { limit: 5, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const body = await readJsonBody<{ ignoreMinSources?: unknown }>(req, 4 * 1024).catch((): { ignoreMinSources?: unknown } => ({}));
    const result = await executeSession(sessionId, auth.user.id, { ignoreMinSources: body?.ignoreMinSources === true });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    if (error instanceof Error) return NextResponse.json({ success: false, error: error.message }, { status: /tidak ditemukan/i.test(error.message) ? 404 : 400 });
    return publicErrorResponse(error, "Gagal memulai penulisan.");
  }
}
