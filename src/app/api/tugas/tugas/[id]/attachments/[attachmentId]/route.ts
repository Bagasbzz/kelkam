/**
 * GET /api/tugas/tugas/[id]/attachments/[attachmentId]?token=XXXX
 * -----------------------------------------------------------------------------
 * Stream file lampiran tugas (screenshot output yang diharapkan, file contoh).
 *
 * Akses PUBLIK berbasis token course (sama seperti materi kuliah): mahasiswa
 * tidak harus login untuk melihat lampiran. Keamanan:
 *   - token wajib cocok dengan course pemilik tugas (anti enumerasi id);
 *   - rate limit per IP (lihat proxy.ts: endpoint ini di-bypass gateway auth);
 *   - gambar dikirim inline (untuk <img>), file lain sebagai attachment;
 *   - nama file disanitasi + nosniff.
 */
import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { IMAGE_MIME_RE } from "@/lib/server/tugas/attachments";

export const runtime = "nodejs";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  try {
    const { id: tugasId, attachmentId } = await context.params;
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim().toUpperCase();
    if (!token) throw new ApiRequestError(400, "Token course wajib diisi.");

    // Rate limit per IP: lampiran dipanggil berulang oleh <img> saat halaman dibuka.
    const limited = enforceRateLimit(`tugas-attachment:${clientIp(req)}`, { limit: 120, windowMs: 60_000 });
    if (limited) return limited;

    const att = await prisma.tugasAttachment.findFirst({
      where: { id: attachmentId, tugasId, tugas: { course: { token } } },
      select: {
        fileUpload: { select: { filePath: true, originalName: true, mime: true, size: true } },
      },
    });
    if (!att) throw new ApiRequestError(404, "Lampiran tidak ditemukan.");

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(att.fileUpload.filePath);
    } catch {
      throw new ApiRequestError(404, "File lampiran tidak tersedia.");
    }

    const mime = att.fileUpload.mime || "application/octet-stream";
    const isImage = IMAGE_MIME_RE.test(mime);
    const safeName = att.fileUpload.originalName.replace(/[\\/\r\n"\x00-\x1f]/g, "_") || "lampiran";
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(buffer.byteLength),
        // Gambar tampil inline di <img>; dokumen diunduh.
        "Content-Disposition": `${isImage ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        // Lampiran bisa di-cache sebentar di browser (URL unik per attachment).
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET tugas attachment failed:", error);
    return publicErrorResponse(error, "Gagal mengambil lampiran.");
  }
}
