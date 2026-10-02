import { NextResponse } from "next/server";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { deleteCourseMaterial } from "@/lib/storage/course-materials";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ courseId: string; materialId: string }> },
) {
  try {
    const { courseId, materialId } = await context.params;
    await requireCourseAdmin(courseId);
    if (!(await deleteCourseMaterial(courseId, materialId))) {
      throw new ApiRequestError(404, "Materi tidak ditemukan.");
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API DELETE course material failed:", error);
    return publicErrorResponse(error, "Gagal menghapus materi.");
  }
}