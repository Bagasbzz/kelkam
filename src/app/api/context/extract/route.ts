/**
 * POST /api/context/extract
 * -----------------------------------------------------------------------------
 * Upload & extract text dari berbagai format file bahan (Studio/Laporan):
 *   - Dokumen: PDF, DOCX, PPTX, XLSX, ZIP, teks/kode
 *   - Gambar : PNG/JPEG/WebP/GIF → deskripsi + OCR via model vision
 * Logika ekstraksi ada di src/lib/server/extract-text.ts & extract-image.ts.
 *
 * Flow:
 *   1. Auth + rate limit (8 per 10 menit, extraction mahal).
 *   2. Parse multipart form, validasi size & nama (12 MB user; admin lebih longgar).
 *   3. Ekstrak via lib (gambar dideteksi dari magic bytes, bukan ekstensi saja).
 *   4. Save file ke disk (SHA256 dedup) hanya bila ekstraksi sukses.
 *
 * Response: 200 { success, data: { title, fileName, kind, content, charCount, fileId, sha256 } }
 *   400 nama/sensitif · 413 terlalu besar · 415 format · 422 tanpa teks · 429 rate limit
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import {
  ApiRequestError,
  enforceRateLimit,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import { isSensitivePath } from "@/lib/security/redact-secrets";
import { BLOCKED_FILE_MESSAGE, isBlockedFileName, resolveMime } from "@/lib/security/file-types";
import { saveUpload } from "@/lib/storage/upload";
import { extractTextFromBuffer, TEXT_EXTENSIONS } from "@/lib/server/extract-text";
import { extractImageText, IMAGE_EXTENSIONS_RE, isSupportedImage } from "@/lib/server/extract-image";
import { MAX_FILE_BYTES } from "@/lib/file-limits";

export const maxDuration = 90;
export const runtime = "nodejs";

const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
/**
 * Admin boleh file bahan lebih besar. Tetap ada plafon karena file dibaca utuh
 * ke memori untuk ekstraksi (multipart, bukan streaming).
 */
const MAX_ADMIN_FILE_BYTES = 50 * 1024 * 1024;

export async function POST(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`context-extract:${auth.user.id}`, {
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;

    if (!file) {
      return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 400 });
    }
    const isAdmin = auth.user.role === "ADMIN";
    const limit = isAdmin ? MAX_ADMIN_FILE_BYTES : MAX_FILE_BYTES;
    if (file.size <= 0 || file.size > limit) {
      throw new ApiRequestError(413, `Ukuran file harus di bawah ${Math.round(limit / 1048576)} MB.`);
    }

    const name = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    if (!name || isSensitivePath(name)) {
      throw new ApiRequestError(400, "File rahasia atau credential tidak boleh diunggah.");
    }
    if (isBlockedFileName(name)) {
      throw new ApiRequestError(415, BLOCKED_FILE_MESSAGE);
    }
    if (TEXT_EXTENSIONS.test(name.toLowerCase()) && file.size > MAX_TEXT_FILE_BYTES) {
      throw new ApiRequestError(413, "File teks harus di bawah 4 MB.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Gambar ditentukan dari magic bytes. Ekstensi gambar + isi bukan gambar → tolak.
    const looksImage = isSupportedImage(buffer);
    if (!looksImage && (IMAGE_EXTENSIONS_RE.test(name) || /^image\//i.test(file.type))) {
      throw new ApiRequestError(
        415,
        /\.(heic|heif|svg|bmp|tiff?)$/i.test(name)
          ? "Format gambar ini belum didukung. Gunakan PNG, JPG, WebP, atau GIF."
          : `Isi "${name}" bukan gambar PNG/JPEG/WebP/GIF yang valid.`,
      );
    }
    // ZIP proyek (kode web) diberi jatah lebih besar: muat struktur + lebih banyak file inti.
    // Sisa file tetap bisa dibaca utuh oleh agen lewat fileId (tool readMaterialFile).
    const isArchive = /\.zip$/i.test(name);
    const extracted = looksImage
      ? await extractImageText(buffer, name)
      : await extractTextFromBuffer(buffer, name, isArchive ? { maxChars: 110_000, maxCharsPerZipFile: 6_000 } : {});

    if (!extracted.content.trim()) {
      return NextResponse.json(
        { success: false, error: "File berhasil dibaca, tapi tidak ada teks yang bisa diekstrak." },
        { status: 422 },
      );
    }

    const upload = await saveUpload({
      ownerId: auth.user.id,
      buffer,
      originalName: name,
      mime: resolveMime(name, file.type),
    });

    const label = looksImage ? "Deskripsi & teks otomatis dari gambar" : "Ekstrak otomatis dari";
    return NextResponse.json(
      {
        success: true,
        data: {
          title: name,
          fileName: name,
          kind: extracted.kind,
          content: `[${label} ${name}]\n${extracted.content}`,
          charCount: extracted.charCount,
          fileId: upload.id,
          sha256: upload.sha256,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/context/extract failed:", error);
    return publicErrorResponse(error, "Gagal membaca file konteks.");
  }
}
