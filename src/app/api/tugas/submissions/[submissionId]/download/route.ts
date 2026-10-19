import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { contentDisposition, streamFileResponse } from "@/lib/server/file-response";

export const runtime = "nodejs";

export async function GET(
  req: Request,
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

    // Streaming (bukan readFile) → file besar tidak ditahan di memori.
    const res = await streamFileResponse(req, submission.fileUpload.filePath, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDisposition("attachment", submission.fileUpload.originalName, "lampiran"),
      "Cache-Control": "private, no-store",
    });
    if (!res) throw new ApiRequestError(404, "File tidak ditemukan di server.");
    return res;
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET submission download failed:", error);
    return publicErrorResponse(error, "Gagal mengunduh file.");
  }
}
