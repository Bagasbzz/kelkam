/**
 * POST|GET /api/report-jobs/tick
 * -----------------------------------------------------------------------------
 * Pemicu eksternal (cron cPanel / uptime monitor) supaya report job tetap
 * berjalan walau tab user ditutup. Setiap panggilan mengerjakan maks 1 BAB
 * untuk maks `REPORT_TICK_JOBS` job yang sedang tidak di-poll.
 *
 * Auth: header `x-cron-secret` atau query `?secret=` harus sama dengan env
 * `REPORT_CRON_SECRET`. Kalau env kosong → endpoint nonaktif (404).
 *
 * Contoh cron tiap menit:
 *   curl -s -X POST -H "x-cron-secret: $SECRET" https://host/api/report-jobs/tick
 * -----------------------------------------------------------------------------
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { tickReportJobs } from "@/lib/report/report-jobs";

export const maxDuration = 120;

function secretMatches(provided: string | null, expected: string) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  const expected = process.env.REPORT_CRON_SECRET || "";
  if (expected.length < 16) return NextResponse.json({ success: false }, { status: 404 });

  const url = new URL(req.url);
  const provided = req.headers.get("x-cron-secret") || url.searchParams.get("secret");
  if (!secretMatches(provided, expected)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(4, Math.max(1, Number(process.env.REPORT_TICK_JOBS || 2)));
  try {
    const result = await tickReportJobs(limit);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("API /api/report-jobs/tick failed:", error);
    return NextResponse.json({ success: false, error: "Tick gagal." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
