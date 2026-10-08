/**
 * POST /api/report-jobs/status/[jobId]/action
 * Body: { action: "cancel" | "retry", redoFallback?: boolean }
 *   - cancel → job jadi "cancelled"
 *   - retry  → step failed (dan fallback bila redoFallback) di-queue ulang,
 *              output BAB yang sudah jadi dipertahankan; job lanjut dari sana.
 */

import { NextResponse } from "next/server";
import { cancelReportJob, retryReportJob } from "@/lib/report/report-jobs";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

export async function POST(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`report-action:${auth.user.id}`, { limit: 60, windowMs: 10 * 60 * 1000 });
  if (rateLimit) return rateLimit;

  const { jobId } = await params;
  if (!/^report_[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ success: false, error: "ID job tidak valid." }, { status: 400 });
  }

  try {
    const body = await readJsonBody<{ action?: string; redoFallback?: boolean }>(req, 4_096);
    const action = body?.action;
    if (action !== "cancel" && action !== "retry") {
      return NextResponse.json({ success: false, error: "Aksi tidak dikenal." }, { status: 400 });
    }

    const job = action === "cancel"
      ? await cancelReportJob(jobId, auth.user.id)
      : await retryReportJob(jobId, auth.user.id, { redoFallback: Boolean(body?.redoFallback) });

    if (!job) return NextResponse.json({ success: false, error: "Job tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ success: true, job }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("API /api/report-jobs action failed:", error);
    return publicErrorResponse(error, "Gagal memproses aksi job.");
  }
}
