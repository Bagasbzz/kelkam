/**
 * POST /api/client-errors
 * -----------------------------------------------------------------------------
 * Catatan kegagalan dari browser (diagnostik), mis. mahasiswa gagal
 * mengumpulkan tugas karena "Koneksi ke server terputus".
 *
 * Tujuan: admin bisa melihat POLA kegagalan (perangkat, browser, jenis
 * jaringan, ukuran file, tahap yang gagal) lewat log aplikasi di cPanel,
 * tanpa harus menebak dari laporan lisan.
 *
 * Desain:
 *   - Publik (tidak wajib login): error bisa terjadi justru saat sesi habis.
 *     userId dicatat kalau cookie sesi valid.
 *   - Tidak menyimpan ke DB (tanpa migrasi). Ditulis ke stdout sebagai satu
 *     baris JSON berprefix `[client-error]` → terlihat di log Passenger/cPanel.
 *   - Rate limit per IP + body dibatasi kecil + semua field dipotong/disaring
 *     supaya tidak bisa dipakai untuk membanjiri log.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/server/auth";
import { enforceRateLimit, readJsonBody } from "@/lib/server/request-guards";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4_096;

/** Potong & buang karakter kontrol supaya satu laporan = satu baris log. */
const shortText = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/[\u0000-\u001F\u007F]+/g, " ").slice(0, max))
    .optional()
    .nullable();

const ReportSchema = z.object({
  stage: z.string().regex(/^[a-z-]{1,30}$/),
  kind: z.enum(["offline", "network", "timeout", "http", "file-read"]).optional(),
  status: z.number().int().min(0).max(999).optional(),
  message: shortText(300),
  tugasId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  fileSize: z.number().int().min(0).max(10 * 1024 * 1024 * 1024).optional(),
  fileType: shortText(100),
  online: z.boolean().nullable().optional(),
  connection: shortText(20),
  path: shortText(200),
});

function clientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limited = enforceRateLimit(`client-errors:${ip}`, { limit: 30, windowMs: 10 * 60 * 1000 });
  // Saat dibatasi, cukup diam (204) — klien tidak butuh tahu.
  if (limited) return new NextResponse(null, { status: 204 });

  let report: z.infer<typeof ReportSchema>;
  try {
    const parsed = ReportSchema.safeParse(await readJsonBody<unknown>(req, MAX_BODY_BYTES));
    if (!parsed.success) return new NextResponse(null, { status: 204 });
    report = parsed.data;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // userId opsional; kegagalan baca sesi tidak boleh membatalkan pencatatan.
  const user = await getCurrentUser().catch(() => null);

  console.warn(
    "[client-error]",
    JSON.stringify({
      at: new Date().toISOString(),
      userId: user?.id ?? null,
      ip,
      ua: (req.headers.get("user-agent") || "").slice(0, 250),
      ...report,
    }),
  );

  return new NextResponse(null, { status: 204 });
}
