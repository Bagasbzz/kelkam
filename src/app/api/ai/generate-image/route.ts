/**
 * /api/ai/generate-image
 * -----------------------------------------------------------------------------
 * POST { prompt, title?, sessionId? } → buat job gambar, kembalikan { job }.
 * GET  ?sessionId=…                   → daftar job milik user (opsional filter).
 *
 * Generate gambar butuh 1.5-2.5 menit, jadi endpoint ini TIDAK menunggu
 * hasil. Klien polling GET /api/ai/generate-image/[jobId] sampai status done,
 * lalu tampilkan `url` (/api/files/<fileId>).
 * Rate limit 10 job / 10 menit per user.
 * -----------------------------------------------------------------------------
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAiConfigured } from "@/lib/ai/client";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { listImageJobs, startImageJob } from "@/lib/server/image-jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

const BodySchema = z.object({
  prompt: z.string().trim().min(8, "Deskripsi gambar terlalu pendek.").max(4000, "Deskripsi gambar terlalu panjang."),
  title: z.string().trim().max(160).optional(),
  sessionId: z.string().trim().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    assertAiConfigured();

    const rl = enforceRateLimit(`generate-image:${auth.user.id}`, { limit: 10, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 16 * 1024));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });
    }

    const job = await startImageJob({ ownerId: auth.user.id, ...parsed.data });
    return NextResponse.json({ success: true, job }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    if (error instanceof Error && /sedang diproses/i.test(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 429 });
    }
    console.error("API /api/ai/generate-image POST failed:", error);
    return publicErrorResponse(error, "Gagal membuat permintaan gambar.");
  }
}

export async function GET(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const sessionId = new URL(req.url).searchParams.get("sessionId") || undefined;
  const jobs = await listImageJobs(auth.user.id, { sessionId });
  return NextResponse.json({ success: true, jobs }, { headers: { "Cache-Control": "no-store" } });
}
