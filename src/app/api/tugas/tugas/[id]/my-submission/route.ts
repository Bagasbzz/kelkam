/**
 * GET /api/tugas/tugas/[id]/my-submission
 * -----------------------------------------------------------------------------
 * Ambil submission sendiri + count total submission.
 *
 * Return:
 *   - 200 { success, submission: SubmissionRow | null, count, myPosition }
 *   - 401 belum login
 *   - 404 tugas tidak ditemukan
 */
import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import {
  ApiRequestError,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import { getTugasOrThrow } from "@/lib/server/tugas/access";
import { getStudentView } from "@/lib/server/tugas/visibility";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await context.params;
    // Throw 404 kalau tugas tidak ada (biar konsisten dengan visibility helper).
    await getTugasOrThrow(id);

    const view = await getStudentView(id, auth.user.id);
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
      submission: view.mySubmission
        ? {
            id: view.mySubmission.id,
            tugasId: view.mySubmission.tugasId,
            classId: view.mySubmission.classId,
            class: {
              id: view.mySubmission.class.id,
              name: view.mySubmission.class.name,
            },
            nim: view.mySubmission.nim,
            name: view.mySubmission.name,
            note: view.mySubmission.note,
            fileUpload: view.mySubmission.fileUpload
              ? {
                  id: view.mySubmission.fileUpload.id,
                  originalName: view.mySubmission.fileUpload.originalName,
                  mime: view.mySubmission.fileUpload.mime,
                  size: view.mySubmission.fileUpload.size,
                }
              : null,
            position: view.mySubmission.position,
            status: view.mySubmission.status,
            submittedAt: view.mySubmission.submittedAt.toISOString(),
          }
        : null,
      count: view.count,
      myPosition: view.mySubmission?.position ?? null,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas/[id]/my-submission GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat submission.");
  }
}