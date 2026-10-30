/**
 * src/lib/storage/upload.ts
 * -----------------------------------------------------------------------------
 * File upload handler untuk keluhkampus.
 *
 * Fitur:
 *   - Simpan file ke filesystem (path dari env UPLOAD_DIR, default `./uploads`).
 *   - Dedup berdasarkan owner + SHA256: kalau file dengan hash yang sama sudah ada,
 *     return row yang sama (no re-upload).
 *   - Catat di tabel `file_uploads` untuk ownership & quota tracking.
 *
 * Layout file di disk:
 *   ${UPLOAD_DIR}/${ownerId}/${sha256}-${randomId}${ext}
 *
 * Kenapa bukan path by user-supplied name?
 *   - Anti path traversal (../  attack).
 *   - Konsisten (extension ikut MIME kalau user tidak kasih).
 *
 * Schema tabel `file_uploads`:
 *   - id        : cuid (primary key)
 *   - sha256    : unique bersama ownerId (untuk dedup per owner)
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

import { promises as fs, createWriteStream } from "fs";
import { createHash, randomBytes } from "crypto";
import { pipeline } from "stream/promises";
import { Readable, Transform } from "stream";
import path from "path";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

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
  if (mime.startsWith("video/")) return `.${mime.split("/")[1].replace(/^x-/, "")}`;
  if (mime === "application/pdf") return ".pdf";
  if (mime === "application/zip") return ".zip";
  if (mime.includes("word")) return ".docx";
  return ".bin";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Upload terpotong: byte diterima tidak sama dengan ukuran file asli. */
export class IncompleteUploadError extends Error {
  constructor(public readonly received: number, public readonly expected: number) {
    super(`Upload tidak lengkap: diterima ${received} dari ${expected} byte.`);
    this.name = "IncompleteUploadError";
  }
}

/** Isi file tidak cocok dengan tipe yang diklaim (magic bytes salah). */
export class InvalidSignatureError extends Error {
  constructor() {
    super("Isi file tidak sesuai dengan tipenya.");
    this.name = "InvalidSignatureError";
  }
}

export interface SavedUpload {
  id: string;
  sha256: string;
  filePath: string;
  /** True kalau file ini sudah ada (dedup hit). */
  deduplicated: boolean;
}

/**
 * Simpan file ke disk, catat di DB.
 * Idempotent: kalau owner + SHA256 sudah ada → return row existing.
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

  // Dedup hanya dalam owner yang sama, tanpa berbagi file antar user.
  const existing = await prisma.fileUpload.findUnique({ where: { ownerId_sha256: { ownerId: input.ownerId, sha256 } } });
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
  const filePath = path.join(ownerDir, `${sha256}-${randomBytes(16).toString("hex")}${ext}`);
  await fs.writeFile(filePath, input.buffer, { flag: "wx" });

  return recordUpload({
    sha256,
    ownerId: input.ownerId,
    filePath,
    mime: input.mime,
    size: input.buffer.byteLength,
    originalName: input.originalName,
  });
}

/**
 * Simpan file BESAR (video) langsung dari stream ke disk tanpa menahan
 * seluruh isi di memori. SHA256 dihitung sambil menulis; file ditulis ke
 * nama sementara lalu di-rename ke `${sha256}-${randomId}${ext}` setelah hash diketahui.
 *
 * Dedup tetap berlaku: kalau owner + SHA256 sudah ada, file sementara dihapus dan
 * row existing dikembalikan.
 *
 * @param input.stream - web ReadableStream (mis. `file.stream()` dari FormData)
 */
export async function saveUploadFromStream(input: {
  ownerId: string;
  stream: ReadableStream<Uint8Array>;
  originalName: string;
  mime: string;
  /** Ukuran yang diharapkan (bytes). Kalau diisi & tidak cocok → file dibuang (anti file terpotong). */
  expectedSize?: number;
  /**
   * Validasi signature (magic bytes) dari 16 byte pertama. Return false → upload
   * dibatalkan dengan `InvalidSignatureError` sebelum file selesai ditulis.
   */
  validateHead?: (head: Buffer) => boolean;
}): Promise<SavedUpload & { size: number }> {
  const ext = extensionFor(input.originalName, input.mime);
  const ownerDir = path.join(uploadDir(), input.ownerId);
  await fs.mkdir(ownerDir, { recursive: true });
  const writeId = randomBytes(16).toString("hex");
  const tmpPath = path.join(ownerDir, `.tmp-${writeId}${ext}`);

  const hash = createHash("sha256");
  let size = 0;
  // Kumpulkan beberapa byte awal untuk cek signature sebelum lanjut menulis.
  const HEAD_BYTES = 16;
  let head: Buffer | null = input.validateHead ? Buffer.alloc(0) : null;
  const checkHead = (): Error | null => {
    if (!head || !input.validateHead) return null;
    const ok = input.validateHead(head);
    head = null;
    return ok ? null : new InvalidSignatureError();
  };
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (head) {
        head = Buffer.concat([head, chunk.subarray(0, HEAD_BYTES - head.length)]);
        if (head.length >= HEAD_BYTES) {
          const err = checkHead();
          if (err) return cb(err);
        }
      }
      hash.update(chunk);
      size += chunk.byteLength;
      cb(null, chunk);
    },
    flush(cb) {
      // File lebih kecil dari HEAD_BYTES: tetap divalidasi.
      cb(checkHead());
    },
  });

  try {
    await pipeline(Readable.fromWeb(input.stream as import("stream/web").ReadableStream<Uint8Array>), hasher, createWriteStream(tmpPath, { flags: "wx" }));
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }

  const sha256 = hash.digest("hex");
  if (size <= 0) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw new Error("File kosong.");
  }
  if (input.expectedSize !== undefined && size !== input.expectedSize) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw new IncompleteUploadError(size, input.expectedSize);
  }

  const existing = await prisma.fileUpload.findUnique({ where: { ownerId_sha256: { ownerId: input.ownerId, sha256 } } });
  if (existing) {
    await fs.unlink(tmpPath).catch(() => undefined);
    return { id: existing.id, sha256: existing.sha256, filePath: existing.filePath, deduplicated: true, size: existing.size };
  }

  const filePath = path.join(ownerDir, `${sha256}-${writeId}${ext}`);
  await fs.rename(tmpPath, filePath);
  const saved = await recordUpload({
    sha256,
    ownerId: input.ownerId,
    filePath,
    mime: input.mime,
    size,
    originalName: input.originalName,
  });
  return { ...saved, size };
}

/** Catat row `file_uploads`; tangani race unique owner + SHA256 sebagai dedup. */
async function recordUpload(data: {
  sha256: string;
  ownerId: string;
  filePath: string;
  mime: string;
  size: number;
  originalName: string;
}): Promise<SavedUpload> {
  const { ownerId, sha256, filePath } = data;
  let row;
  try {
    row = await prisma.fileUpload.create({ data });
  } catch (error) {
    // Dua upload identik yang masuk bersamaan bisa sama-sama lolos findUnique.
    // Setiap write punya path sendiri; jangan pernah hapus file pemenang race.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await prisma.fileUpload.findUnique({ where: { ownerId_sha256: { ownerId, sha256 } } });
      if (concurrent) {
        if (filePath !== concurrent.filePath) {
          await fs.unlink(filePath).catch(() => undefined);
        }
        return {
          id: concurrent.id,
          sha256: concurrent.sha256,
          filePath: concurrent.filePath,
          deduplicated: true,
        };
      }
    }
    throw error;
  }

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
