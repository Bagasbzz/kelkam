/**
 * POST /api/tugas/courses/[courseId]/enroll
 * -----------------------------------------------------------------------------
 * User enroll ke course (opsional — submit endpoint TIDAK cek enrollment row).
 * Idempotent: kalau udah enrolled, return existing row.
 *
 *   200 : { success, enrollmentId, alreadyEnrolled }
 *   401 : belum login
 *   404 : course tidak ditemukan
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

export async function POST(
  _req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { courseId } = await context.params;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      throw new ApiRequestError(404, "Course tidak ditemukan.");
    }

    // Upsert enrollment (idempotent).
    const existing = await prisma.courseEnrollment.findUnique({
      where: { courseId_userId: { courseId, userId: auth.user.id } },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        enrollmentId: existing.id,
        alreadyEnrolled: true,
      });
    }

    const enrollment = await prisma.courseEnrollment.create({
      data: { courseId, userId: auth.user.id },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      enrollmentId: enrollment.id,
      alreadyEnrolled: false,
    });
  } catch (error) {
    console.error("API /api/tugas/courses/[id]/enroll POST failed:", error);
    return publicErrorResponse(error, "Gagal enroll course.");
  }
}