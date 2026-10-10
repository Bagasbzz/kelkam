import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { clearReferenceCache, getCacheStats } from "@/lib/references/provider-client";
import { requireAdmin } from "@/lib/server/auth";
import { publicErrorResponse } from "@/lib/server/request-guards";

/** Bandingkan token tanpa membocorkan timing. */
function tokenMatches(supplied: string | null, expected: string): boolean {
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  try {
    await requireAdmin();
    const stats = getCacheStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("API /api/references/cache GET Error:", error);
    return publicErrorResponse(error, "Gagal membaca statistik cache.");
  }
}

export async function POST(req: Request) {
  try {
    const adminToken = process.env.REFERENCE_CACHE_ADMIN_TOKEN;
    const suppliedToken = req.headers.get("x-admin-token");

    if (!adminToken || !tokenMatches(suppliedToken, adminToken)) {
      return NextResponse.json(
        { success: false, error: "Cache referensi hanya bisa dibersihkan oleh admin server." },
        { status: 403 }
      );
    }

    clearReferenceCache();
    return NextResponse.json({ success: true, message: "Reference cache cleared" });
  } catch (error) {
    console.error("API /api/references/cache POST Error:", error);
    return publicErrorResponse(error, "Gagal membersihkan cache.");
  }
}
