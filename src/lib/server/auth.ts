/**
 * src/lib/server/auth.ts
 * -----------------------------------------------------------------------------
 * Library autentikasi inti untuk keluhkampus.
 *
 * Tanggung jawab:
 *   - Hash & verify password dengan argon2id.
 *   - Buat & verifikasi JWT session (HS256, 30 hari).
 *   - Simpan session di tabel `sessions` (DB) supaya bisa di-revoke.
 *   - Set / hapus cookie httpOnly `keluhkampus_session`.
 *   - Ambil user dari cookie (untuk API routes & Server Components).
 *
 * BAGAIMANA CARA PAKAI:
 *
 *   // Di Server Component atau API route:
 *   import { getCurrentUser, requireUser } from "@/lib/server/auth";
 *
 *   const user = await getCurrentUser();
 *   if (!user) redirect("/login");
 *
 *   // Atau kalau mau short-circuit return:
 *   const auth = await authenticateRequestFromCookie();
 *   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
 *   const user = auth.user;
 *
 *   // Di Server Action / API route yang butuh createSession:
 *   import { createSession } from "@/lib/server/auth";
 *   await createSession(userId, email, name);
 *
 * KONSEP PENTING:
 *   - JWT disimpan di cookie httpOnly + Secure + SameSite=Lax.
 *   - Token JWT diserialisasi di tabel `sessions.id` (lihat schema.prisma)
 *     supaya bisa di-invalidate kalau logout / di-ban.
 *   - Kalau session row dihapus, token JWT tidak valid lagi meskipun JWT
 *     sendiri masih dalam masa aktif (cek ada di getCurrentUser()).
 *
 * ENVIRONMENT VARIABLES:
 *   - AUTH_JWT_SECRET  : rahasia HS256 (wajib, generated via `openssl rand -base64 32`)
 *   - AUTH_COOKIE_NAME: nama cookie (default: keluhkampus_session)
 *   - AUTH_COOKIE_SECURE: "true" untuk prod (default: true, set "false" di local dev HTTP)
 * -----------------------------------------------------------------------------
 */

import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import argon2 from "argon2";
import { prisma } from "@/lib/db/prisma";
import { ApiRequestError } from "@/lib/server/request-guards";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Secret untuk signing JWT (HS256).
 * Fallback "keluhkampus-dev-secret-change-me-in-production" cuma untuk local
 * dev kalau lupa set env var. Di production, process.env.AUTH_JWT_SECRET WAJIB
 * di-set (akan di-cek oleh middleware setup di cPanel).
 */
const JWT_SECRET = new TextEncoder().encode(
  process.env.AUTH_JWT_SECRET || "keluhkampus-dev-secret-change-me-in-production"
);

/** Nama cookie session. Bisa di-override via env (berguna untuk multi-app). */
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "keluhkampus_session";

/**
 * Cookie Secure flag.
 * Default true. Set "false" kalau deploy di HTTP (mis. local dev tanpa TLS).
 * JKC pakai HTTPS, jadi biarkan true.
 */
const COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE !== "false";

/** TTL token: 30 hari. Bisa dikurangi kalau perlu (lihat createSession). */
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape user yang dikembalikan ke client (JANGAN expose passwordHash!). */
export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  /** Role global: USER (mahasiswa) atau ADMIN (asdos). */
  role: "USER" | "ADMIN";
}

/** Result pattern untuk guard helper (lihat authenticateRequestFromCookie). */
export type AuthGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Password hashing (argon2id)
// ---------------------------------------------------------------------------

/**
 * Hash password plain-text dengan argon2id.
 * Gunakan waktu user register / ganti password.
 *
 * @param plain - password dari form input
 * @returns hash siap simpan di kolom password_hash
 */
export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Verify password plain-text vs hash argon2id di DB.
 * Return false kalau hash tidak valid / corrupt (jangan throw).
 *
 * @param hash - nilai kolom password_hash
 * @param plain - password dari form input
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // hash corrupt / format salah → anggap gagal, jangan expose error detail
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT session
// ---------------------------------------------------------------------------

/**
 * Buat JWT baru (HS256, signed dengan JWT_SECRET).
 * Payload: { sub: userId, email, role }.
 *
 * Token ini akan disimpan di tabel `sessions.id` supaya bisa di-revoke.
 */
export async function createSessionToken(
  userId: string,
  email: string,
  role: "USER" | "ADMIN"
): Promise<string> {
  return new SignJWT({ sub: userId, email, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(JWT_SECRET);
}

/**
 * Set cookie httpOnly di response. Dipakai oleh createSession().
 * Cookie name & flags dari config di atas.
 */
async function setSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

/**
 * Buat session untuk user — bikin JWT, catat di DB, set cookie.
 *
 * @param userId - id user yang baru login
 * @param email - email (untuk payload JWT, agar logout bisa jalan tanpa DB lookup)
 * @param name - display name (null OK)
 * @param role - 'USER' | 'ADMIN' (ikut di JWT payload supaya getCurrentUser
 *               tidak perlu hit DB untuk cek role)
 * @returns user info yang siap dikembalikan ke client
 */
export async function createSession(
  userId: string,
  email: string,
  name: string | null,
  role: "USER" | "ADMIN"
) {
  const token = await createSessionToken(userId, email, role);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

  // Catat token di DB. Kalau user logout atau di-ban, row ini dihapus →
  // getCurrentUser() akan return null meskipun JWT masih valid.
  await prisma.session.create({
    data: { id: token, userId, expiresAt },
  });

  await setSessionCookie(token);
  return { user: { id: userId, email, name, role } };
}

// ---------------------------------------------------------------------------
// Session lookup
// ---------------------------------------------------------------------------

/**
 * Ambil user dari cookie session kalau valid.
 *
 * Validasi berlapis:
 *   1. Cookie ada? kalau tidak → null
 *   2. JWT signature & expiry valid? kalau tidak → null
 *   3. Row ada di tabel `sessions`? kalau tidak → null (token revoked)
 *   4. expires_at di DB belum lewat? kalau lewat → null (kemungkinan besar
 *      server restart dengan TTL berbeda)
 *   5. User masih ada di tabel `users`? kalau tidak → null
 *
 * @returns SessionUser atau null
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const userId = String(payload.sub || "");
    if (!userId) return null;

    // Token harus masih ada di DB (anti-revoke).
    const session = await prisma.session.findUnique({ where: { id: token } });
    if (!session || session.expiresAt < new Date()) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
    return user || null;
  } catch {
    // JWT corrupt / signature invalid / expired → anggap tidak login.
    return null;
  }
}

/**
 * Hard-require user. Kalau tidak ada, return null (caller decides redirect / 401).
 * Prefer `authenticateRequestFromCookie()` di API route supaya return
 * NextResponse langsung.
 */
export async function requireUser(): Promise<SessionUser | null> {
  return getCurrentUser();
}

/**
 * Helper untuk API routes: kalau user tidak ada, return shape error siap-pakai
 * untuk di-return dari route handler.
 *
 * Contoh:
 *   const auth = await authenticateRequestFromCookie();
 *   if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
 *   const { user } = auth;
 */
export async function authenticateRequestFromCookie(): Promise<AuthGuardResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, status: 401, error: "Silakan masuk terlebih dahulu untuk melanjutkan." };
  }
  return { ok: true, user };
}

/**
 * Hapus session saat ini: hapus row DB + clear cookie.
 * Idempotent — kalau tidak ada session, tetap return tanpa error.
 */
export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) {
    // `.catch()` supaya kalau row sudah dihapus (mis. cron sweep), tidak error.
    await prisma.session.delete({ where: { id: token } }).catch(() => undefined);
  }
  cookieStore.delete(COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// Role / permission helpers (untuk fitur Tugas)
// ---------------------------------------------------------------------------

/**
 * Hard-require role=ADMIN. Throw ApiRequestError(403) kalau tidak.
 * Pakai di API route yang butuh privilege global (mis. bikin course baru).
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiRequestError(401, "Silakan masuk terlebih dahulu untuk melanjutkan.");
  }
  if (user.role !== "ADMIN") {
    throw new ApiRequestError(403, "Hanya admin yang boleh melakukan aksi ini.");
  }
  return user;
}

/**
 * Cek apakah user adalah admin dari course tertentu.
 * Return true kalau:
 *   - user.role === 'ADMIN' (admin global) ATAU
 *   - ada row di tabel CourseAdmin untuk (courseId, userId).
 *
 * @param userId - id user yang mau dicek
 * @param courseId - id course yang mau dicek aksesnya
 */
export async function isCourseAdmin(userId: string, courseId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user) return false;
  if (user.role === "ADMIN") return true;

  const adminRow = await prisma.courseAdmin.findUnique({
    where: { courseId_userId: { courseId, userId } },
    select: { id: true },
  });
  return Boolean(adminRow);
}

/**
 * Hard-require course admin. Throw ApiRequestError(401|403) kalau tidak.
 * Pakai di API route yang butuh akses per-course (mis. CRUD tugas).
 */
export async function requireCourseAdmin(courseId: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiRequestError(401, "Silakan masuk terlebih dahulu untuk melanjutkan.");
  }
  const allowed = await isCourseAdmin(user.id, courseId);
  if (!allowed) {
    throw new ApiRequestError(403, "Kamu bukan admin untuk course ini.");
  }
  return user;
}

/**
 * Hard-require course creator (bukan co-admin). Buat aksi sensitif
 * seperti menambah admin lain (anti privilege escalation berlapis).
 */
export async function requireCourseCreator(courseId: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new ApiRequestError(401, "Silakan masuk terlebih dahulu untuk melanjutkan.");
  }
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { createdById: true },
  });
  if (!course) {
    throw new ApiRequestError(404, "Course tidak ditemukan.");
  }
  if (course.createdById !== user.id && user.role !== "ADMIN") {
    throw new ApiRequestError(403, "Hanya pembuat course yang boleh melakukan aksi ini.");
  }
  return user;
}

// ---------------------------------------------------------------------------
// Exports for proxy.ts (jangan rename tanpa update src/proxy.ts)
// ---------------------------------------------------------------------------

/** Export nama cookie supaya proxy.ts (yang jalan di Edge runtime) bisa baca
 * cookie yang sama tanpa duplikasi string. */
export const SESSION_COOKIE_NAME = COOKIE_NAME;