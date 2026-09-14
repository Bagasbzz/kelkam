/**
 * POST /api/auth/register
 * -----------------------------------------------------------------------------
 * Mendaftarkan akun baru (email + password).
 *
 * Flow:
 *   1. Rate limit per IP (anti-spam, anti-credential-stuffing).
 *   2. Validasi payload dengan zod (email format, panjang password).
 *   3. Cek apakah email sudah terdaftar → 409 kalau iya.
 *   4. Hash password dengan argon2id (lihat src/lib/server/auth.ts).
 *   5. Insert user ke tabel `users`.
 *   6. Buat session JWT + simpan di cookie httpOnly.
 *
 * Response shape:
 *   - 200 { success: true, user: { id, email, name } }
 *   - 400 { success: false, error } — validasi gagal
 *   - 409 { success: false, error } — email sudah ada
 *   - 429 { success: false, error } — rate limit (otomatis dari enforceRateLimit)
 *   - 500 { success: false, error } — server error (DB down, dll)
 *
 * Catatan:
 *   - Password di-hash dengan argon2id, BUKAN bcrypt/MD5/SHA (lihat auth.ts).
 *   - Session disimpan di cookie `keluhkampus_session` (lihat SESSION_COOKIE_NAME).
 *   - Rate limit pakai clientKey() yang ambil dari x-forwarded-for / x-real-ip.
 *     Di balik reverse proxy JKC, x-forwarded-for sudah di-set oleh Apache.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { createSession, hashPassword } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse } from "@/lib/server/request-guards";

/** Schema input — semua field di-sanitize otomatis oleh zod (lowercase + trim email). */
const registerSchema = z.object({
  email: z.string().email().max(254).transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(100).optional(),
});

/** Identitas pembeda untuk rate limiter. Dipakai supaya user yang sama gabung IP share. */
function clientKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip") || "unknown").slice(0, 100);
}

export async function POST(req: Request) {
  // Rate limit: 5 percobaan per 10 menit per IP.
  const rateLimit = enforceRateLimit(`auth-register:${clientKey(req)}`, {
    limit: 5,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Email tidak valid atau password minimal 8 karakter." },
        { status: 400 }
      );
    }
    const { email, password, name } = parsed.data;

    // Kalau email sudah ada, kasih 409 (bukan 200 diam-diam) supaya UI bisa arahkan ke login.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { success: false, error: "Email sudah terdaftar. Silakan masuk." },
        { status: 409 }
      );
    }

    // argon2id dengan default cost — produksi-ready.
    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name: name || null },
      select: { id: true, email: true, name: true },
    });

    // createSession() bikin JWT 30 hari + catat di tabel sessions + set httpOnly cookie.
    const session = await createSession(user.id, user.email, user.name);
    return NextResponse.json(
      { success: true, user: session.user },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("API /api/auth/register failed:", error);
    return publicErrorResponse(error, "Pendaftaran gagal. Coba lagi sebentar.");
  }
}