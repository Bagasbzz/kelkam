/**
 * POST /api/tugas/tugas/[id]/submit
 * -----------------------------------------------------------------------------
 * Mahasiswa ngumpulkan tugas. Auth: login.
 *
 *   body: { classId, nim, name, note?, fileUploadId? }
 *   200  : { success, submission, position, total }
 *   400  : input tidak valid / duplicate (user sudah submit di tugas ini)
 *   401  : belum login
 *   403  : kelas tidak sesuai dengan classId di tugas (kalau restricted)
 *   404  : tugas / class / file upload tidak ditemukan
 *   410  : deadline sudah lewat (return Gone)
 *
 * Position di-assign atomic di dalam transaction (lihat position.ts).
 * Kalau deadline lewat, status jadi 'LATE'.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import {
  ApiRequestError,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import {
  assertClassCompatible,
  assertFileUploadOwnedBy,
  getTugasOrThrow,
} from "@/lib/server/tugas/access";
import { assignPosition } from "@/lib/server/tugas/position";

const SubmitSchema = z.object({
  classId: z.string().min(1, "Pilih kelas dulu."),
  nim: z.string().trim().min(3).max(40, "NIM tidak valid."),
  name: z.string().trim().min(1).max(120, "Nama tidak valid."),
  note: z.string().max(8000).optional(),
  fileUploadId: z.string().min(1).optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
      { status: 400 },
    );
  }
  const { classId, nim, name, note, fileUploadId } = parsed.data;

  try {
    const { id: tugasId } = await context.params;
    const tugas = await getTugasOrThrow(tugasId);

    // Kelas harus compatible (kalau tugas restricted ke class tertentu).
    await assertClassCompatible(classId, tugas.courseId, tugas.classId);

    // File upload (kalau ada) harus milik user.
    if (fileUploadId) {
      await assertFileUploadOwnedBy(fileUploadId, auth.user.id);
    }

    // Cek duplicate submission.
    const existing = await prisma.tugasSubmission.findUnique({
      where: { tugasId_userId: { tugasId, userId: auth.user.id } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Kamu sudah mengumpulkan tugas ini." },
        { status: 400 },
      );
    }

    const now = new Date();
    const isLate = now > tugas.deadline;
    const status = isLate ? "LATE" : "SUBMITTED";

    // Atomic: assign position + insert dalam transaction yang sama.
    const submission = await prisma.$transaction(async (tx) => {
      const position = await assignPosition(tx, tugasId);
      return tx.tugasSubmission.create({
        data: {
          tugasId,
          userId: auth.user.id,
          classId,
          nim,
          name,
          note: note ?? null,
          fileUploadId: fileUploadId ?? null,
          position,
          status,
        },
        include: {
          class: { select: { id: true, name: true } },
          fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
        },
      });
    });

    const total = await prisma.tugasSubmission.count({ where: { tugasId } });

    return NextResponse.json(
      {
        success: true,
        submission: {
          id: submission.id,
          tugasId: submission.tugasId,
          classId: submission.classId,
          class: submission.class,
          nim: submission.nim,
          name: submission.name,
          note: submission.note,
          fileUpload: submission.fileUpload,
          position: submission.position,
          status: submission.status,
          submittedAt: submission.submittedAt.toISOString(),
        },
        position: submission.position,
        total,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    // P2002 dari unique (tugasId, userId) — race condition antara cek & insert.
    const code = (error as { code?: string }).code;
    if (code === "P2002") {
      return NextResponse.json(
        { success: false, error: "Kamu sudah mengumpulkan tugas ini." },
        { status: 400 },
      );
    }
    console.error("API /api/tugas/tugas/[id]/submit failed:", error);
    return publicErrorResponse(error, "Gagal mengumpulkan tugas.");
  }
}