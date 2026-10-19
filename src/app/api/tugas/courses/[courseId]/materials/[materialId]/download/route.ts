import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { contentDisposition, streamFileResponse } from "@/lib/server/file-response";
import { sanitizeMime } from "@/lib/security/file-types";
import { getCourseMaterialFile } from "@/lib/storage/course-materials";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ courseId: string; materialId: string }> },
) {
  try {
    const { courseId, materialId } = await context.params;
    const token = new URL(req.url).searchParams.get("token") || "";
    const course = await prisma.course.findFirst({
      where: { id: courseId, token: token.trim().toUpperCase() },
      select: { id: true },
    });
    if (!course) throw new ApiRequestError(404, "Course tidak ditemukan.");
    const found = await getCourseMaterialFile(courseId, materialId);
    if (!found) throw new ApiRequestError(404, "Materi tidak ditemukan.");

    // Streaming + Range → materi besar tidak dimuat ke memori; selalu attachment + nosniff.
    const res = await streamFileResponse(req, found.path, {
      "Content-Type": sanitizeMime(found.material.mime),
      "Content-Disposition": contentDisposition("attachment", found.material.originalName, "materi"),
      "Cache-Control": "private, no-store",
    });
    if (!res) throw new ApiRequestError(404, "Materi tidak ditemukan.");
    return res;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET course material download failed:", error);
    return publicErrorResponse(error, "Gagal mengunduh materi.");
  }
}
