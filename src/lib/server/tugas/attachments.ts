/**
 * Lampiran tugas (screenshot output yang diharapkan, file contoh, dll).
 * File fisik dirujuk ke FileUpload milik admin; mahasiswa mengaksesnya lewat
 * endpoint publik berbasis token course.
 */
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError } from "@/lib/server/request-guards";
import { isBlockedFileName, sanitizeMime } from "@/lib/security/file-types";

export const MAX_TUGAS_ATTACHMENTS = 8;
export const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/i;
/** Video yang bisa diputar langsung di browser (HTML5 <video>) dan diunduh mahasiswa. */
export const VIDEO_MIME_RE = /^video\/(mp4|webm|ogg|quicktime|x-matroska|x-msvideo|3gpp)$/i;

/**
 * Lampiran tugas boleh tipe apa pun KECUALI:
 *   - MIME aktif (HTML/SVG/JS/XML) → bisa stored-XSS bila di-render dari origin kita;
 *   - ekstensi executable/skrip (.exe, .bat, .ps1, ...).
 * File baru dari endpoint upload sudah disanitasi (MIME aktif → octet-stream),
 * cek ini menjaga row lama. Endpoint lampiran hanya menyajikan gambar/video
 * inline; tipe lain selalu `Content-Disposition: attachment` + nosniff.
 */
export function isAllowedAttachmentMime(mime: string): boolean {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  // sanitizeMime mengubah MIME aktif menjadi octet-stream; kalau berubah → aktif → tolak.
  return base === "application/octet-stream" || sanitizeMime(base) === base || base === "image/jpg";
}

export interface TugasAttachmentInput {
  fileId: string;
  caption?: string;
}

export interface TugasAttachmentView {
  id: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
  caption: string;
  isImage: boolean;
  isVideo: boolean;
}

export const attachmentInclude = {
  attachments: {
    orderBy: { position: "asc" as const },
    include: { fileUpload: { select: { id: true, originalName: true, mime: true, size: true } } },
  },
};

type AttachmentRow = {
  id: string;
  caption: string;
  fileUpload: { id: string; originalName: string; mime: string; size: number };
};

export function serializeAttachments(rows: AttachmentRow[] | undefined): TugasAttachmentView[] {
  return (rows ?? []).map((a) => ({
    id: a.id,
    fileId: a.fileUpload.id,
    name: a.fileUpload.originalName,
    mime: a.fileUpload.mime,
    size: a.fileUpload.size,
    caption: a.caption,
    isImage: IMAGE_MIME_RE.test(a.fileUpload.mime),
    isVideo: VIDEO_MIME_RE.test(a.fileUpload.mime),
  }));
}

/** Pastikan semua fileId milik admin yang login; return data create untuk Prisma. */
export async function buildAttachmentCreates(adminId: string, input: TugasAttachmentInput[]) {
  const unique = Array.from(new Map(input.map((a) => [a.fileId, a])).values()).slice(0, MAX_TUGAS_ATTACHMENTS);
  if (!unique.length) return [];
  const owned = await prisma.fileUpload.findMany({
    where: { id: { in: unique.map((a) => a.fileId) }, ownerId: adminId },
    select: { id: true, mime: true, originalName: true },
  });
  const ownedById = new Map(owned.map((f) => [f.id, f]));
  const missing = unique.find((a) => !ownedById.has(a.fileId));
  if (missing) throw new ApiRequestError(400, "Lampiran tidak ditemukan atau bukan milik Anda.");
  const disallowed = owned.find((f) => !isAllowedAttachmentMime(f.mime) || isBlockedFileName(f.originalName));
  if (disallowed) {
    throw new ApiRequestError(
      400,
      `File "${disallowed.originalName}" tidak boleh dijadikan lampiran (HTML/SVG/skrip/program diblokir demi keamanan). Kompres ke ZIP bila perlu.`,
    );
  }
  return unique.map((a, i) => ({
    fileUploadId: a.fileId,
    caption: (a.caption ?? "").trim().slice(0, 500),
    position: i,
  }));
}
