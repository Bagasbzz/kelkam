import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { readCourseMaterial } from "@/lib/storage/course-materials";

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
    const result = await readCourseMaterial(courseId, materialId);
    if (!result) throw new ApiRequestError(404, "Materi tidak ditemukan.");
    const fileName = result.material.originalName.replace(/[\\/\r\n"\x00-\x1f]/g, "_") || "materi";
    return new NextResponse(new Uint8Array(result.buffer), {
      headers: {
        "Content-Type": result.material.mime || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET course material download failed:", error);
    return publicErrorResponse(error, "Gagal mengunduh materi.");
  }
}