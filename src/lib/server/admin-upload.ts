/**
 * Handler upload RAW khusus admin (tanpa batas ukuran aplikasi).
 * Dipakai oleh /api/files/upload-admin dan /api/files/upload-video.
 *
 * Desain:
 *   - Body RAW (bukan multipart): `req.body` di-pipe langsung ke disk sambil
 *     dihitung SHA256 → file ratusan MB / GB tidak ditahan di memori.
 *   - Route pemakai WAJIB dikecualikan dari matcher proxy.ts. Kalau tidak,
 *     Next.js meng-clone body dengan batas `proxyClientMaxBodySize` dan
 *     memotong file diam-diam.
 *   - Metadata via header:
 *       Content-Type : MIME file
 *       X-File-Name  : nama file asli (encodeURIComponent)
 *       X-File-Size  : ukuran asli (bytes) → upload terpotong ditolak
 *
 * Keamanan:
 *   - Hanya role ADMIN (requireAdmin) + rate limit per user.
 *   - Ekstensi executable/skrip diblokir (lihat file-types.ts).
 *   - MIME aktif (HTML/SVG/JS/XML) disimpan sebagai octet-stream.
 *   - Gambar/video wajib lolos cek magic bytes (hanya tipe ini yang di-serve inline).
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { IncompleteUploadError, InvalidSignatureError, saveUploadFromStream } from "@/lib/storage/upload";
import { BLOCKED_FILE_MESSAGE, headMatchesMime, isBlockedFileName, resolveMime } from "@/lib/security/file-types";
import { isSensitivePath } from "@/lib/security/redact-secrets";

export function decodeUploadFileName(raw: string | null): string {
  if (!raw) return "";
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* pakai apa adanya */
  }
  return name.replace(/[\r\n\\/\x00-\x1f]/g, "").trim().slice(0, 200);
}

export async function handleAdminRawUpload(
  req: Request,
  options: { requireMime?: RegExp; requireMimeMessage?: string } = {},
): Promise<Response> {
  try {
    const user = await requireAdmin();

    const rateLimit = enforceRateLimit(`files-upload-admin:${user.id}`, {
      limit: 60,
      windowMs: 10 * 60 * 1000,
    });
    if (rateLimit) return rateLimit;

    const name = decodeUploadFileName(req.headers.get("x-file-name"));
    if (!name) throw new ApiRequestError(400, "Nama file tidak valid (header X-File-Name).");
    if (isBlockedFileName(name)) throw new ApiRequestError(415, BLOCKED_FILE_MESSAGE);
    if (isSensitivePath(name)) throw new ApiRequestError(400, "File rahasia atau credential tidak boleh diunggah.");

    const mime = resolveMime(name, req.headers.get("content-type"));
    if (options.requireMime && !options.requireMime.test(mime)) {
      throw new ApiRequestError(400, options.requireMimeMessage || "Tipe file tidak sesuai.");
    }

    const expectedSize = Number(req.headers.get("x-file-size") || req.headers.get("content-length") || "");
    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
      throw new ApiRequestError(400, "Ukuran file tidak diketahui (header X-File-Size).");
    }
    if (!req.body) throw new ApiRequestError(400, "File tidak ditemukan.");

    let upload;
    try {
      upload = await saveUploadFromStream({
        ownerId: user.id,
        stream: req.body,
        originalName: name,
        mime,
        expectedSize,
        validateHead: (head) => headMatchesMime(mime, head),
      });
    } catch (error) {
      if (error instanceof Error && error.message === "File kosong.") {
        throw new ApiRequestError(400, "File kosong.");
      }
      if (error instanceof InvalidSignatureError) {
        throw new ApiRequestError(415, `Isi file "${name}" tidak sesuai dengan tipenya (${mime}).`);
      }
      if (error instanceof IncompleteUploadError) {
        console.error(`upload-admin terpotong: ${error.received}/${error.expected} byte (${name})`);
        throw new ApiRequestError(
          413,
          `Upload tidak lengkap (diterima ${Math.round(error.received / 1048576)} MB dari ${Math.round(error.expected / 1048576)} MB). Koneksi terputus atau batas body server hosting terlampaui; coba lagi.`,
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
    console.error("Admin raw upload failed:", error);
    return publicErrorResponse(error, "Gagal mengunggah file.");
  }
}
