/**
 * POST /api/report-jobs/start
 * -----------------------------------------------------------------------------
 * Memulai job generate draft laporan (per-BAB, persistent).
 *
 * Job engine di `src/lib/report/report-jobs.ts`:
 *   - create row `report_jobs` + 1 row `report_job_steps` per section outline
 *   - TIDAK memanggil AI di sini. Setiap GET /api/report-jobs/status/[jobId]
 *     mengerjakan 1 step (1 BAB) lalu return → client polling memicu step
 *     berikutnya. Aman untuk single-process hosting & tahan restart.
 *
 * Body: { project, mode?: "ringkas" | "lengkap" }
 *   - ringkas → model cepat, BAB lebih padat (Laporan cepat)
 *   - lengkap → model utama, BAB mendalam (Studio)
 *
 * Validasi project:
 *   - title atau topic harus diisi
 *   - sources min 1
 *   - outline min 1
 *   - max 50 sources, max 50 outline items (anti payload gila)
 *
 * Rate limit: 5 job per 10 menit per user (AI mahal + lama).
 *
 * Response shape:
 *   - 200 { success: true, job: ReportJob }
 *   - 400 — payload invalid
 *   - 401 — belum login
 *   - 429 — rate limit
 *   - 500 — server error
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { startReportJob } from "@/lib/report/report-jobs";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import {
  enforceRateLimit,
  publicErrorResponse,
  readJsonBody,
} from "@/lib/server/request-guards";

/** Timeout 60 detik — job sendiri jalan di background, ini cuma kickoff. */
export const maxDuration = 60;

/**
 * Validasi payload project.
 * Return string error kalau invalid, atau "" kalau OK.
 */
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
  // -------------------------------------------------------------------------
  // Auth + rate limit
  // -------------------------------------------------------------------------
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const rateLimit = enforceRateLimit(`report-start:${auth.user.id}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    // 1.5MB max — handle project dengan banyak source + outline + diagram.
    const { project, mode } = await readJsonBody<{ project?: unknown; mode?: unknown }>(req, 1_500_000);
    const validationError = validateProject(project);
    if (validationError) return NextResponse.json({ success: false, error: validationError }, { status: 400 });

    // Buat job + steps (tanpa AI). Step pertama dijalankan oleh polling /status.
    const job = await startReportJob(project, auth.user.id, mode === "ringkas" ? "ringkas" : "lengkap");
    return NextResponse.json(
      { success: true, job },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("API /api/report-jobs/start failed:", error);
    return publicErrorResponse(error, "Gagal memulai job laporan.");
  }
}