/**
 * Baca isi pengumpulan mahasiswa (note + file) sebagai teks, dengan cache di
 * tabel ExtractedText supaya ekstraksi hanya terjadi sekali per file.
 */

import fs from "node:fs/promises";
import { prisma } from "@/lib/db/prisma";
import { extractTextFromBuffer, type ZipManifest } from "@/lib/server/extract-text";

export interface SubmissionText {
  submissionId: string;
  nim: string;
  name: string;
  /** Catatan mahasiswa + isi file (digabung). */
  text: string;
  fileName: string | null;
  kind: string | null;
  charCount: number;
  truncated: boolean;
  zipManifest: ZipManifest | null;
  extractError: string | null;
}

/** Ekstrak (atau ambil dari cache) teks untuk 1 FileUpload. */
export async function getOrExtractFileText(fileUploadId: string) {
  const cached = await prisma.extractedText.findUnique({ where: { fileUploadId } });
  if (cached) return cached;

  const file = await prisma.fileUpload.findUnique({ where: { id: fileUploadId } });
  if (!file) return null;

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(file.filePath);
  } catch {
    return null;
  }

  const result = await extractTextFromBuffer(buffer, file.originalName, { maxChars: 60_000 });

  return prisma.extractedText.upsert({
    where: { fileUploadId },
    create: {
      fileUploadId,
      kind: result.kind,
      text: result.content,
      charCount: result.charCount,
      truncated: result.truncated,
      zipManifest: result.zipManifest ? JSON.parse(JSON.stringify(result.zipManifest)) : undefined,
    },
    update: {},
  });
}

/** Gabungkan note + teks file untuk 1 submission. */
export async function getSubmissionText(submissionId: string): Promise<SubmissionText | null> {
  const sub = await prisma.tugasSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      nim: true,
      name: true,
      note: true,
      fileUploadId: true,
      fileUpload: { select: { originalName: true } },
    },
  });
  if (!sub) return null;

  let fileText = "";
  let kind: string | null = null;
  let truncated = false;
  let zipManifest: ZipManifest | null = null;
  let extractError: string | null = null;

  if (sub.fileUploadId) {
    try {
      const ex = await getOrExtractFileText(sub.fileUploadId);
      if (ex) {
        fileText = ex.text;
        kind = ex.kind;
        truncated = ex.truncated;
        zipManifest = (ex.zipManifest as unknown as ZipManifest | null) ?? null;
      } else {
        extractError = "File tidak ditemukan di penyimpanan.";
      }
    } catch (err) {
      extractError =
        err instanceof Error && "publicMessage" in err
          ? String((err as { publicMessage: string }).publicMessage)
          : "Format file tidak bisa dibaca sebagai teks.";
    }
  }

  const parts: string[] = [];
  if (sub.note?.trim()) parts.push(`[Catatan mahasiswa]\n${sub.note.trim()}`);
  if (fileText.trim()) parts.push(`[Isi file: ${sub.fileUpload?.originalName ?? "file"}]\n${fileText}`);
  const text = parts.join("\n\n");

  return {
    submissionId: sub.id,
    nim: sub.nim,
    name: sub.name,
    text,
    fileName: sub.fileUpload?.originalName ?? null,
    kind,
    charCount: text.length,
    truncated,
    zipManifest,
    extractError,
  };
}

/** Ambil teks semua submission 1 tugas (urut position). */
export async function getTugasSubmissionTexts(tugasId: string): Promise<SubmissionText[]> {
  const rows = await prisma.tugasSubmission.findMany({
    where: { tugasId },
    select: { id: true },
    orderBy: { position: "asc" },
  });
  const out: SubmissionText[] = [];
  for (const r of rows) {
    const t = await getSubmissionText(r.id);
    if (t) out.push(t);
  }
  return out;
}
