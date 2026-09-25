/**
 * POST /api/tugas/courses/[courseId]/admins
 * -----------------------------------------------------------------------------
 * Tambah co-admin untuk course. Auth: course creator ONLY (anti privilege
 * escalation berlapis — co-admin tidak boleh nambah co-admin lain).
 *
 *   body: { email }
 *   200 : { success, admin: { id, email, name } }
 *   400 : email invalid / user bukan admin global / self-add
 *   401 : belum login
 *   403 : bukan creator course
 *   404 : course atau user tidak ditemukan
 *   409 : udah jadi admin
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireCourseCreator } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

const AdminSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid."),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  let courseId: string;
  try {
    const params = await context.params;
    courseId = params.courseId;
    await requireCourseCreator(courseId);
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: err.publicMessage }, { status: err.status });
    }
    return publicErrorResponse(err, "Gagal menambah admin.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = AdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Email tidak valid." },
      { status: 400 },
    );
  }
  const email = parsed.data.email;

  try {
    // Cari user by email. Pastikan dia ada DAN role=ADMIN.
    const targetUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true },
    });
    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: "User dengan email ini tidak ditemukan." },
        { status: 404 },
      );
    }
    if (targetUser.role !== "ADMIN") {
      return NextResponse.json(
        {
          success: false,
          error: "Hanya user dengan role ADMIN yang bisa jadi co-admin course.",
        },
        { status: 400 },
      );
    }

    try {
      const created = await prisma.courseAdmin.create({
        data: { courseId, userId: targetUser.id },
        select: { id: true },
      });

      return NextResponse.json(
        {
          success: true,
          admin: {
            id: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
            membershipId: created.id,
          },
        },
        { status: 201 },
      );
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json(
          { success: false, error: "User ini sudah jadi admin course." },
          { status: 409 },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("API /api/tugas/courses/[id]/admins POST failed:", error);
    return publicErrorResponse(error, "Gagal menambah admin.");
  }
}