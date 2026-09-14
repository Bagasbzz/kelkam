/**
 * POST /api/auth/login
 * -----------------------------------------------------------------------------
 * Autentikasi user dengan email + password.
 *
 * Flow:
 *   1. Rate limit per IP (anti-brute-force, limit lebih longgar dari register
 *      karena user legitimate kadang salah ketik password).
 *   2. Validasi payload (zod).
 *   3. Cari user by email.
 *   4. Verify password hash dengan argon2.verify().
 *   5. Buat session JWT + cookie.
 *
 * Response shape:
 *   - 200 { success: true, user }
 *   - 400 { success: false, error } — payload invalid
 *   - 401 { success: false, error } — email/password salah (sengaja generik
 *     supaya tidak bocorin "email ada tapi password salah")
 *   - 429 — rate limit
 *   - 500 — server error
 *
 * Keamanan:
 *   - Pesan error 401 TIDAK membedakan antara "email tidak ditemukan" vs
 *     "password salah" — anti-enumeration.
 *   - Argon2.verify() constant-time comparison.
 *   - Log percobaan login ada di Prisma session row (lihat auth.ts createSession).
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { createSession, verifyPassword } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";

/** Schema input — email otomatis di-lowercase + trim. */
const loginSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1).max(200),
});

function clientKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function POST(req: Request) {
  const rateLimit = enforceRateLimit(`auth-login:${clientKey(req)}`, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Email atau password tidak valid." },
        { status: 400 }
      );
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Pesan identik dengan password-salah case di bawah supaya tidak bocor.
      return NextResponse.json(
        { success: false, error: "Email atau password salah." },
        { status: 401 }
      );
    }

    // argon2.verify() aman dari timing attack.
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: "Email atau password salah." },
        { status: 401 }
      );
    }

    const session = await createSession(user.id, user.email, user.name);
    return NextResponse.json(
      { success: true, user: session.user },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("API /api/auth/login failed:", error);
    return publicErrorResponse(error, "Masuk gagal. Coba lagi sebentar.");
  }
}