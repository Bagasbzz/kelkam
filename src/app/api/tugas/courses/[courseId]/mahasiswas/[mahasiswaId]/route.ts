/**
 * PATCH /api/tugas/courses/[courseId]/mahasiswas/[mahasiswaId]
 * DELETE /api/tugas/courses/[courseId]/mahasiswas/[mahasiswaId]
 * -----------------------------------------------------------------------------
 * Edit/hapus 1 row roster. Auth: course admin.
 *
 * PATCH body: { nim?, name?, classId?, email? }
 * DELETE: hapus row.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { requireCourseAdmin } from "@/lib/server/auth";

const PatchSchema = z.object({
  nim: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  classId: z.string().min(1).nullable().optional(),
  email: z.string().trim().email().optional().or(z.literal("")),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ courseId: string; mahasiswaId: string }> },
) {
  try {
    const { courseId, mahasiswaId } = await context.params;
    await requireCourseAdmin(courseId);
    const body = await req.json().catch(() => null);
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
        { status: 400 },
      );
    }
    const data: Record<string, unknown> = {};
    if (parsed.data.nim) data.nim = parsed.data.nim;
    if (parsed.data.name) data.name = parsed.data.name;
    if ("classId" in parsed.data) data.classId = parsed.data.classId;
    if ("email" in parsed.data) data.email = parsed.data.email || null;
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ success: false, error: "Tidak ada field yang diubah." }, { status: 400 });
    }
    const m = await prisma.mahasiswa.update({
      where: { id: mahasiswaId },
      data,
      select: { id: true, nim: true, name: true, email: true, classId: true },
    });
    return NextResponse.json({ success: true, mahasiswa: m });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/courses/[id]/mahasiswas/[mahasiswaId] PATCH failed:", error);
    return publicErrorResponse(error, "Gagal update mahasiswa.");
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ courseId: string; mahasiswaId: string }> },
) {
  try {
    const { courseId, mahasiswaId } = await context.params;
    await requireCourseAdmin(courseId);
    await prisma.mahasiswa.delete({ where: { id: mahasiswaId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/courses/[id]/mahasiswas/[mahasiswaId] DELETE failed:", error);
    return publicErrorResponse(error, "Gagal hapus mahasiswa.");
  }
}