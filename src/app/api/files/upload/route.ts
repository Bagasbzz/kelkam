/**
 * POST /api/files/upload
 * -----------------------------------------------------------------------------
 * Generic file upload endpoint.
 *
 * Dipakai untuk file apapun (PDF, DOCX, gambar, dll) yang perlu disimpan
 * ke server. Untuk specific use case (context extraction, fix-format DOCX),
 * biasanya dipanggil dari route yang lebih spesifik.
 *
 * Flow:
 *   1. Auth check (cookie JWT).
 *   2. Rate limit per user (30 upload per 10 menit).
 *   3. Parse multipart form.
 *   4. Validasi ukuran (max 12 MB).
 *   5. SHA256 dedup → kalau file sudah ada, return row existing.
 *   6. Simpan ke `${UPLOAD_DIR}/${ownerId}/${sha256}.${ext}`.
 *   7. Insert row ke tabel `file_uploads`.
 *
 * Response shape:
 *   - 200 { success: true, data: { fileId, sha256, deduplicated, size, mime } }
 *   - 400 — file tidak ada / nama invalid
 *   - 401 — belum login
 *   - 413 — file > 12 MB
 *   - 429 — rate limit
 *   - 500 — server error
 *
 * Setelah upload, downstream route (mis. /api/context/extract) akan baca
 * file via `readUpload(fileId, ownerId)` di src/lib/storage/upload.ts.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/file-limits";
import { saveUpload } from "@/lib/storage/upload";

/** Pakai Node.js runtime (bukan Edge) karena pakai fs + buffer. */
export const runtime = "nodejs";

/** Timeout 60 detik — handle file besar. */
export const maxDuration = 60;

export async function POST(req: Request) {
  // -------------------------------------------------------------------------
  // Auth + rate limit
  // -------------------------------------------------------------------------
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`files-upload:${auth.user.id}`, {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    // -------------------------------------------------------------------------
    // Parse multipart form
    // -------------------------------------------------------------------------
    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;

    if (!file) {
      return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 400 });
    }

    // -------------------------------------------------------------------------
    // Validasi ukuran & nama
    // -------------------------------------------------------------------------
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new ApiRequestError(413, `Ukuran file harus di bawah ${MAX_FILE_LABEL}.`);
    }

    const name = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    if (!name) {
      throw new ApiRequestError(400, "Nama file tidak valid.");
    }

    // -------------------------------------------------------------------------
    // Save (dengan SHA256 dedup)
    // -------------------------------------------------------------------------
    const buffer = Buffer.from(await file.arrayBuffer());
    const upload = await saveUpload({
      ownerId: auth.user.id,
      buffer,
      originalName: name,
      mime: file.type || "application/octet-stream",
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          fileId: upload.id,
          sha256: upload.sha256,
          deduplicated: upload.deduplicated,
          size: buffer.byteLength,
          mime: file.type || "application/octet-stream",
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("API /api/files/upload failed:", error);
    return publicErrorResponse(error, "Gagal mengunggah file.");
  }
}