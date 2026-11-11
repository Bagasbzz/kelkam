/**
 * /api/admin/maintenance, saklar mode maintenance (SUPER ADMIN saja).
 *   GET → status saat ini.
 *   PUT { enabled, message?, until? } → simpan; berlaku di semua halaman dalam ±10 detik.
 */
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/server/auth";
import { recordAdminAction } from "@/lib/server/analytics";
import { loadMaintenance, saveMaintenance } from "@/lib/server/maintenance";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

export const runtime = "nodejs";
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ success: true, maintenance: await loadMaintenance({ fresh: true }) }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memuat status maintenance.");
  }
}

export async function PUT(req: Request) {
  try {
    const admin = await requireSuperAdmin();
    const rl = enforceRateLimit(`admin-maintenance:${admin.id}`, { limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;
    const body = await readJsonBody<unknown>(req, 4 * 1024);
    let state;
    try { state = await saveMaintenance(body, admin.id); }
    catch {
      return NextResponse.json({ success: false, error: "Gagal menyimpan. Jalankan dulu database-hotfix-2026-11-11-app-settings.sql di phpPgAdmin." }, { status: 503 });
    }
    await recordAdminAction({ actorId: admin.id, action: state.enabled ? "maintenance-on" : "maintenance-off", detail: [state.message, state.until].filter(Boolean).join(" | ") });
    return NextResponse.json({ success: true, maintenance: state, message: state.enabled ? "Mode maintenance AKTIF. Pengunjung lain melihat halaman pemeliharaan dalam ±10 detik." : "Mode maintenance dimatikan. Situs kembali normal dan proses yang dijeda berlanjut." }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal menyimpan mode maintenance.");
  }
}
