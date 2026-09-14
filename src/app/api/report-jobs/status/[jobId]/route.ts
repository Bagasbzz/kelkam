/**
 * GET /api/report-jobs/status/[jobId]
 * -----------------------------------------------------------------------------
 * Polling endpoint untuk status report job yang sedang berjalan.
 *
 * Client (Dashboard) poll endpoint ini tiap 1-2 detik setelah start.
 * Response berisi:
 *   - status: "queued" | "running" | "done" | "failed"
 *   - progress: 0-100
 *   - stage: label human-readable (mis. "Menulis draft laporan")
 *   - result: string draft (kalau status "done")
 *   - error: string error (kalau status "failed")
 *
 * Rate limit longgar (180 per 5 menit) — polling yang sering itu normal.
 *
 * Validasi jobId: pattern `report_<uuid>`.
 *
 * Response shape:
 *   - 200 { success: true, job: ReportJob }
 *   - 400 — jobId format invalid
 *   - 401 — belum login
 *   - 404 — job tidak ditemukan atau sudah expire (>6 jam)
 *   - 429 — rate limit
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { ensureReportJobRunning } from "@/lib/report/report-jobs";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

/** Timeout 60 detik — safety net. */
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`report-status:${auth.user.id}`, {
    limit: 180,
    windowMs: 5 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  const { jobId } = await params;
  if (!/^report_[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ success: false, error: "ID job tidak valid." }, { status: 400 });
  }

  // ensureReportJobRunning: cek DB + (kalau queued tapi stale) resume runner.
  const job = await ensureReportJobRunning(jobId, auth.user.id);

  if (!job) {
    return NextResponse.json(
      { success: false, error: "Job laporan tidak ditemukan atau sudah kedaluwarsa." },
      { status: 404 }
    );
  }

  return NextResponse.json(
    { success: true, job },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}