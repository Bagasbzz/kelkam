/**
 * /api/tugas/tugas/[id]
 * -----------------------------------------------------------------------------
 * PATCH  — Edit tugas. Auth: course admin. Field partial.
 * DELETE — Hapus tugas. Auth: course admin. Cascade hapus submissions.
 *
 *   PATCH body: partial({ title, description, deadline, classId })
 *   200 : { success, tugas }
 *   401 : belum login
 *   403 : bukan course admin
 *   404 : tugas tidak ditemukan
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import {
  ApiRequestError,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import {
  assertClassBelongsToCourse,
  getTugasOrThrow,
} from "@/lib/server/tugas/access";

const TugasPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(8000),
    deadline: z.string().datetime(),
    classId: z.string().min(1).nullable(),
  })
  .partial();

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = TugasPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
      { status: 400 },
    );
  }
  const patch = parsed.data;

  try {
    const { id } = await context.params;
    const existing = await getTugasOrThrow(id);
    await requireCourseAdmin(existing.courseId);

    // Validasi class kalau ada di patch.
    if (patch.classId !== undefined && patch.classId !== null) {
      await assertClassBelongsToCourse(patch.classId, existing.courseId);
    }

    const data: Record<string, unknown> = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.deadline !== undefined) {
      const d = new Date(patch.deadline);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { success: false, error: "Deadline tidak valid." },
          { status: 400 },
        );
      }
      data.deadline = d;
    }
    if (patch.classId !== undefined) {
      data.classId = patch.classId; // bisa null = semua kelas
    }

    const updated = await prisma.tugas.update({
      where: { id },
      data,
      include: { class: { select: { id: true, name: true } } },
    });

    return NextResponse.json({ success: true, tugas: serializeTugas(updated) });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas/[id] PATCH failed:", error);
    return publicErrorResponse(error, "Gagal mengubah tugas.");
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const existing = await getTugasOrThrow(id);
    await requireCourseAdmin(existing.courseId);

    // Cascade submissions (FK onDelete: Cascade).
    await prisma.tugas.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas/[id] DELETE failed:", error);
    return publicErrorResponse(error, "Gagal menghapus tugas.");
  }
}

function serializeTugas(t: {
  id: string;
  courseId: string;
  classId: string | null;
  class: { id: string; name: string } | null;
  title: string;
  description: string;
  deadline: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    courseId: t.courseId,
    classId: t.classId,
    class: t.class,
    title: t.title,
    description: t.description,
    deadline: t.deadline.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}