import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(8000),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    await requireCourseAdmin(courseId);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiRequestError(400, "Nama atau deskripsi mata kuliah tidak valid.");
    const course = await prisma.course.update({
      where: { id: courseId },
      data: { name: parsed.data.name, description: parsed.data.description || null },
      select: {
        id: true, name: true, code: true, description: true, token: true,
        createdAt: true, updatedAt: true,
        classes: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ success: true, course });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API PATCH course failed:", error);
    return publicErrorResponse(error, "Gagal mengubah mata kuliah.");
  }
}