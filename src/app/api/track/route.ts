/**
 * POST /api/track  { path }
 * -----------------------------------------------------------------------------
 * Catat satu kunjungan halaman (Tahap 3 analitik). Tamu ikut tercatat lewat ID acak
 * per browser (cookie kk_vid, httpOnly), bukan IP. Tidak pernah mengembalikan error ke klien.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/server/auth";
import { normalizePath, recordPageView } from "@/lib/server/analytics";
import { enforceRateLimit } from "@/lib/server/request-guards";
import { assertSameOriginJsonRequest } from "@/lib/server/csrf-origin";

export const dynamic = "force-dynamic";
const VISITOR_COOKIE = "kk_vid";

export async function POST(req: Request) {
  const response = new NextResponse(null, { status: 204 });
  try {
    assertSameOriginJsonRequest(req);
    const store = await cookies();
    let visitorId = store.get(VISITOR_COOKIE)?.value || "";
    if (!/^[a-f0-9]{32}$/.test(visitorId)) {
      visitorId = crypto.randomUUID().replace(/-/g, "");
      response.cookies.set(VISITOR_COOKIE, visitorId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 365, path: "/" });
    }
    if (enforceRateLimit(`track:${visitorId}`, { limit: 120, windowMs: 60_000 })) return response;
    const body = (await req.json().catch(() => null)) as { path?: unknown } | null;
    const path = normalizePath(body?.path);
    if (!path || path.startsWith("/api")) return response;
    const user = await getCurrentUser().catch(() => null);
    await recordPageView({ visitorId, userId: user?.id ?? null, path });
  } catch { /* pencatatan tidak boleh mengganggu pengguna */ }
  return response;
}
