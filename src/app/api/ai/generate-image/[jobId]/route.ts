/**
 * GET /api/ai/generate-image/[jobId] → status job gambar milik user.
 * Kalau job masih queued dan tidak ada worker yang memegangnya (mis. proses
 * restart), panggilan ini juga memicu eksekusi ulang di background.
 */
import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { getImageJob, kickImageJobs } from "@/lib/server/image-jobs";

export const runtime = "nodejs";

export async function GET(_req: Request, context: { params: Promise<{ jobId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const { jobId } = await context.params;
  const job = await getImageJob(jobId, auth.user.id);
  if (!job) return NextResponse.json({ success: false, error: "Job tidak ditemukan." }, { status: 404 });

  if (job.status === "queued" || job.status === "running") kickImageJobs();
  return NextResponse.json({ success: true, job }, { headers: { "Cache-Control": "no-store" } });
}
