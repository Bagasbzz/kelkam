import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

const schema = z.object({ name: z.string().trim().min(1).max(40) });

export async function PATCH(
  req: Request,
  context: { params: Promise<{ courseId: string; classId: string }> },
) {
  try {
    const { courseId, classId } = await context.params;
    await requireCourseAdmin(courseId);
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiRequestError(400, "Nama kelas tidak valid.");

    const updated = await prisma.courseClass.updateMany({
      where: { id: classId, courseId },
      data: { name: parsed.data.name },
    });
    if (!updated.count) throw new ApiRequestError(404, "Kelas tidak ditemukan.");
    return NextResponse.json({ success: true, class: { id: classId, name: parsed.data.name } });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "Kelas dengan nama ini sudah ada." }, { status: 409 });
    }
    console.error("API PATCH course class failed:", error);
    return publicErrorResponse(error, "Gagal mengubah kelas.");
  }
}