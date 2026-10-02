/**
 * POST /api/tugas/courses/[courseId]/insights
 * -----------------------------------------------------------------------------
 * AI summary untuk course. Auth: course admin.
 *
 * Aggregate submission metrics + panggil AI untuk narasi insight.
 *
 *   body: kosong (atau optional { force: true })
 *   200  : { success, metrics, aiInsights }
 *
 * Rate limit: 10/10min per admin (biar gak spam).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { requireCourseAdmin } from "@/lib/server/auth";
import { sendToAIForPurpose } from "@/lib/ai/client";

export async function POST(
  req: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    const user = await requireCourseAdmin(courseId);

    const limit = enforceRateLimit(`tugas-insights:${user.id}`, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limit) return limit;

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        code: true,
        classes: { select: { id: true, name: true } },
        tugases: {
          select: {
            id: true,
            title: true,
            deadline: true,
            _count: { select: { submissions: true } },
            submissions: {
              select: { id: true, status: true, submittedAt: true, classId: true },
            },
          },
          orderBy: { deadline: "desc" },
          take: 10,
        },
      },
    });
    if (!course) {
      throw new ApiRequestError(404, "Course tidak ditemukan.");
    }

    const totalSubmissions = course.tugases.reduce((acc, t) => acc + t._count.submissions, 0);
    const totalLate = course.tugases.reduce(
      (acc, t) => acc + t.submissions.filter((s) => s.status === "LATE").length,
      0,
    );
    const perClass: Record<string, number> = {};
    for (const t of course.tugases) {
      for (const s of t.submissions) {
        const cn = course.classes.find((c) => c.id === s.classId)?.name ?? "?";
        perClass[cn] = (perClass[cn] ?? 0) + 1;
      }
    }
    const rosterCount = await prisma.mahasiswa.count({ where: { courseId } });

    const metrics = {
      totalSubmissions,
      totalLate,
      lateRate: totalSubmissions > 0 ? (totalLate / totalSubmissions) : 0,
      rosterCount,
      perClass,
      tugasesCount: course.tugases.length,
    };

    // Build prompt untuk AI.
    const tugasesSummary = course.tugases.map((t) => {
      const submitted = t._count.submissions;
      const late = t.submissions.filter((s) => s.status === "LATE").length;
      const overdue = new Date(t.deadline).getTime() < Date.now();
      return `- "${t.title}" (deadline ${new Date(t.deadline).toLocaleDateString("id-ID")}${overdue ? ", SUDAH LEWAT" : ""}): ${submitted} submit, ${late} telat`;
    }).join("\n");

    const perClassLine = Object.entries(perClass).length > 0
      ? `Per kelas: ${Object.entries(perClass).map(([k, v]) => `${k}=${v}`).join(", ")}`
      : "Belum ada submission per kelas.";

    const prompt = `Course: ${course.name} (${course.code})
Roster size: ${rosterCount} mahasiswa
Total submission (10 tugas terakhir): ${totalSubmissions}, telat: ${totalLate} (${(metrics.lateRate * 100).toFixed(0)}%)
${perClassLine}

Daftar tugas:
${tugasesSummary}

Berikan insight actionable dalam 3-4 poin singkat untuk asdos. Bahasa Indonesia, format bullet (- poin), profesional, langsung bisa ditindaklanjuti. Fokus pada: pola telat, kelas yang perlu di-reminder, rekomendasi deadline, hal penting lainnya. Maksimal 80 kata total.`;

    let aiInsights: string;
    try {
      aiInsights = await sendToAIForPurpose(prompt, undefined, "fast");
    } catch (err) {
      const status = typeof err === "object" && err !== null && "status" in err ? err.status : "unknown";
      console.error("AI Insights generation failed (status):", status);
      aiInsights = "AI Insights sedang tidak tersedia. Statistik pengumpulan tetap dapat dilihat. Hubungi pengelola untuk memeriksa konfigurasi AI server.";
    }

    return NextResponse.json({ success: true, metrics, aiInsights });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/courses/[id]/insights POST failed:", error);
    return publicErrorResponse(error, "Gagal generate insights.");
  }
}