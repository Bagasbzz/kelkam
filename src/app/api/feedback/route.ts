/**
 * POST /api/feedback  { feature, targetId, rating: 1 | -1, comment? }
 * -----------------------------------------------------------------------------
 * Feedback sengaja dari pengguna (Tahap 3). Satu penilaian per pengguna per jawaban (upsert).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { assertSameOriginJsonRequest } from "@/lib/server/csrf-origin";

export const dynamic = "force-dynamic";

const schema = z.object({
  feature: z.enum(["laporan", "presentasi"]),
  targetId: z.string().trim().min(1).max(120),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(500).optional(),
}).strict();

export async function POST(req: Request) {
  try {
    assertSameOriginJsonRequest(req);
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const limited = enforceRateLimit(`feedback:${auth.user.id}`, { limit: 30, windowMs: 60_000 });
    if (limited) return limited;
    const input = schema.parse(await readJsonBody(req, 4096));
    const data = { rating: input.rating, comment: input.comment || null };
    try {
      await prisma.feedback.upsert({
        where: { userId_feature_targetId: { userId: auth.user.id, feature: input.feature, targetId: input.targetId } },
        create: { userId: auth.user.id, feature: input.feature, targetId: input.targetId, ...data },
        update: data,
      });
    } catch (error) {
      // Tabel belum dibuat (SQL hotfix belum dijalankan): jangan ganggu pengguna.
      console.warn("[feedback] tidak tersimpan:", error instanceof Error ? error.message.slice(0, 160) : error);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return publicErrorResponse(error, "Masukan gagal dikirim.");
  }
}
