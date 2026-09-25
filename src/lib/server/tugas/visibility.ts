/**
 * src/lib/server/tugas/visibility.ts
 * -----------------------------------------------------------------------------
 * Helper untuk assemble payload Tugas sesuai role.
 *
 * - `getStudentView()` → return data publik (count, my submission + position).
 *   TIDAK expose submission orang lain.
 * - `getAdminView()` → return full submission list (NIM, nama, waktu, file, note).
 *
 * Dipakai di:
 *   - GET /api/tugas/tugas/[id]/my-submission (student)
 *   - GET /api/tugas/tugas/[id]/submissions (admin)
 * -----------------------------------------------------------------------------
 */

import { prisma } from "@/lib/db/prisma";

// ---------------------------------------------------------------------------
// Student view
// ---------------------------------------------------------------------------

/**
 * Data yang dikirim ke mahasiswa: count total + submission sendiri (kalau ada).
 * Submission orang lain TIDAK di-include — privacy by design.
 */
export async function getStudentView(tugasId: string, userId: string) {
  const tugas = await prisma.tugas.findUnique({
    where: { id: tugasId },
    include: {
      class: true,
      course: { select: { id: true, name: true, code: true } },
    },
  });
  if (!tugas) return null;

  const [count, mySubmission] = await Promise.all([
    prisma.tugasSubmission.count({ where: { tugasId } }),
    prisma.tugasSubmission.findUnique({
      where: { tugasId_userId: { tugasId, userId } },
      include: {
        class: { select: { id: true, name: true } },
        fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
      },
    }),
  ]);

  return {
    tugas,
    count,
    mySubmission,
  };
}

// ---------------------------------------------------------------------------
// Admin view
// ---------------------------------------------------------------------------

/**
 * Data full submission list untuk course admin. Includes NIM/nama/waktu/file
 * per submission. Order by position asc (urutan ngumpul).
 */
export async function getAdminView(tugasId: string) {
  const tugas = await prisma.tugas.findUnique({
    where: { id: tugasId },
    include: {
      class: true,
      course: { select: { id: true, name: true, code: true } },
    },
  });
  if (!tugas) return null;

  const submissions = await prisma.tugasSubmission.findMany({
    where: { tugasId },
    orderBy: { position: "asc" },
    include: {
      class: { select: { id: true, name: true } },
      user: { select: { id: true, email: true, name: true } },
      fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
    },
  });

  return { tugas, submissions };
}