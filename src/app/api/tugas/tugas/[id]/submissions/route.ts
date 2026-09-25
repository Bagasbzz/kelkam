/**
 * GET /api/tugas/tugas/[id]/submissions
 * -----------------------------------------------------------------------------
 * List semua submission untuk tugas. Auth: course admin.
 * Return full submission list (NIM, nama, note, file, waktu, position, status).
 */
import { NextResponse } from "next/server";
import { getTugasOrThrow } from "@/lib/server/tugas/access";
import { getAdminView } from "@/lib/server/tugas/visibility";
import { requireCourseAdmin } from "@/lib/server/auth";
import {
  ApiRequestError,
  publicErrorResponse,
} from "@/lib/server/request-guards";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const tugas = await getTugasOrThrow(id);
    await requireCourseAdmin(tugas.courseId);

    const view = await getAdminView(id);
    if (!view) {
      return NextResponse.json(
        { success: false, error: "Tugas tidak ditemukan." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
      tugas: {
        id: view.tugas.id,
        courseId: view.tugas.courseId,
        classId: view.tugas.classId,
        class: view.tugas.class ? { id: view.tugas.class.id, name: view.tugas.class.name } : null,
        title: view.tugas.title,
        description: view.tugas.description,
        deadline: view.tugas.deadline.toISOString(),
        createdAt: view.tugas.createdAt.toISOString(),
        updatedAt: view.tugas.updatedAt.toISOString(),
      },
      submissions: view.submissions.map((s) => ({
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
        user: s.user
          ? { id: s.user.id, email: s.user.email, name: s.user.name }
          : undefined,
      })),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas/[id]/submissions GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat submission.");
  }
}