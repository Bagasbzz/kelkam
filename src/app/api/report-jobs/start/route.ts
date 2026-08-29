import { NextResponse } from "next/server";
import { startReportJob } from "@/lib/report/report-jobs";
import { authenticateRequest } from "@/lib/server/auth";
import {
  enforceRateLimit,
  publicErrorResponse,
  readJsonBody,
} from "@/lib/server/request-guards";

export const maxDuration = 60;

function validateProject(project: unknown) {
  if (!project || typeof project !== "object" || Array.isArray(project)) return "Data proyek tidak valid.";
  const candidate = project as Record<string, unknown>;
  if (!candidate.title && !candidate.topic) return "Judul atau topik belum diisi.";
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) return "Sumber/konteks proyek belum diisi.";
  if (!Array.isArray(candidate.outline) || candidate.outline.length === 0) return "Outline belum dibuat. Jalankan brainstorm rencana dulu.";
  if (candidate.sources.length > 50 || candidate.outline.length > 50) return "Isi proyek melewati batas pemrosesan.";
  return "";
}

export async function POST(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;
  const { token, user } = authentication.auth;

  const rateLimit = enforceRateLimit(`report-start:${user.id}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const { project } = await readJsonBody<{ project?: unknown }>(req, 1_500_000);
    const validationError = validateProject(project);
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 });

    const job = await startReportJob(project, user.id, token);
    return NextResponse.json(
      { success: true, job },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("API /api/report-jobs/start failed:", error);
    return publicErrorResponse(error, "Gagal memulai job laporan.");
  }
}
