/**
 * /api/tugas/submissions/[submissionId]/feedback
 * -----------------------------------------------------------------------------
 * Admin course memberi satu catatan (feedback) ke pengumpulan mahasiswa.
 *
 *   PUT    body { feedback: string }  → set / ubah catatan
 *   DELETE                            → hapus catatan
 *
 *   200 { success, submission }
 *   400 catatan kosong / terlalu panjang
 *   401 belum login   403 bukan admin course   404 pengumpulan tidak ditemukan
 *
 * `updatedAt` milik mahasiswa TIDAK disentuh — label "Diubah" di UI hanya
 * mencerminkan perubahan oleh mahasiswa.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { serializeSubmission, submissionInclude } from "@/lib/server/tugas/serialize";

const FeedbackSchema = z.object({
  feedback: z
    .string()
    .trim()
    .min(1, "Catatan tidak boleh kosong.")
    .max(4000, "Catatan terlalu panjang (maks. 4000 karakter)."),
});

async function loadForAdmin(submissionId: string) {
  const row = await prisma.tugasSubmission.findUnique({
    where: { id: submissionId },
    select: { id: true, tugas: { select: { courseId: true } } },
  });
  if (!row) throw new ApiRequestError(404, "Pengumpulan tidak ditemukan.");
  const admin = await requireCourseAdmin(row.tugas.courseId);
  return { id: row.id, adminId: admin.id };
}

const adminInclude = {
  ...submissionInclude,
  user: { select: { id: true, email: true, name: true } },
} as const;

export async function PUT(
  req: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await context.params;
    const { id, adminId } = await loadForAdmin(submissionId);

    const body = await req.json().catch(() => null);
    const parsed = FeedbackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Catatan tidak valid." },
        { status: 400 },
      );
    }

    const submission = await prisma.tugasSubmission.update({
      where: { id },
      data: { feedback: parsed.data.feedback, feedbackAt: new Date(), feedbackById: adminId },
      include: adminInclude,
    });
    return NextResponse.json({ success: true, submission: serializeSubmission(submission) });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API PUT feedback failed:", error);
    return publicErrorResponse(error, "Gagal menyimpan catatan.");
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  try {
    const { submissionId } = await context.params;
    const { id } = await loadForAdmin(submissionId);

    const submission = await prisma.tugasSubmission.update({
      where: { id },
      data: { feedback: null, feedbackAt: null, feedbackById: null },
      include: adminInclude,
    });
    return NextResponse.json({ success: true, submission: serializeSubmission(submission) });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API DELETE feedback failed:", error);
    return publicErrorResponse(error, "Gagal menghapus catatan.");
  }
}
