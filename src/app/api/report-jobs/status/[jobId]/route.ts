/**
 * GET /api/report-jobs/status/[jobId]
 * -----------------------------------------------------------------------------
 * Polling endpoint SEKALIGUS step runner untuk report job.
 *
 * Setiap request mengerjakan maksimal 1 BAB yang masih queued (lihat
 * advanceReportJob), lalu mengembalikan state terbaru. Client cukup poll
 * berulang sampai status "done"/"failed". Request yang datang saat step
 * lain sedang jalan hanya return state (tidak double-run).
 *
 * Response berisi:
 *   - status: "queued" | "running" | "done" | "failed"
 *   - progress: 0-100 (proporsional BAB selesai)
 *   - stage: label human-readable (mis. "Menulis BAB II (2/6)")
 *   - steps: [{ index, title, status }]
 *   - result: string draft (kalau status "done")
 *   - error: string error (kalau status "failed")
 *
 * Rate limit 600 per 10 menit — polling tiap ~1-2s wajar.
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
import { advanceReportJob } from "@/lib/report/report-jobs";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

/**
 * Satu request mengerjakan maks 1 BAB (1-2 panggilan AI, timeout 40s masing-
 * masing). 120 detik = safety net.
 */
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`report-status:${auth.user.id}`, {
    limit: 600,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  const { jobId } = await params;
  if (!/^report_[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ success: false, error: "ID job tidak valid." }, { status: 400 });
  }

  // advanceReportJob: kerjakan 1 step kalau ada yang queued/stale, lalu return state.
  let job;
  try {
    job = await advanceReportJob(jobId, auth.user.id);
  } catch (error) {
    console.error("API /api/report-jobs/status failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memproses job laporan." }, { status: 500 });
  }

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