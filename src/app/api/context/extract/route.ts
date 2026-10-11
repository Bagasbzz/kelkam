/**
 * POST /api/context/extract
 * -----------------------------------------------------------------------------
 * Upload & extract text dari berbagai format file konteks (DOCX, PDF, ZIP, teks).
 * Logika ekstraksi ada di src/lib/server/extract-text.ts (dipakai juga oleh
 * Admin AI Tugas).
 *
 * Flow:
 *   1. Auth + rate limit (8 per 10 menit, extraction mahal).
 *   2. Parse multipart form, validasi size & nama.
 *   3. Ekstrak via lib.
 *   4. Save file ke disk (SHA256 dedup).
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
import { saveUpload } from "@/lib/storage/upload";
import { extractTextFromBuffer, TEXT_EXTENSIONS } from "@/lib/server/extract-text";
import { MAX_FILE_BYTES } from "@/lib/file-limits";

export const maxDuration = 60;
export const runtime = "nodejs";

const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;

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
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new ApiRequestError(413, "Ukuran file harus di bawah 12 MB.");
    }

    const name = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    if (!name || isSensitivePath(name)) {
      throw new ApiRequestError(400, "File rahasia atau credential tidak boleh diunggah.");
    }
    if (TEXT_EXTENSIONS.test(name.toLowerCase()) && file.size > MAX_TEXT_FILE_BYTES) {
      throw new ApiRequestError(413, "File teks harus di bawah 4 MB.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const extracted = await extractTextFromBuffer(buffer, name);

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
      mime: file.type || "application/octet-stream",
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          title: name,
          fileName: name,
          kind: extracted.kind,
          content: `[Ekstrak otomatis dari ${name}]\n${extracted.content}`,
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
