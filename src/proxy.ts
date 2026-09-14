/**
 * src/proxy.ts
 * -----------------------------------------------------------------------------
 * Edge-runtime middleware (Next.js "proxy", formerly "middleware").
 * Jalan di tiap request yang match `config.matcher` di bawah.
 *
 * Tanggung jawab:
 *   1. Decode JWT cookie `keluhkampus_session` untuk request ke path terproteksi.
 *   2. Kalau tidak ada / invalid → 401 (API) atau redirect ke /login (page).
 *   3. Rate limit user yang sudah login per endpoint.
 *   4. Forward user.id ke downstream via header `x-keluh-user-id`.
 *
 * PATH YANG DI-PROTECT:
 *   - API:
 *       /api/report-jobs/*
 *       /api/context/extract
 *       /api/references/*
 *       /api/research/*
 *       /api/studio/*
 *       /api/files/*
 *       /api/auth/me
 *   - Page (wajib login):
 *       /studio/*
 *       /dashboard/*
 *       /research/*
 *
 * PATH YANG DI-SKIP:
 *   - /api/waitlist (publik, rate-limit sendiri per-IP)
 *   - Lainnya: dibiarkan lewat (artinya bisa diakses tanpa login).
 *
 * CATATAN KOMPABILITITAS:
 *   - Proxy.js jalan di Edge runtime, jadi TIDAK bisa pakai Node.js modules
 *     (fs, crypto native, dll). Pakai `jose` untuk JWT (web-crypto friendly).
 *   - DB lookup TIDAK dilakukan di sini — terlalu mahal untuk setiap request.
 *     Validasi DB (session row exist) dilakukan di `getCurrentUser()` saat
 *     API route handler jalan. Proxy cukup decode JWT signature.
 * -----------------------------------------------------------------------------
 */

import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE_NAME } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Path API yang WAJIB terautentikasi.
 * Setiap prefix dicocokkan dengan `pathname.startsWith(prefix)`.
 */
const PROTECTED_API_PREFIXES = [
  "/api/report-jobs/",
  "/api/context/extract",
  "/api/references/",
  "/api/research/",
  "/api/studio/",
  "/api/files/",
  "/api/auth/me",
];

/**
 * Path page (UI) yang WAJIB login.
 * User yang belum login akan di-redirect ke /login?redirect=<path>.
 */
const PROTECTED_PAGE_PREFIXES = [
  "/studio",
  "/dashboard",
  "/research/new",
];

/**
 * Secret HARUS sama dengan yang di src/lib/server/auth.ts.
 * Duplikasi ini disengaja — proxy.js jalan di Edge runtime yang tidak bisa
 * import dari kode yg pakai Prisma/argon2 (Node-only modules).
 */
const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_JWT_SECRET || "keluhkampus-dev-secret-change-me-in-production"
);

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip publik endpoint (waitlist rate-limit dirinya sendiri per-IP).
  if (pathname === "/api/waitlist") return NextResponse.next();

  const isProtectedApi = PROTECTED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Bukan path terproteksi → biarkan lewat.
  if (!isProtectedApi && !isProtectedPage) return NextResponse.next();

  // -------------------------------------------------------------------------
  // Auth check
  // -------------------------------------------------------------------------
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    if (isProtectedApi) {
      return NextResponse.json(
        { success: false, error: "Silakan masuk terlebih dahulu untuk melanjutkan." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // -------------------------------------------------------------------------
  // JWT verify (signature + expiry)
  // -------------------------------------------------------------------------
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = String(payload.sub || "");
    if (!userId) throw new Error("missing sub");

    // Rate limit HANYA untuk API (page navigation tidak di-rate-limit di sini;
    // Next.js sudah handle browser-side caching).
    if (isProtectedApi) {
      // Endpoint "expensive" (AI, fix-format) dapat limit lebih ketat.
      const expensive = pathname.startsWith("/api/ai/") || pathname.startsWith("/api/fix-format");
      const rateLimit = enforceRateLimit(`api-gateway:${userId}:${pathname}`, {
        limit: expensive ? 20 : 40,
        windowMs: 10 * 60 * 1000,
      });
      if (rateLimit) return rateLimit;
    }

    // Forward userId ke downstream handler via header.
    const headers = new Headers(request.headers);
    headers.set("x-keluh-user-id", userId);
    return NextResponse.next({ request: { headers } });
  } catch {
    // JWT invalid / expired / corrupt.
    if (isProtectedApi) {
      return NextResponse.json(
        { success: false, error: "Sesi sudah tidak valid. Silakan masuk kembali." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
}

// ---------------------------------------------------------------------------
// Matcher (paths yang proxy handle)
// ---------------------------------------------------------------------------

export const config = {
  matcher: ["/api/:path*", "/studio/:path*", "/dashboard/:path*", "/research/:path*"],
};