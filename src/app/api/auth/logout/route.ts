/**
 * POST /api/auth/logout
 * -----------------------------------------------------------------------------
 * Menghapus session user saat ini.
 *
 * - Hapus row di tabel `sessions` (DB) — supaya token tidak bisa dipakai ulang.
 * - Hapus cookie `keluhkampus_session` di browser.
 *
 * Endpoint ini idempotent: kalau tidak ada session, tetap return 200.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { destroySession } from "@/lib/server/auth";
import { publicErrorResponse } from "@/lib/server/request-guards";

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json(
      { success: true },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("API /api/auth/logout failed:", error);
    return publicErrorResponse(error, "Gagal keluar.");
  }
}