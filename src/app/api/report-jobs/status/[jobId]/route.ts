import { NextResponse } from "next/server";
import { ensureReportJobRunning } from "@/lib/report/report-jobs";

export const maxDuration = 60;

export async function GET(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = await ensureReportJobRunning(jobId);

  if (!job) {
    return NextResponse.json(
      { success: false, error: "Job laporan tidak ditemukan atau sudah kedaluwarsa." },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, job });
}
