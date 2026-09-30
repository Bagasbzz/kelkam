import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await context.params;
    const submission = await prisma.tugasSubmission.findUnique({
      where: { id: submissionId },
      select: {
        tugas: { select: { courseId: true } },
        fileUpload: { select: { filePath: true, originalName: true, mime: true } },
      },
    });
    if (!submission) throw new ApiRequestError(404, "Pengumpulan tidak ditemukan.");
    await requireCourseAdmin(submission.tugas.courseId);
    if (!submission.fileUpload) throw new ApiRequestError(404, "Pengumpulan ini tidak memiliki file.");

    const buffer = await fs.readFile(submission.fileUpload.filePath);
    const fileName = submission.fileUpload.originalName.replace(/[\\/\r\n"\x00-\x1f]/g, "_") || "lampiran";
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET submission download failed:", error);
    return publicErrorResponse(error, "Gagal mengunduh file.");
  }
}