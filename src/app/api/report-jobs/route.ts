/**
 * GET /api/report-jobs?mode=ringkas|lengkap&limit=20
 * Daftar job laporan milik user (terbaru dulu) + job aktif terakhir untuk
 * auto-resume di UI setelah refresh/tab tertutup.
 */

import { NextResponse } from "next/server";
import { findActiveReportJob, listReportJobs } from "@/lib/report/report-jobs";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

export async function GET(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`report-list:${auth.user.id}`, { limit: 120, windowMs: 10 * 60 * 1000 });
  if (rateLimit) return rateLimit;

  const url = new URL(req.url);
  const modeParam = url.searchParams.get("mode");
  const mode = modeParam === "ringkas" || modeParam === "lengkap" ? modeParam : undefined;
  const limit = Number(url.searchParams.get("limit") || 20);

  try {
    const [jobs, active] = await Promise.all([
      listReportJobs(auth.user.id, Number.isFinite(limit) ? limit : 20),
      findActiveReportJob(auth.user.id, mode),
    ]);
    return NextResponse.json({ success: true, jobs, active }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("API /api/report-jobs list failed:", error);
    return NextResponse.json({ success: false, error: "Gagal membaca daftar job." }, { status: 500 });
  }
}
