import { NextResponse } from "next/server";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { deleteCourseMaterial, updateCourseMaterial } from "@/lib/storage/course-materials";

export const runtime = "nodejs";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 600;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ courseId: string; materialId: string }> },
) {
  try {
    const { courseId, materialId } = await context.params;
    await requireCourseAdmin(courseId);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const material = await updateCourseMaterial(courseId, materialId, {
      title: cleanText(body.title, TITLE_MAX),
      description: cleanText(body.description, DESCRIPTION_MAX),
    });
    if (!material) throw new ApiRequestError(404, "Materi tidak ditemukan.");
    return NextResponse.json({ success: true, material });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API PATCH course material failed:", error);
    return publicErrorResponse(error, "Gagal menyimpan materi.");
  }
}

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