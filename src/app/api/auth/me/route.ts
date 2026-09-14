/**
 * GET /api/auth/me
 * -----------------------------------------------------------------------------
 * Mengembalikan user yang sedang login (atau null kalau belum).
 *
 * Dipakai oleh:
 *   - AuthProvider React Context (`src/components/AuthProvider.tsx`) saat mount
 *     untuk tau apakah user sudah login.
 *   - Middleware/proxy tidak — proxy cukup decode JWT cookie.
 *
 * Response shape:
 *   - 200 { success: true, user: null | { id, email, name } }
 *
 * Cache-Control: private, no-store supaya browser/proxy TIDAK menyimpan
 * informasi user.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/server/auth";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json(
    { success: true, user },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}