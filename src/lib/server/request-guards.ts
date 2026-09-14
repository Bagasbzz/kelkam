/**
 * src/lib/server/request-guards.ts
 * -----------------------------------------------------------------------------
 * Helper bersama untuk API routes: error class, rate limiter, JSON parser.
 *
 * Dipakai oleh:
 *   - Semua route handler di src/app/api/**\/route.ts
 *   - Proxy.ts (untuk rate limit user yang sudah login)
 *
 * Komponen:
 *   - ApiRequestError: custom Error dengan `status` & `publicMessage` supaya
 *     bisa di-emit jadi JSON response yang rapi.
 *   - enforceRateLimit: in-memory rate limiter per key (key biasanya `${route}:${userId}`).
 *   - readJsonBody: parser JSON dengan size limit (anti payload besar).
 *   - publicErrorResponse: serializer error → JSON response (sanitize pesan).
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Custom Error Class
// ---------------------------------------------------------------------------

/**
 * Error class untuk API routes.
 * Bawa status HTTP + publicMessage (yang aman ditampilkan ke user).
 *
 * Contoh:
 *   throw new ApiRequestError(413, "File terlalu besar.");
 *
 * Lalu tangkap di route handler:
 *   } catch (error) {
 *     return publicErrorResponse(error, "Gagal memproses.");
 *   }
 *
 * `publicMessage` WAJIB aman untuk ditampilkan ke user — JANGAN masukin info
 * sensitif di sini (path DB, query, dll).
 */
export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "ApiRequestError";
  }
}

// ---------------------------------------------------------------------------
// Rate Limiter (in-memory)
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  /** Unix ms kapan reset (windowMs setelah request pertama). */
  resetAt: number;
}

/**
 * Singleton Map yang di-attach ke globalThis supaya konsisten di seluruh
 * hot-reload (dev) dan antar worker (prod). Map ini di-reset saat server restart.
 */
const globalForRateLimits = globalThis as typeof globalThis & {
  __keluhKampusRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalForRateLimits.__keluhKampusRateLimits || new Map<string, RateLimitEntry>();
globalForRateLimits.__keluhKampusRateLimits = rateLimits;

/** Hard cap supaya map tidak membengkak kalau ada bot yang flood dengan key unik. */
const MAX_RATE_LIMIT_KEYS = 5_000;

/**
 * Hapus entry yang sudah expired, lalu trim kalau masih overflow.
 * Dipanggil tiap enforceRateLimit() — biaya O(N) tapi N kecil.
 */
function pruneRateLimits(now: number) {
  for (const [key, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(key);
  }

  if (rateLimits.size <= MAX_RATE_LIMIT_KEYS) return;
  const overflow = rateLimits.size - MAX_RATE_LIMIT_KEYS;
  for (const key of Array.from(rateLimits.keys()).slice(0, overflow)) {
    rateLimits.delete(key);
  }
}

/**
 * Rate limiter sederhana (sliding window approximation).
 *
 * Pakai:
 *   const limit = enforceRateLimit(`context-extract:${userId}`, { limit: 8, windowMs: 10*60*1000 });
 *   if (limit) return limit; // return NextResponse 429
 *
 * @param key - identifier unik (biasanya `${route}:${userId}` atau `${route}:${ip}`)
 * @param options.limit - max request dalam window
 * @param options.windowMs - window dalam ms
 * @returns NextResponse 429 kalau over limit, null kalau masih boleh
 *
 * Caveat:
 *   - In-memory, jadi kalau deploy multi-instance (bukan JKC) tiap instance
 *     punya counter sendiri. Untuk JKC single-instance cukup.
 *   - Untuk prod yang perlu akurat, pakai Redis-based limiter (TODO).
 */
export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): NextResponse | null {
  const now = Date.now();
  pruneRateLimits(now);

  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (current.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  current.count += 1;
  return null;
}

// ---------------------------------------------------------------------------
// JSON Body Parser (size-limited)
// ---------------------------------------------------------------------------

/**
 * Parse body JSON dari request, dengan 2 lapis size limit (anti DoS).
 *
 * 1. Cek Content-Length header (kalau ada) → reject kalau > maxBytes.
 * 2. Baca semua text → encode ke bytes → cek lagi (anti client yang kirim
 *    Content-Length bohong).
 *
 * @throws ApiRequestError(413) kalau payload terlalu besar
 * @throws ApiRequestError(400) kalau JSON tidak valid
 */
export async function readJsonBody<T>(req: Request, maxBytes: number): Promise<T> {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiRequestError(413, "Payload terlalu besar.");
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new ApiRequestError(413, "Payload terlalu besar.");
  }

  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    throw new ApiRequestError(400, "Payload JSON tidak valid.");
  }
}

// ---------------------------------------------------------------------------
// Error → JSON response
// ---------------------------------------------------------------------------

/**
 * Serialize error menjadi NextResponse JSON.
 * - Kalau error adalah ApiRequestError → pakai status & publicMessage dari sana.
 * - Else → fallback message (supaya tidak bocorin internal error ke user).
 *
 * Pakai di catch block:
 *   } catch (error) {
 *     console.error("API /api/foo failed:", error);  // log internal detail
 *     return publicErrorResponse(error, "Gagal memproses.");  // user-friendly
 *   }
 */
export function publicErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      { success: false, error: error.publicMessage },
      { status: error.status },
    );
  }

  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}