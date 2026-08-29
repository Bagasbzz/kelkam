import { NextResponse } from "next/server";
import { clearReferenceCache, getCacheStats } from "@/lib/references/provider-client";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan server";
}

export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("API /api/references/cache GET Error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const adminToken = process.env.REFERENCE_CACHE_ADMIN_TOKEN;
    const suppliedToken = req.headers.get("x-admin-token");

    if (!adminToken || suppliedToken !== adminToken) {
      return NextResponse.json(
        { success: false, error: "Cache referensi hanya bisa dibersihkan oleh admin server." },
        { status: 403 }
      );
    }

    clearReferenceCache();
    return NextResponse.json({ success: true, message: "Reference cache cleared" });
  } catch (error) {
    console.error("API /api/references/cache POST Error:", error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
