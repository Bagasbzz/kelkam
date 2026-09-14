/**
 * src/lib/storage/upload.ts
 * -----------------------------------------------------------------------------
 * File upload handler untuk keluhkampus.
 *
 * Fitur:
 *   - Simpan file ke filesystem (path dari env UPLOAD_DIR, default `./uploads`).
 *   - Dedup berdasarkan SHA256: kalau file dengan hash yang sama sudah ada,
 *     return row yang sama (no re-upload).
 *   - Catat di tabel `file_uploads` untuk ownership & quota tracking.
 *
 * Layout file di disk:
 *   ${UPLOAD_DIR}/${ownerId}/${sha256}${ext}
 *
 * Kenapa bukan path by user-supplied name?
 *   - Anti path traversal (../  attack).
 *   - Konsisten (extension ikut MIME kalau user tidak kasih).
 *
 * Schema tabel `file_uploads`:
 *   - id        : cuid (primary key)
 *   - sha256    : unique (untuk dedup)
 *   - ownerId   : user yang upload (foreign key ke users)
 *   - filePath  : path absolut di server
 *   - mime      : MIME type
 *   - size      : bytes
 *   - originalName: nama file asli (untuk display di UI)
 *
 * Pakai:
 *   // Di API route:
 *   const buffer = Buffer.from(await file.arrayBuffer());
 *   const upload = await saveUpload({
 *     ownerId: auth.user.id,
 *     buffer,
 *     originalName: file.name,
 *     mime: file.type || "application/octet-stream",
 *   });
 *   // upload.id → id di tabel, upload.sha256 → hash, upload.deduplicated → boolean
 * -----------------------------------------------------------------------------
 */

import { promises as fs } from "fs";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "@/lib/db/prisma";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default upload directory (relative ke project root). Override via UPLOAD_DIR. */
const DEFAULT_UPLOAD_DIR = path.join(process.cwd(), "uploads");

/** Resolve path: env var atau default. */
function uploadDir(): string {
  return process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pilih extension untuk file di disk.
 * Prioritas: extension dari nama asli → MIME → fallback `.bin`.
 *
 * @param originalName - nama file dari form upload
 * @param mime - MIME type dari File object
 */
function extensionFor(originalName: string, mime: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (mime.startsWith("image/")) return `.${mime.split("/")[1]}`;
  if (mime === "application/pdf") return ".pdf";
  if (mime === "application/zip") return ".zip";
  if (mime.includes("word")) return ".docx";
  return ".bin";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SavedUpload {
  id: string;
  sha256: string;
  filePath: string;
  /** True kalau file ini sudah ada (dedup hit). */
  deduplicated: boolean;
}

/**
 * Simpan file ke disk, catat di DB.
 * Idempotent: kalau SHA256 sudah ada → return row existing.
 *
 * @param input.ownerId - user yang upload
 * @param input.buffer - file bytes
 * @param input.originalName - nama file asli
 * @param input.mime - MIME type
 * @returns SavedUpload { id, sha256, filePath, deduplicated }
 *
 * @throws Error kalau filesystem write gagal (quota habis, permission, dll)
 */
export async function saveUpload(input: {
  ownerId: string;
  buffer: Buffer;
  originalName: string;
  mime: string;
}): Promise<SavedUpload> {
  // Compute SHA256 (hex). Untuk file besar ini O(N) memory-bandwidth.
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");

  // Dedup: kalau SHA256 sudah ada → return row existing tanpa tulis ke disk.
  const existing = await prisma.fileUpload.findUnique({ where: { sha256 } });
  if (existing) {
    return {
      id: existing.id,
      sha256: existing.sha256,
      filePath: existing.filePath,
      deduplicated: true,
    };
  }

  // Pastikan folder owner ada (mkdir recursive).
  const ext = extensionFor(input.originalName, input.mime);
  const ownerDir = path.join(uploadDir(), input.ownerId);
  await fs.mkdir(ownerDir, { recursive: true });
  const filePath = path.join(ownerDir, `${sha256}${ext}`);
  await fs.writeFile(filePath, input.buffer);

  // Catat di DB.
  const row = await prisma.fileUpload.create({
    data: {
      sha256,
      ownerId: input.ownerId,
      filePath,
      mime: input.mime,
      size: input.buffer.byteLength,
      originalName: input.originalName,
    },
  });

  return { id: row.id, sha256: row.sha256, filePath: row.filePath, deduplicated: false };
}

/**
 * Baca file dari disk (kalau owner match). Return null kalau tidak ditemukan
 * atau owner salah (anti data leak antar user).
 *
 * @param fileId - id dari tabel `file_uploads`
 * @param ownerId - user yang request (HARUS dicek di sini)
 */
export async function readUpload(fileId: string, ownerId: string): Promise<Buffer | null> {
  const row = await prisma.fileUpload.findUnique({ where: { id: fileId } });
  if (!row || row.ownerId !== ownerId) return null;
  return fs.readFile(row.filePath);
}