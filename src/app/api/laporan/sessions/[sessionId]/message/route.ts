/**
 * POST /api/laporan/sessions/[sessionId]/message  { message, deep? }
 * → satu giliran asisten Laporan (tool-calling). Rate limit 40 / 10 menit.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { runReportAssistantTurn } from "@/lib/server/laporan/assistant";

export const maxDuration = 120;
export const runtime = "nodejs";

const BodySchema = z.object({
  message: z.string().trim().min(1, "Pesan kosong.").max(8000, "Pesan terlalu panjang."),
  deep: z.boolean().optional(),
});

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const rl = enforceRateLimit(`laporan-assistant:${auth.user.id}`, { limit: 40, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 48 * 1024));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });
    }

    const result = await runReportAssistantTurn({
      sessionId,
      ownerId: auth.user.id,
      message: parsed.data.message,
      deep: parsed.data.deep ?? false,
    });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    if (error instanceof Error && /tidak ditemukan/i.test(error.message)) return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    if (error instanceof Error && /timeout/i.test(error.message)) {
      return NextResponse.json({ success: false, error: "AI terlalu lama merespons. Coba kirim pesan yang lebih singkat." }, { status: 504 });
    }
    console.error("laporan assistant POST failed:", error);
    const e = error as Error & { status?: number };
    const detail = error instanceof Error ? `${typeof e.status === "number" ? `AI ${e.status}: ` : ""}${error.message.slice(0, 200)}` : "";
    return publicErrorResponse(error, `Asisten gagal memproses permintaan.${detail ? ` (${detail})` : ""}`);
  }
}
