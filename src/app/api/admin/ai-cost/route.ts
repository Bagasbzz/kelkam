/**
 * /api/admin/ai-cost, batas biaya AI dalam rupiah (SUPER ADMIN saja).
 *   GET → pengaturan + pemakaian rupiah global hari/minggu/bulan ini + pengguna termahal bulan ini + model terpakai.
 *   PUT { enabled, usdToIdr, global{day,week,month}, perUser{day,week,month}, prices{model:{input,output}}, defaultPrice, imagePriceUsd }
 */
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/server/auth";
import { recordAdminAction } from "@/lib/server/analytics";
import { loadAiCostConfig, loadAiCostOverview, saveAiCostConfig } from "@/lib/server/ai-cost";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

export const runtime = "nodejs";
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ success: true, ...(await loadAiCostOverview()) }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal memuat batas biaya AI.");
  }
}

const rp = (value: number | null) => (value === null ? "-" : `Rp${Math.round(value).toLocaleString("id-ID")}`);

export async function PUT(req: Request) {
  try {
    const admin = await requireSuperAdmin();
    const rl = enforceRateLimit(`admin-ai-cost:${admin.id}`, { limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;
    const body = await readJsonBody<unknown>(req, 16 * 1024);
    const before = (await loadAiCostConfig({ fresh: true })).config;
    let config;
    try { config = await saveAiCostConfig(body, admin.id); }
    catch {
      return NextResponse.json({ success: false, error: "Gagal menyimpan. Jalankan dulu database-hotfix-2026-11-11-app-settings.sql di phpPgAdmin." }, { status: 503 });
    }
    const describe = (c: typeof config) => `${c.enabled ? "aktif" : "mati"}; global ${rp(c.global.day)}/${rp(c.global.week)}/${rp(c.global.month)}; per pengguna ${rp(c.perUser.day)}/${rp(c.perUser.week)}/${rp(c.perUser.month)}; kurs ${c.usdToIdr}`;
    await recordAdminAction({ actorId: admin.id, action: "set-ai-cost", detail: `${describe(before)} -> ${describe(config)}` });
    return NextResponse.json({ success: true, config, message: "Batas biaya AI disimpan. Berlaku dalam ±30 detik." }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal menyimpan batas biaya AI.");
  }
}
