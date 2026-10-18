/**
 * GET /api/tugas/tugas/[id]/attachments/[attachmentId]?token=XXXX[&download=1]
 * -----------------------------------------------------------------------------
 * Stream file lampiran tugas (screenshot output yang diharapkan, video
 * penjelasan, file contoh).
 *
 * Akses PUBLIK berbasis token course (sama seperti materi kuliah): mahasiswa
 * tidak harus login untuk melihat/mengunduh lampiran. Keamanan:
 *   - token wajib cocok dengan course pemilik tugas (anti enumerasi id);
 *   - rate limit per IP (lihat proxy.ts: endpoint ini di-bypass gateway auth);
 *   - gambar & video dikirim inline (untuk <img>/<video>), file lain attachment;
 *   - `?download=1` memaksa Content-Disposition: attachment (tombol unduh);
 *   - nama file disanitasi + nosniff.
 *
 * File di-stream dari disk (bukan readFile) dan mendukung HTTP Range, supaya
 * video besar bisa di-seek oleh <video> tanpa membebani memori server.
 */
import { createReadStream, promises as fs } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { IMAGE_MIME_RE, VIDEO_MIME_RE } from "@/lib/server/tugas/attachments";

export const runtime = "nodejs";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "unknown";
}

/** Parse header `Range: bytes=start-end` (hanya satu range yang didukung). */
function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return "invalid";
  const [, s, e] = m;
  if (s === "" && e === "") return "invalid";
  let start: number;
  let end: number;
  if (s === "") {
    // Suffix range: bytes=-500 → 500 byte terakhir.
    const suffix = Number(e);
    if (suffix <= 0) return "invalid";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "invalid";
  return { start, end };
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
    const forceDownload = url.searchParams.get("download") === "1";

    // Rate limit per IP: lampiran dipanggil berulang oleh <img>/<video> (range request).
    const limited = enforceRateLimit(`tugas-attachment:${clientIp(req)}`, { limit: 300, windowMs: 60_000 });
    if (limited) return limited;

    const att = await prisma.tugasAttachment.findFirst({
      where: { id: attachmentId, tugasId, tugas: { course: { token } } },
      select: {
        fileUpload: { select: { filePath: true, originalName: true, mime: true, size: true } },
      },
    });
    if (!att) throw new ApiRequestError(404, "Lampiran tidak ditemukan.");

    let size: number;
    try {
      size = (await fs.stat(att.fileUpload.filePath)).size;
    } catch {
      throw new ApiRequestError(404, "File lampiran tidak tersedia.");
    }

    const mime = att.fileUpload.mime || "application/octet-stream";
    const inline = !forceDownload && (IMAGE_MIME_RE.test(mime) || VIDEO_MIME_RE.test(mime));
    const safeName = att.fileUpload.originalName.replace(/[\\/\r\n"\x00-\x1f]/g, "_") || "lampiran";
    const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");

    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      // Lampiran bisa di-cache sebentar di browser (URL unik per attachment).
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Accept-Ranges": "bytes",
    };

    const range = parseRange(req.headers.get("range"), size);
    if (range === "invalid") {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }

    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    headers["Content-Length"] = String(end - start + 1);
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;

    if (req.method === "HEAD") return new NextResponse(null, { status: range ? 206 : 200, headers });

    const nodeStream = createReadStream(att.fileUpload.filePath, { start, end });
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    return new NextResponse(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET tugas attachment failed:", error);
    return publicErrorResponse(error, "Gagal mengambil lampiran.");
  }
}

/** HEAD dipakai browser untuk cek ukuran/Range sebelum memutar video. */
export const HEAD = GET;
