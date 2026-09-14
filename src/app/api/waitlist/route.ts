/**
 * /api/waitlist
 * -----------------------------------------------------------------------------
 * Waitlist publik untuk landing page.
 *
 * Endpoint ini PUBLIK (tidak butuh login), jadi rate limit pakai IP client
 * bukan user id. Limit ketat (5 per hari per IP) supaya tidak bisa di-spam.
 *
 * POST — daftar email baru:
 *   Body: { email: string }
 *   - 200 { success: true, alreadyJoined: boolean }
 *   - 400 { success: false, error } — email format invalid
 *   - 429 — rate limit
 *
 * GET — list semua (ADMIN ONLY, dipakai untuk dashboard internal):
 *   - 401 — belum login
 *   - 200 { success: true, data: Waitlist[] }
 *
 * Skema tabel `waitlist` (lihat prisma/schema.prisma):
 *   - id (bigserial)
 *   - email (unique)
 *   - createdAt
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { getCurrentUser } from "@/lib/server/auth";

/** Identitas pembeda untuk rate limiter publik. Pakai IP, bukan user. */
function clientKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

/** Regex email sederhana — cukup untuk waitlist, bukan validasi strict RFC. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  // Rate limit ketat: 5 per hari per IP (lihat DEPLOYMENT.md).
  const rateLimit = enforceRateLimit(`waitlist:${clientKey(req)}`, {
    limit: 5,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await readJsonBody<{ email?: unknown }>(req, 4_096);
    const email = String(body.email || "").trim().toLowerCase();
    if (email.length > 254 || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ success: false, error: "Email tidak valid." }, { status: 400 });
    }

    try {
      await prisma.waitlist.create({ data: { email } });
      return NextResponse.json(
        { success: true, alreadyJoined: false },
        { headers: { "Cache-Control": "no-store" } }
      );
    } catch (error) {
      // P2002 = unique constraint violation. Artinya email sudah pernah daftar.
      // Return 200 + flag alreadyJoined supaya UI tidak crash.
      const message = error instanceof Error ? error.message : "";
      const code = (error as { code?: string }).code;
      if (code === "P2002" || /unique/i.test(message)) {
        return NextResponse.json(
          { success: true, alreadyJoined: true },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("API /api/waitlist failed:", error);
    return publicErrorResponse(error, "Pendaftaran waitlist gagal.");
  }
}

/**
 * Admin-only: list semua entry waitlist (untuk monitoring).
 * Wajib login (siapa pun yang login bisa akses — TODO: tambah role-based).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const items = await prisma.waitlist.findMany({
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ success: true, data: items }, { headers: { "Cache-Control": "private, no-store" } });
}