/**
 * POST /api/tugas/admin/insights
 * -----------------------------------------------------------------------------
 * Global AI insights untuk super admin. Auth: User.role === 'ADMIN'.
 *
 * Aggregate SEMUA course + submissions → AI summary.
 *
 *   200: { success, courses: [...], globalInsight }
 *   403: bukan ADMIN
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError, enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";
import { requireAdmin } from "@/lib/server/auth";
import { sendToAIForPurpose } from "@/lib/ai/client";

export async function POST() {
  try {
    const user = await requireAdmin();
    const limit = enforceRateLimit(`tugas-admin-insights:${user.id}`, {
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (limit) return limit;

    const courses = await prisma.course.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        token: true,
        tugases: {
          select: {
            id: true,
            title: true,
            _count: { select: { submissions: true } },
            submissions: { select: { status: true } },
          },
        },
        _count: { select: { mahasiswas: true } },
      },
    });

    const summary = courses.map((c) => {
      const total = c.tugases.reduce((acc, t) => acc + t._count.submissions, 0);
      const late = c.tugases.reduce(
        (acc, t) => acc + t.submissions.filter((s) => s.status === "LATE").length,
        0,
      );
      return {
        id: c.id,
        token: c.token,
        name: c.name,
        code: c.code,
        tugasesCount: c.tugases.length,
        totalSubmissions: total,
        lateSubmissions: late,
        lateRate: total > 0 ? late / total : 0,
        rosterCount: c._count.mahasiswas,
      };
    });

    const totalSubmissions = summary.reduce((acc, c) => acc + c.totalSubmissions, 0);
    const totalLate = summary.reduce((acc, c) => acc + c.lateSubmissions, 0);
    const topCourses = summary
      .filter((c) => c.totalSubmissions > 0)
      .sort((a, b) => b.totalSubmissions - a.totalSubmissions)
      .slice(0, 5);

    const lines = summary
      .map(
        (c) =>
          `- ${c.name} (${c.code}): ${c.tugasesCount} tugas, ${c.totalSubmissions} submit (telat ${c.lateSubmissions}, ${(c.lateRate * 100).toFixed(0)}%), roster ${c.rosterCount}`,
      )
      .join("\n");

    const prompt = `Snapshot platform keluhkampus Tugas:
- Total course aktif: ${summary.length}
- Total submission: ${totalSubmissions}, telat: ${totalLate} (${totalSubmissions > 0 ? ((totalLate / totalSubmissions) * 100).toFixed(0) : 0}%)
- 5 course paling aktif: ${topCourses.map((c) => c.name).join(", ") || "(belum ada)"}

Per-course:
${lines}

Berikan 3-4 insight level platform untuk super admin. Bahasa Indonesia, bullet (-), profesional, actionable. Fokus pada course yang perlu di-intervensi, pola telat global, dan health metrics. Maks 100 kata.`;

    let globalInsight: string;
    try {
      globalInsight = await sendToAIForPurpose(prompt, undefined, "fast");
    } catch (err) {
      globalInsight = `_(AI belum tersedia: ${err instanceof Error ? err.message : "unknown"}_)`;
    }

    return NextResponse.json({ success: true, courses: summary, globalInsight });
  } catch (error) {
    if (error instanceof ApiRequestError) {
      return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    }
    console.error("API /api/tugas/admin/insights POST failed:", error);
    return publicErrorResponse(error, "Gagal generate global insights.");
  }
}