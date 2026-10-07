/**
 * src/lib/server/tugas/serialize.ts
 * -----------------------------------------------------------------------------
 * Satu bentuk JSON untuk TugasSubmission di semua endpoint (submit, edit,
 * my-submission, admin list, riwayat). Kolom sensitif (user id/email) hanya
 * ikut kalau caller memang meng-include relasi `user` (admin view).
 * -----------------------------------------------------------------------------
 */

type ClassRef = { id: string; name: string };
type FileRef = { id: string; originalName: string; mime: string; size: number } | null;

export interface SerializableSubmission {
  id: string;
  tugasId: string;
  classId: string;
  class: ClassRef;
  nim: string;
  name: string;
  note: string | null;
  fileUpload: FileRef;
  position: number;
  status: "SUBMITTED" | "LATE" | "REJECTED";
  submittedAt: Date;
  updatedAt: Date | null;
  feedback: string | null;
  feedbackAt: Date | null;
  nilai?: number | null;
  nilaiAt?: Date | null;
  user?: { id: string; email: string; name: string | null } | null;
}

/** Konversi nilai angka 0-100 → huruf. */
export function nilaiToHuruf(nilai: number | null | undefined): string | null {
  if (nilai === null || nilai === undefined) return null;
  if (nilai >= 85) return "A";
  if (nilai >= 75) return "B";
  if (nilai >= 65) return "C";
  if (nilai >= 55) return "D";
  return "E";
}

export function serializeSubmission(s: SerializableSubmission) {
  return {
    id: s.id,
    tugasId: s.tugasId,
    classId: s.classId,
    class: { id: s.class.id, name: s.class.name },
    nim: s.nim,
    name: s.name,
    note: s.note,
    fileUpload: s.fileUpload
      ? {
          id: s.fileUpload.id,
          originalName: s.fileUpload.originalName,
          mime: s.fileUpload.mime,
          size: s.fileUpload.size,
        }
      : null,
    position: s.position,
    status: s.status,
    submittedAt: s.submittedAt.toISOString(),
    updatedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
    feedback: s.feedback,
    feedbackAt: s.feedbackAt ? s.feedbackAt.toISOString() : null,
    nilai: s.nilai ?? null,
    nilaiHuruf: nilaiToHuruf(s.nilai),
    nilaiAt: s.nilaiAt ? s.nilaiAt.toISOString() : null,
    ...(s.user ? { user: { id: s.user.id, email: s.user.email, name: s.user.name } } : {}),
  };
}

/** Include standar supaya hasil query cocok dengan `serializeSubmission`. */
export const submissionInclude = {
  class: { select: { id: true, name: true } },
  fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
} as const;
