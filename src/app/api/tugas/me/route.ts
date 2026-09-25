/**
 * GET /api/tugas/me
 * -----------------------------------------------------------------------------
 * Info user untuk halaman Tugas:
 *   - isAdmin: boolean (role === 'ADMIN')
 *   - managedCourses: course yang di-manage user (sebagai creator ATAU co-admin).
 *
 * Auth: harus login. Response shape:
 *   - 200 { success: true, isAdmin, managedCourses: [{id, name, code, token, isCreator}] }
 *   - 401 — belum login
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { publicErrorResponse } from "@/lib/server/request-guards";

export async function GET() {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
      select: { role: true },
    });
    if (!user) {
      return NextResponse.json({ success: false, error: "User tidak ditemukan." }, { status: 404 });
    }

    const isAdmin = user.role === "ADMIN";

    // Ambil course yang di-manage: sebagai creator (kalau admin) ATAU co-admin.
    const [asCreator, asCoAdmin] = await Promise.all([
      isAdmin
        ? prisma.course.findMany({
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, code: true, token: true, description: true, createdAt: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string; code: string; token: string; description: string | null; createdAt: Date }>),
      prisma.courseAdmin.findMany({
        where: { userId: auth.user.id },
        include: {
          course: {
            select: { id: true, name: true, code: true, token: true, description: true, createdAt: true },
          },
        },
      }),
    ]);

    const managedCourses = [
      ...asCreator.map((c) => ({ ...c, isCreator: true })),
      ...asCoAdmin
        // Hindari duplikat kalau user juga creator (defensive).
        .filter((row) => !asCreator.some((c) => c.id === row.course.id))
        .map((row) => ({
          id: row.course.id,
          name: row.course.name,
          code: row.course.code,
          token: row.course.token,
          description: row.course.description,
          createdAt: row.course.createdAt,
          isCreator: false,
        })),
    ];

    return NextResponse.json(
      { success: true, isAdmin, managedCourses },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/tugas/me failed:", error);
    return publicErrorResponse(error, "Gagal memuat info Tugas.");
  }
}