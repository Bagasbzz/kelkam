/**
 * POST /api/files/upload-video
 * -----------------------------------------------------------------------------
 * Upload VIDEO khusus admin (role ADMIN), TANPA batas ukuran aplikasi.
 *
 * Beda dengan /api/files/upload:
 *   - Hanya role ADMIN (video dipakai sebagai lampiran tugas, bukan submission).
 *   - Tidak ada MAX_FILE_BYTES.
 *   - Body dikirim RAW (bukan multipart): `req.body` adalah ReadableStream
 *     sejati, di-pipe langsung ke disk sambil dihitung SHA256. `req.formData()`
 *     sengaja TIDAK dipakai karena menahan seluruh file di memori.
 *   - Metadata lewat header:
 *       Content-Type : MIME video (video/mp4, dll)
 *       X-File-Name  : nama file asli, URL-encoded (encodeURIComponent)
 *   - MIME wajib video/* yang bisa diputar browser (lihat VIDEO_MIME_RE).
 *
 * Batas efektif tetap ditentukan infrastruktur (LiteSpeed/Apache body limit,
 * disk quota cPanel), bukan oleh kode ini.
 *
 * Response: 200 { success: true, data: { fileId, sha256, deduplicated, size, mime } }
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { IncompleteUploadError, InvalidSignatureError, saveUploadFromStream } from "@/lib/storage/upload";
import { VIDEO_MIME_RE } from "@/lib/server/tugas/attachments";

export const runtime = "nodejs";

/** Video besar butuh waktu; 15 menit cukup untuk koneksi lambat. */
export const maxDuration = 900;

/**
 * Cek magic bytes container video. Mencegah file non-video (HTML, EXE, dll)
 * diunggah dengan nama/MIME video lalu di-serve publik.
 */
function looksLikeVideo(head: Buffer): boolean {
  if (head.length < 12) return false;
  const ascii = (start: number, end: number) => head.subarray(start, end).toString("latin1");
  // MP4 / MOV / M4V / 3GP: box "ftyp" (atau "moov"/"mdat"/"wide"/"free" untuk MOV lama) di offset 4.
  if (["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 8))) return true;
  // WebM / MKV: EBML header 1A 45 DF A3.
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  // AVI: "RIFF....AVI ".
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return true;
  // OGG/OGV: "OggS".
  if (ascii(0, 4) === "OggS") return true;
  return false;
}

/** Tebak MIME video dari ekstensi kalau browser kirim kosong/octet-stream. */
function guessVideoMime(name: string, provided: string): string {
  const base = provided.split(";")[0].trim().toLowerCase();
  if (VIDEO_MIME_RE.test(base)) return base;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    "3gp": "video/3gpp",
  };
  return map[ext] ?? base;
}

function decodeFileName(raw: string | null): string {
  if (!raw) return "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* pakai apa adanya */
  }
  return name.replace(/[\r\n\\/]/g, "").trim().slice(0, 200);
}

export async function POST(req: Request) {
  try {
    const user = await requireAdmin();

    const rateLimit = enforceRateLimit(`files-upload-video:${user.id}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (rateLimit) return rateLimit;

    const name = decodeFileName(req.headers.get("x-file-name"));
    if (!name) throw new ApiRequestError(400, "Nama file tidak valid (header X-File-Name).");

    const mime = guessVideoMime(name, req.headers.get("content-type") || "");
    if (!VIDEO_MIME_RE.test(mime)) {
      throw new ApiRequestError(400, "Hanya file video (MP4/WebM/MOV/MKV/AVI) yang boleh diunggah lewat endpoint ini.");
    }

    if (!req.body) throw new ApiRequestError(400, "File tidak ditemukan.");

    // Ukuran asli file dari klien: dipakai memastikan file tidak terpotong di jalan
    // (proxy/reverse-proxy yang memangkas body akan terdeteksi dan ditolak).
    const expectedSize = Number(req.headers.get("x-file-size") || req.headers.get("content-length") || "");
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
      throw new ApiRequestError(400, "Ukuran file tidak diketahui (header X-File-Size).");
    }

    let upload;
    try {
      upload = await saveUploadFromStream({
        ownerId: user.id,
        stream: req.body,
        originalName: name,
        mime,
        expectedSize,
        validateHead: looksLikeVideo,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "File kosong.") {
        throw new ApiRequestError(400, "File kosong.");
      }
      if (error instanceof InvalidSignatureError) {
        throw new ApiRequestError(415, "Isi file bukan video yang valid (MP4/MOV/WebM/MKV/AVI/OGG).");
      }
      if (error instanceof IncompleteUploadError) {
        console.error(`upload-video terpotong: ${error.received}/${error.expected} byte (${name})`);
        throw new ApiRequestError(
          413,
          `Upload video tidak lengkap (diterima ${Math.round(error.received / 1048576)} MB dari ${Math.round(error.expected / 1048576)} MB). Batas ukuran body server hosting terlampaui; coba lagi atau hubungi pengelola server.`,
        );
      }
      throw error;
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          fileId: upload.id,
          sha256: upload.sha256,
          deduplicated: upload.deduplicated,
          size: upload.size,
          mime,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/files/upload-video failed:", error);
    return publicErrorResponse(error, "Gagal mengunggah video.");
  }
}
