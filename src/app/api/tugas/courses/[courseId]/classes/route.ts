/**
 * POST /api/tugas/courses/[courseId]/classes
 * -----------------------------------------------------------------------------
 * Tambah kelas baru ke course. Auth: course admin.
 *
 *   body: { name }
 *   200 : { success, class: { id, name } }
 *   400 : name kosong / duplicate
 *   401 : belum login
 *   403 : bukan course admin
 *   404 : course tidak ditemukan
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

const ClassSchema = z.object({
  name: z.string().trim().min(1).max(40),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  let user;
  try {
    const { courseId } = await context.params;
    user = await requireCourseAdmin(courseId);
    // Continue with the same courseId (avoid re-await).
    return handleAddClass(req, courseId);
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: err.publicMessage }, { status: err.status });
    }
    return publicErrorResponse(err, "Gagal menambah kelas.");
  }
}

async function handleAddClass(req: Request, courseId: string) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = ClassSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Nama kelas tidak valid." },
      { status: 400 },
    );
  }
  const name = parsed.data.name.trim();

  try {
    // Course existence already verified by requireCourseAdmin, but skip the second hit.

    try {
      const created = await prisma.courseClass.create({
        data: { courseId, name },
        select: { id: true, name: true },
      });
      return NextResponse.json({ success: true, class: created }, { status: 201 });
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json(
          { success: false, error: "Kelas dengan nama ini sudah ada." },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("API /api/tugas/courses/[id]/classes POST failed:", error);
    return publicErrorResponse(error, "Gagal menambah kelas.");
  }
}