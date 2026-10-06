/**
 * /api/tugas/tugas/[id]/submit
 * -----------------------------------------------------------------------------
 * POST  — mahasiswa mengumpulkan tugas (pertama kali).
 * PATCH — mahasiswa mengubah pengumpulannya sendiri selama deadline belum lewat.
 *         Urutan (position) dan status TIDAK berubah; hanya isi yang diganti dan
 *         `updatedAt` diisi supaya UI bisa menampilkan "Diubah <waktu>".
 *
 *   body: { classId, nim, name, note?, fileUploadId? }
 *   POST  201 { success, submission, position, total }
 *   PATCH 200 { success, submission, position, total }
 *   400 : input tidak valid / (POST) sudah pernah mengumpulkan
 *   401 : belum login
 *   404 : tugas / (PATCH) pengumpulan tidak ditemukan
 *   410 : (PATCH) deadline sudah lewat — tidak bisa diubah lagi
 *
 * Position di-assign atomic di dalam transaction (lihat position.ts).
 * Kalau POST datang setelah deadline, status jadi 'LATE' tapi tetap disimpan.
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
import { assignPositionWithRetry, isPrismaUniqueViolation } from "@/lib/server/tugas/position";
import { serializeSubmission, submissionInclude } from "@/lib/server/tugas/serialize";

export const runtime = "nodejs";
export const maxDuration = 60;

const SubmitSchema = z.object({
  classId: z.string().min(1, "Pilih kelas dulu."),
  nim: z.string().trim().min(3, "NIM terlalu pendek.").max(40, "NIM tidak valid."),
  name: z.string().trim().min(1, "Isi nama dulu.").max(120, "Nama tidak valid."),
  note: z.string().max(8000).optional(),
  fileUploadId: z.string().min(1).optional(),
});

type ParsedInput = z.infer<typeof SubmitSchema>;

async function readInput(req: Request): Promise<ParsedInput | NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Data tidak terbaca." }, { status: 400 });
  }
  const parsed = SubmitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Data tidak valid." },
      { status: 400 },
    );
  }
  if (!parsed.data.fileUploadId && !parsed.data.note?.trim()) {
    return NextResponse.json(
      { success: false, error: "Isi catatan atau lampirkan file." },
      { status: 400 },
    );
  }
  return parsed.data;
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const input = await readInput(req);
  if (input instanceof NextResponse) return input;
  const { classId, nim, name, note, fileUploadId } = input;

  try {
    const { id: tugasId } = await context.params;
    const tugas = await getTugasOrThrow(tugasId);

    await assertClassCompatible(classId, tugas.courseId, tugas.classId);
    if (fileUploadId) {
      await assertFileUploadOwnedBy(fileUploadId, auth.user.id);
    }

    const existing = await prisma.tugasSubmission.findUnique({
      where: { tugasId_userId: { tugasId, userId: auth.user.id } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Kamu sudah mengumpulkan tugas ini. Gunakan tombol ubah." },
        { status: 400 },
      );
    }

    const isLate = new Date() > tugas.deadline;
    const status = isLate ? "LATE" : "SUBMITTED";

    const submission = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${tugasId}))`;
      const { position } = await assignPositionWithRetry(tx, tugasId);
      return tx.tugasSubmission.create({
        data: {
          tugasId,
          userId: auth.user.id,
          classId,
          nim,
          name,
          note: note?.trim() || null,
          fileUploadId: fileUploadId ?? null,
          position,
          status,
        },
        include: submissionInclude,
      });
    });

    const total = await prisma.tugasSubmission.count({ where: { tugasId } });

    return NextResponse.json(
      {
        success: true,
        submission: serializeSubmission(submission),
        position: submission.position,
        total,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    if (isPrismaUniqueViolation(error)) {
      const target = (error as { meta?: { target?: string[] } }).meta?.target ?? [];
      if (target.includes("tugas_id_user_id")) {
        return NextResponse.json(
          { success: false, error: "Kamu sudah mengumpulkan tugas ini. Gunakan tombol ubah." },
          { status: 400 },
        );
      }
      console.warn("Position race bocor:", target);
      return NextResponse.json(
        { success: false, error: "Server sedang sibuk, coba lagi sebentar." },
        { status: 503 },
      );
    }
    console.error("API POST /api/tugas/tugas/[id]/submit failed:", error);
    return publicErrorResponse(error, "Gagal mengumpulkan tugas.");
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const input = await readInput(req);
  if (input instanceof NextResponse) return input;
  const { classId, nim, name, note, fileUploadId } = input;

  try {
    const { id: tugasId } = await context.params;
    const tugas = await getTugasOrThrow(tugasId);

    const existing = await prisma.tugasSubmission.findUnique({
      where: { tugasId_userId: { tugasId, userId: auth.user.id } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Kamu belum mengumpulkan tugas ini." },
        { status: 404 },
      );
    }

    if (new Date() > tugas.deadline) {
      return NextResponse.json(
        { success: false, error: "Batas waktu sudah lewat, pengumpulan tidak bisa diubah lagi." },
        { status: 410 },
      );
    }

    await assertClassCompatible(classId, tugas.courseId, tugas.classId);
    if (fileUploadId) {
      await assertFileUploadOwnedBy(fileUploadId, auth.user.id);
    }

    const submission = await prisma.tugasSubmission.update({
      where: { id: existing.id },
      data: {
        classId,
        nim,
        name,
        note: note?.trim() || null,
        fileUploadId: fileUploadId ?? null,
        updatedAt: new Date(),
      },
      include: submissionInclude,
    });

    const total = await prisma.tugasSubmission.count({ where: { tugasId } });

    return NextResponse.json({
      success: true,
      submission: serializeSubmission(submission),
      position: submission.position,
      total,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API PATCH /api/tugas/tugas/[id]/submit failed:", error);
    return publicErrorResponse(error, "Gagal mengubah pengumpulan.");
  }
}
