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
import { serializeSubmission } from "@/lib/server/tugas/serialize";

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
      submission: view.mySubmission ? serializeSubmission(view.mySubmission) : null,
      count: view.count,
      myPosition: view.mySubmission?.position ?? null,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas/[id]/my-submission GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat pengumpulan.");
  }
}