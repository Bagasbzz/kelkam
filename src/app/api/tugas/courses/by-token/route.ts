/**
 * GET /api/tugas/courses/by-token?token=XXXX
 * -----------------------------------------------------------------------------
 * Lookup course publik by token. Dipakai mahasiswa yang belum login untuk
 * preview halaman course. Return:
 *   - 200 { success: true, course: {...}, tugases: [...] }
 *   - 400 — token tidak ada / kosong
 *   - 404 — token tidak ditemukan
 *   - 429 — rate limit (30 req / menit / IP)
 *
 * Auth: publik (proxy skip path ini — lihat PUBLIC_API_EXACT_PATHS).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function GET(req: Request) {
  // Rate limit per-IP (anti brute-force token).
  const rl = enforceRateLimit(`tugas-by-token:${clientIp(req)}`, {
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (rl) return rl;

  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim().toUpperCase();
    if (!token) {
      return NextResponse.json({ success: false, error: "Token kosong." }, { status: 400 });
    }

    const course = await prisma.course.findUnique({
      where: { token },
      include: {
        classes: { orderBy: { name: "asc" }, select: { id: true, name: true } },
      },
    });
    if (!course) {
      return NextResponse.json({ success: false, error: "Course tidak ditemukan." }, { status: 404 });
    }

    // List tugases (urut by deadline asc — yang paling dekat duluan).
    const tugases = await prisma.tugas.findMany({
      where: { courseId: course.id },
      orderBy: { deadline: "asc" },
      include: { class: { select: { id: true, name: true } } },
    });

    return NextResponse.json(
      {
        success: true,
        course: {
          id: course.id,
          name: course.name,
          code: course.code,
          description: course.description,
          token: course.token,
          classes: course.classes,
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
        },
        tugases: tugases.map((t) => ({
          id: t.id,
          courseId: t.courseId,
          classId: t.classId,
          class: t.class,
          title: t.title,
          description: t.description,
          deadline: t.deadline.toISOString(),
          createdAt: t.createdAt.toISOString(),
          updatedAt: t.updatedAt.toISOString(),
        })),
      },
      { headers: { "Cache-Control": "private, max-age=15" } },
    );
  } catch (error) {
    console.error("API /api/tugas/courses/by-token failed:", error);
    return publicErrorResponse(error, "Gagal memuat course.");
  }
}