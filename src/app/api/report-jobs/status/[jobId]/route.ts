import { NextResponse } from "next/server";
import { ensureReportJobRunning } from "@/lib/report/report-jobs";
import { authenticateRequest } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;
  const { token, user } = authentication.auth;

  const rateLimit = enforceRateLimit(`report-status:${user.id}`, {
    limit: 180,
    windowMs: 5 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  const { jobId } = await params;
  if (!/^report_[0-9a-f-]{36}$/i.test(jobId)) {
    return NextResponse.json({ success: false, error: "ID job tidak valid." }, { status: 400 });
  }

  const job = await ensureReportJobRunning(jobId, user.id, token);

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
