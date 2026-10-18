/**
 * Lampiran tugas (screenshot output yang diharapkan, file contoh, dll).
 * File fisik dirujuk ke FileUpload milik admin; mahasiswa mengaksesnya lewat
 * endpoint publik berbasis token course.
 */
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError } from "@/lib/server/request-guards";

export const MAX_TUGAS_ATTACHMENTS = 8;
export const IMAGE_MIME_RE = /^image\/(png|jpe?g|webp|gif)$/i;

/**
 * MIME yang boleh jadi lampiran tugas. Lampiran diakses PUBLIK via token course
 * dan gambar di-serve inline, jadi tipe aktif (HTML, SVG, JS) ditolak untuk
 * mencegah stored-XSS lewat file yang diunggah admin.
 */
const ALLOWED_ATTACHMENT_MIME_RE = new RegExp(
  [
    "^image/(png|jpe?g|webp|gif)$",
    "^application/pdf$",
    "^application/zip$",
    "^application/x-zip-compressed$",
    "^application/msword$",
    "^application/vnd\\.openxmlformats-officedocument\\.wordprocessingml\\.document$",
    "^application/vnd\\.ms-powerpoint$",
    "^application/vnd\\.openxmlformats-officedocument\\.presentationml\\.presentation$",
    "^application/vnd\\.ms-excel$",
    "^application/vnd\\.openxmlformats-officedocument\\.spreadsheetml\\.sheet$",
    "^text/plain$",
    "^text/csv$",
    "^application/octet-stream$",
  ].join("|"),
  "i",
);

export function isAllowedAttachmentMime(mime: string): boolean {
  return ALLOWED_ATTACHMENT_MIME_RE.test(mime);
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
  const disallowed = owned.find((f) => !isAllowedAttachmentMime(f.mime));
  if (disallowed) {
    throw new ApiRequestError(
      400,
      `Tipe file "${disallowed.originalName}" tidak didukung sebagai lampiran. Gunakan gambar (PNG/JPG/WebP/GIF), PDF, Word, PPT, Excel, teks, atau ZIP.`,
    );
  }
  return unique.map((a, i) => ({
    fileUploadId: a.fileId,
    caption: (a.caption ?? "").trim().slice(0, 500),
    position: i,
  }));
}
