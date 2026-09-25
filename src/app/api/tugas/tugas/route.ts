/**
 * /api/tugas/tugas
 * -----------------------------------------------------------------------------
 * POST  — Buat tugas baru di course. Auth: course admin.
 * GET   — List tugas untuk course tertentu. Auth: login + akses course.
 *
 *   POST body: { courseId, classId?, title, description, deadline(ISO) }
 *   GET  query: ?courseId=...
 *
 *   POST 200 : { success, tugas: TugasSummary }
 *   GET  200 : { success, tugases: TugasSummary[] }
 *   400 : input tidak valid
 *   401 : belum login
 *   403 : POST butuh course admin; GET butuh course admin ATAU enrolled
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  authenticateRequestFromCookie,
  requireCourseAdmin,
} from "@/lib/server/auth";
import {
  ApiRequestError,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import { assertClassBelongsToCourse } from "@/lib/server/tugas/access";

const TugasCreateSchema = z.object({
  courseId: z.string().min(1),
  classId: z.string().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(8000).default(""),
  deadline: z.string().datetime({ message: "Deadline harus ISO 8601." }),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body harus JSON." }, { status: 400 });
  }

  const parsed = TugasCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." },
      { status: 400 },
    );
  }
  const { courseId, classId, title, description, deadline } = parsed.data;

  try {
    const user = await requireCourseAdmin(courseId);

    const deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
      return NextResponse.json(
        { success: false, error: "Deadline tidak valid." },
        { status: 400 },
      );
    }

    if (classId) {
      await assertClassBelongsToCourse(classId, courseId);
    }

    const tugas = await prisma.tugas.create({
      data: {
        courseId,
        classId: classId ?? null,
        title,
        description,
        deadline: deadlineDate,
        createdById: user.id,
      },
      include: { class: { select: { id: true, name: true } } },
    });

    return NextResponse.json(
      {
        success: true,
        tugas: serializeTugas(tugas),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/tugas POST failed:", error);
    return publicErrorResponse(error, "Gagal membuat tugas.");
  }
}

export async function GET(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId");
    if (!courseId) {
      return NextResponse.json(
        { success: false, error: "courseId wajib diisi." },
        { status: 400 },
      );
    }

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return NextResponse.json(
        { success: false, error: "Course tidak ditemukan." },
        { status: 404 },
      );
    }

    // Cek akses: course admin ATAU enrolled.
    const [adminRow, enrollmentRow] = await Promise.all([
      auth.user.role === "ADMIN"
        ? Promise.resolve(true)
        : prisma.courseAdmin
            .findUnique({
              where: { courseId_userId: { courseId, userId: auth.user.id } },
              select: { id: true },
            })
            .then(Boolean),
      prisma.courseEnrollment.findUnique({
        where: { courseId_userId: { courseId, userId: auth.user.id } },
        select: { id: true },
      }),
    ]);

    const hasAccess = adminRow || enrollmentRow || auth.user.role === "ADMIN";
    if (!hasAccess) {
      return NextResponse.json(
        { success: false, error: "Kamu belum terdaftar di course ini." },
        { status: 403 },
      );
    }

    const tugases = await prisma.tugas.findMany({
      where: { courseId },
      orderBy: { deadline: "asc" },
      include: { class: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      success: true,
      tugases: tugases.map(serializeTugas),
    });
  } catch (error) {
    console.error("API /api/tugas/tugas GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat daftar tugas.");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serializeTugas(t: {
  id: string;
  courseId: string;
  classId: string | null;
  class: { id: string; name: string } | null;
  title: string;
  description: string;
  deadline: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    courseId: t.courseId,
    classId: t.classId,
    class: t.class,
    title: t.title,
    description: t.description,
    deadline: t.deadline.toISOString(),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}