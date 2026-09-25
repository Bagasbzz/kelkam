/**
 * POST /api/tugas/courses
 * -----------------------------------------------------------------------------
 * Buat course baru. Bikin kelas sekaligus (minimal 1). Auth: ADMIN global.
 *
 *   body: { name, code, description?, classes: string[] }
 *   200  : { success, course: CourseSummary }
 *   401  : belum login
 *   403  : role !== 'ADMIN'
 *   409  : token tabrakan (sangat jarang; retry otomatis sampai 3x)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { generateCourseToken } from "@/lib/server/tugas/tokens";

const CourseCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(1).max(40),
  description: z.string().trim().max(2000).optional(),
  classes: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
});

export async function POST(req: Request) {
  let user;
  try {
    user = await requireAdmin();
  } catch (err) {
    if (err instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: err.publicMessage }, { status: err.status });
    }
    return publicErrorResponse(err, "Gagal membuat course.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = CourseCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
      { status: 400 },
    );
  }
  const { name, code, description, classes } = parsed.data;

  try {
    // Retry token generation sampai 3x kalau tabrakan (sangat jarang di 36-bit space).
    const MAX_TRIES = 3;
    let course;
    for (let i = 0; i < MAX_TRIES; i++) {
      const token = generateCourseToken();
      try {
        course = await prisma.course.create({
          data: {
            name,
            code,
            description: description ?? null,
            token,
            createdById: user.id,
            classes: {
              create: dedupeClasses(classes).map((clsName) => ({ name: clsName })),
            },
          },
          include: { classes: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
        });
        break;
      } catch (err: unknown) {
        // P2002 = unique constraint violation. Coba token baru.
        const code = (err as { code?: string }).code;
        if (code !== "P2002") throw err;
        if (i === MAX_TRIES - 1) throw err;
      }
    }

    if (!course) {
      return NextResponse.json(
        { success: false, error: "Gagal membuat token unik." },
        { status: 500 },
      );
    }

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
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("API /api/tugas/courses POST failed:", error);
    return publicErrorResponse(error, "Gagal membuat course.");
  }
}

function dedupeClasses(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = n.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}