/**
 * src/lib/server/tugas/access.ts
 * -----------------------------------------------------------------------------
 * Helper untuk cek akses course / class / tugas.
 *
 * Dipakai di API routes Tugas untuk:
 *   - Ambil course by token (publik).
 *   - Validasi class milik course tertentu.
 *   - Cek tugas milik course tertentu.
 *
 * Throw `ApiRequestError` dengan status yang sesuai supaya caller tinggal
 * `try { ... } catch { publicErrorResponse }`.
 * -----------------------------------------------------------------------------
 */

import { prisma } from "@/lib/db/prisma";
import { ApiRequestError } from "@/lib/server/request-guards";

// ---------------------------------------------------------------------------
// Course lookup
// ---------------------------------------------------------------------------

/**
 * Ambil course by token (publik — buat halaman /tugas/[token]).
 * Return null kalau token tidak ditemukan (caller decide 404).
 */
export async function getCourseByToken(token: string) {
  return prisma.course.findUnique({
    where: { token },
    include: {
      classes: { orderBy: { name: "asc" } },
      createdBy: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Ambil course by id. Throw 404 kalau tidak ada.
 * Dipakai di API routes yang udah lewat auth.
 */
export async function getCourseOrThrow(courseId: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new ApiRequestError(404, "Course tidak ditemukan.");
  }
  return course;
}

/**
 * Ambil tugas by id, include class. Throw 404 kalau tidak ada.
 * `assertTugasBelongsToCourse` opsional — bisa dipakai terpisah kalau perlu.
 */
export async function getTugasOrThrow(tugasId: string) {
  const tugas = await prisma.tugas.findUnique({
    where: { id: tugasId },
    include: { class: true, course: true },
  });
  if (!tugas) {
    throw new ApiRequestError(404, "Tugas tidak ditemukan.");
  }
  return tugas;
}

/**
 * Validasi bahwa tugas benar-benar milik course tsb.
 * Throw 400 kalau mismatch.
 */
export function assertTugasBelongsToCourse(
  tugas: { courseId: string },
  courseId: string,
) {
  if (tugas.courseId !== courseId) {
    throw new ApiRequestError(400, "Tugas bukan milik course ini.");
  }
}

// ---------------------------------------------------------------------------
// Class validation
// ---------------------------------------------------------------------------

/**
 * Validasi class id milik course tsb. Throw 400 kalau tidak.
 * Return class row kalau valid (untuk reuse data).
 */
export async function assertClassBelongsToCourse(classId: string, courseId: string) {
  const cls = await prisma.courseClass.findUnique({ where: { id: classId } });
  if (!cls) {
    throw new ApiRequestError(404, "Kelas tidak ditemukan.");
  }
  if (cls.courseId !== courseId) {
    throw new ApiRequestError(400, "Kelas bukan milik course ini.");
  }
  return cls;
}

/**
 * Validasi class ada di course tsb ATAU tugas tidak punya class restriction.
 * Pakai untuk tugas yang optional per-class.
 */
export async function assertClassCompatible(
  classId: string,
  courseId: string,
  tugasClassId: string | null,
) {
  if (!tugasClassId) return; // Tugas untuk semua kelas di course.
  if (tugasClassId !== classId) {
    throw new ApiRequestError(400, "Kelas ini tidak termasuk untuk tugas tersebut.");
  }
  await assertClassBelongsToCourse(classId, courseId);
}

// ---------------------------------------------------------------------------
// FileUpload validation (untuk submit endpoint)
// ---------------------------------------------------------------------------

/**
 * Validasi bahwa file upload ada DAN milik user tsb (anti bypass).
 * Kalau valid, return row. Else throw 400.
 */
export async function assertFileUploadOwnedBy(
  fileUploadId: string,
  userId: string,
) {
  const file = await prisma.fileUpload.findUnique({ where: { id: fileUploadId } });
  if (!file) {
    throw new ApiRequestError(400, "File tidak ditemukan.");
  }
  if (file.ownerId !== userId) {
    // Sengaja generic — anti probing ID orang lain.
    throw new ApiRequestError(400, "File tidak valid untuk submit ini.");
  }
  return file;
}