/**
 * GET /api/tugas/me/submissions?courseId=...
 * -----------------------------------------------------------------------------
 * List SEMUA submission user dalam 1 course, plus tugases yang belum di-submit.
 *
 * Auth: login. User cuma lihat data milik sendiri.
 *
 * Return:
 *   {
 *     submitted: TugasSummary[]      (yang sudah di-submit, beserta status LATE/SUBMITTED + submittedAt)
 *     missed: TugasSummary[]         (deadline lewat, belum submit)
 *     pending: TugasSummary[]        (deadline belum lewat, belum submit)
 *     counts: { submitted, missed, pending }
 *   }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

export async function GET(req: Request) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId");
    if (!courseId) {
      return NextResponse.json({ success: false, error: "courseId wajib diisi." }, { status: 400 });
    }

    const tugases = await prisma.tugas.findMany({
      where: { courseId },
      orderBy: { deadline: "desc" },
      select: {
        id: true,
        courseId: true,
        classId: true,
        title: true,
        description: true,
        deadline: true,
        createdAt: true,
        updatedAt: true,
        submissions: {
          where: { userId: auth.user.id },
          select: {
            id: true,
            status: true,
            submittedAt: true,
            position: true,
            updatedAt: true,
            feedback: true,
            feedbackAt: true,
            class: { select: { id: true, name: true } },
            fileUpload: { select: { id: true, originalName: true, mime: true, size: true } },
          },
          take: 1,
        },
      },
    });

    const now = Date.now();
    const submitted: Array<typeof tugases[number] & { mySubmission: typeof tugases[number]["submissions"][number] }> = [];
    const missed: typeof tugases = [];
    const pending: typeof tugases = [];

    for (const t of tugases) {
      const sub = t.submissions[0];
      if (sub) {
        submitted.push({ ...t, mySubmission: sub });
      } else if (new Date(t.deadline).getTime() < now) {
        missed.push(t);
      } else {
        pending.push(t);
      }
    }

    return NextResponse.json({
      success: true,
      submitted,
      missed,
      pending,
      counts: {
        submitted: submitted.length,
        missed: missed.length,
        pending: pending.length,
      },
    });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/me/submissions GET failed:", error);
    return publicErrorResponse(error, "Gagal memuat riwayat.");
  }
}