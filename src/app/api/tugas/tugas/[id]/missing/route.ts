/**
 * GET /api/tugas/tugas/[id]/missing
 * Mahasiswa di roster yang belum mengumpulkan tugas ini (cocok via NIM
 * ternormalisasi). Auth: course admin.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { getTugasOrThrow } from "@/lib/server/tugas/access";
import { normalizeNim } from "@/lib/server/tugas/pertemuan";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const tugas = await getTugasOrThrow(id);
    await requireCourseAdmin(tugas.courseId);

    const [roster, subs] = await Promise.all([
      prisma.mahasiswa.findMany({
        where: { courseId: tugas.courseId, ...(tugas.classId ? { classId: tugas.classId } : {}) },
        select: { id: true, nim: true, name: true, email: true, class: { select: { id: true, name: true } } },
        orderBy: [{ classId: "asc" }, { name: "asc" }],
      }),
      prisma.tugasSubmission.findMany({ where: { tugasId: id }, select: { nim: true } }),
    ]);
    const submitted = new Set(subs.map((s) => normalizeNim(s.nim)));
    const missing = roster.filter((m) => !submitted.has(normalizeNim(m.nim)));

    return NextResponse.json({
      success: true,
      rosterTotal: roster.length,
      submitted: roster.length - missing.length,
      missing,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    return publicErrorResponse(error, "Gagal memuat daftar belum kumpul.");
  }
}
