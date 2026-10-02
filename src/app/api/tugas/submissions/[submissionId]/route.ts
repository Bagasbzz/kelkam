import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await context.params;
    const existing = await prisma.tugasSubmission.findUnique({
      where: { id: submissionId },
      select: { tugasId: true, tugas: { select: { courseId: true } } },
    });
    if (!existing) throw new ApiRequestError(404, "Pengumpulan tidak ditemukan.");
    await requireCourseAdmin(existing.tugas.courseId);

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${existing.tugasId}))`;
      const row = await tx.tugasSubmission.findUnique({
        where: { id: submissionId },
        select: { tugasId: true, position: true },
      });
      if (!row || row.tugasId !== existing.tugasId) {
        throw new ApiRequestError(404, "Pengumpulan tidak ditemukan.");
      }
      const last = await tx.tugasSubmission.findFirst({
        where: { tugasId: row.tugasId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await tx.tugasSubmission.delete({ where: { id: submissionId } });
      const max = last?.position ?? row.position;
      await tx.tugasSubmission.updateMany({
        where: { tugasId: row.tugasId, position: { gt: row.position } },
        data: { position: { increment: max } },
      });
      await tx.tugasSubmission.updateMany({
        where: { tugasId: row.tugasId, position: { gt: max } },
        data: { position: { decrement: max + 1 } },
      });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API DELETE submission failed:", error);
    return publicErrorResponse(error, "Gagal menghapus pengumpulan.");
  }
}