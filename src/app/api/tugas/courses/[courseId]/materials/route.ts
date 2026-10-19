import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireCourseAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { BLOCKED_FILE_MESSAGE, isBlockedFileName, resolveMime, sanitizeMime } from "@/lib/security/file-types";
import { isSensitivePath } from "@/lib/security/redact-secrets";
import { listCourseMaterials, saveCourseMaterial, saveCourseMaterialFromFile } from "@/lib/storage/course-materials";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Batas jalur multipart lama saja; jalur `fileId` (upload-admin) tanpa batas. */
const MAX_MULTIPART_MATERIAL_BYTES = 12 * 1024 * 1024;
const MATERIAL_TITLE_MAX = 120;
const MATERIAL_DESCRIPTION_MAX = 600;

function cleanMaterialText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Materi selalu diunduh sebagai attachment, jadi semua tipe boleh kecuali executable/credential. */
function assertMaterialName(name: string): void {
  if (!name) throw new ApiRequestError(400, "Nama file tidak valid.");
  if (isBlockedFileName(name)) throw new ApiRequestError(415, BLOCKED_FILE_MESSAGE);
  if (isSensitivePath(name)) throw new ApiRequestError(400, "File rahasia atau credential tidak boleh diunggah.");
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

/**
 * Dua mode:
 *   1. JSON `{ fileId, title?, description? }` → file sudah diunggah via
 *      /api/files/upload-admin (streaming, tanpa batas ukuran). Disalin dari disk.
 *   2. multipart `file` (kompatibilitas lama) → maks 12 MB.
 */
export async function POST(req: Request, context: { params: Promise<{ courseId: string }> }) {
  try {
    const { courseId } = await context.params;
    const user = await requireCourseAdmin(courseId);
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { fileId?: unknown; title?: unknown; description?: unknown } | null;
      const fileId = typeof body?.fileId === "string" ? body.fileId : "";
      if (!fileId) throw new ApiRequestError(400, "fileId wajib diisi.");
      const upload = await prisma.fileUpload.findFirst({
        where: { id: fileId, ownerId: user.id },
        select: { filePath: true, originalName: true, mime: true },
      });
      if (!upload) throw new ApiRequestError(404, "File tidak ditemukan atau bukan milik Anda.");
      const originalName = upload.originalName.replace(/[\r\n]/g, "").slice(0, 200);
      assertMaterialName(originalName);
      const material = await saveCourseMaterialFromFile({
        courseId,
        sourcePath: upload.filePath,
        originalName,
        mime: sanitizeMime(upload.mime),
        title: cleanMaterialText(body?.title, MATERIAL_TITLE_MAX),
        description: cleanMaterialText(body?.description, MATERIAL_DESCRIPTION_MAX),
      });
      return NextResponse.json({ success: true, material }, { status: 201 });
    }

    const form = await req.formData();
    const fileValue = form.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    if (!file) throw new ApiRequestError(400, "File tidak ditemukan.");
    const originalName = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    assertMaterialName(originalName);
    if (file.size <= 0 || file.size > MAX_MULTIPART_MATERIAL_BYTES) {
      throw new ApiRequestError(413, "Ukuran materi maksimal 12 MB lewat jalur ini. Gunakan upload admin untuk file besar.");
    }
    const material = await saveCourseMaterial({
      courseId,
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName,
      mime: resolveMime(originalName, file.type),
      title: cleanMaterialText(form.get("title"), MATERIAL_TITLE_MAX),
      description: cleanMaterialText(form.get("description"), MATERIAL_DESCRIPTION_MAX),
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
