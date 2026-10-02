import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { listCourseMaterials, saveCourseMaterial } from "@/lib/storage/course-materials";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_MATERIAL_BYTES = 12 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".ppt", ".pptx", ".pdf"]);

function extensionOf(name: string): string {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

async function courseForToken(courseId: string, token: string) {
  return prisma.course.findFirst({ where: { id: courseId, token: token.trim().toUpperCase() }, select: { id: true } });
}

export async function GET(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const token = new URL(req.url).searchParams.get("token") || "";
    if (!(await courseForToken(courseId, token))) throw new ApiRequestError(404, "Course tidak ditemukan.");
    return NextResponse.json({ success: true, materials: await listCourseMaterials(courseId) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API GET course materials failed:", error);
    return publicErrorResponse(error, "Gagal memuat materi.");
  }
}

export async function POST(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    await requireCourseAdmin(courseId);
    const fileValue = (await req.formData()).get("file");
    const file = fileValue instanceof File ? fileValue : null;
    if (!file) throw new ApiRequestError(400, "File tidak ditemukan.");
    const originalName = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    const extension = extensionOf(originalName);
    if (!originalName || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new ApiRequestError(400, "Materi harus berupa PPT, PPTX, atau PDF.");
    }
    if (file.size <= 0 || file.size > MAX_MATERIAL_BYTES) {
      throw new ApiRequestError(413, "Ukuran materi maksimal 12 MB.");
    }
    const material = await saveCourseMaterial({
      courseId,
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName,
      mime: file.type || "application/octet-stream",
    });
    return NextResponse.json({ success: true, material }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API POST course material failed:", error);
    return publicErrorResponse(error, "Gagal mengunggah materi.");
  }
}