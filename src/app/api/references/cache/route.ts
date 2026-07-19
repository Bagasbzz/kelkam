import { NextResponse } from "next/server";
import { clearReferenceCache, getCacheStats } from "@/lib/references/provider-client";

export async function GET() {
  try {
    const stats = getCacheStats();
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    console.error("API /api/references/cache GET Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Gagal membaca cache stats" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Clear cache
    clearReferenceCache();
    return NextResponse.json({ success: true, message: "Reference cache cleared" });
  } catch (error: any) {
    console.error("API /api/references/cache POST Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Gagal membersihkan cache" }, { status: 500 });
  }
}