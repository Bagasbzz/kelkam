/**
 * src/lib/server/maintenance.ts
 * -----------------------------------------------------------------------------
 * Mode maintenance (Tahap 2, rancangan E, keputusan K8).
 *  - Saklar di tabel `app_settings` kunci "maintenance", diatur super admin dari /superadmin (tanpa deploy).
 *  - Ditegakkan di `src/proxy.ts`: halaman → /maintenance, API → 503. Super admin tetap bisa masuk.
 *  - Proses latar (job laporan, agent run, gambar) dicek sebelum langkah berikutnya → dijeda, bukan digagalkan,
 *    lalu berlanjut otomatis setelah maintenance dimatikan.
 *  - Tanpa database / tabel belum ada → dianggap mati (situs tetap jalan).
 */
import type { Prisma } from "@prisma/client";

export interface MaintenanceState {
  enabled: boolean;
  /** Pesan tambahan untuk pengguna. */
  message: string;
  /** Perkiraan selesai, teks bebas (mis. "pukul 22.00 WIB"). */
  until: string;
  startedAt: string | null;
}

export const DEFAULT_MAINTENANCE: MaintenanceState = { enabled: false, message: "", until: "", startedAt: null };
const KEY = "maintenance";
const TTL_MS = 10_000;

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export function normalizeMaintenance(raw: unknown, previous?: MaintenanceState): MaintenanceState {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const enabled = o.enabled === true;
  const startedAt = enabled
    ? (previous?.enabled && previous.startedAt) || (typeof o.startedAt === "string" && !Number.isNaN(Date.parse(o.startedAt)) ? o.startedAt : new Date().toISOString())
    : null;
  return { enabled, message: clean(o.message, 500), until: clean(o.until, 80), startedAt };
}

/** Pesan untuk pengguna (halaman maintenance dan respons API 503). */
export function maintenanceText(state: Pick<MaintenanceState, "message" | "until">) {
  return ["keluhkampus sedang dalam pemeliharaan sebentar.", state.message, state.until ? `Perkiraan selesai: ${state.until}.` : "Silakan coba lagi beberapa saat lagi."].filter(Boolean).join(" ");
}

/** Path yang tetap terbuka untuk semua orang selama maintenance (agar super admin bisa login). */
export function isMaintenanceExemptPath(pathname: string) {
  return pathname === "/maintenance" || pathname === "/login" || pathname.startsWith("/api/auth/");
}

async function db() {
  return (await import("@/lib/db/prisma")).prisma;
}

let cache: { at: number; state: MaintenanceState } | null = null;

export async function loadMaintenance(options: { fresh?: boolean } = {}): Promise<MaintenanceState> {
  if (!options.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.state;
  if (!process.env.DATABASE_URL) return DEFAULT_MAINTENANCE;
  try {
    const row = await (await db()).appSetting.findUnique({ where: { key: KEY } });
    const state = row ? normalizeMaintenance(row.value, row.value as unknown as MaintenanceState) : DEFAULT_MAINTENANCE;
    cache = { at: Date.now(), state };
    return state;
  } catch {
    // Tabel belum ada / DB sesaat bermasalah: jangan menutup situs karena error.
    cache = { at: Date.now(), state: cache?.state ?? DEFAULT_MAINTENANCE };
    return cache.state;
  }
}

export async function saveMaintenance(raw: unknown, actorId: string): Promise<MaintenanceState> {
  const previous = await loadMaintenance({ fresh: true });
  const state = normalizeMaintenance(raw, previous);
  const value = state as unknown as Prisma.InputJsonValue;
  await (await db()).appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
  cache = { at: Date.now(), state };
  return state;
}

const superAdmins = new Map<string, { at: number; value: boolean }>();

/** Apakah ID akun ini super admin (dibaca dari DB, cache 60 dtk). */
export async function isSuperAdminId(userId: string): Promise<boolean> {
  if (!userId) return false;
  const hit = superAdmins.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  try {
    const { isSuperAdmin } = await import("@/lib/server/auth");
    const user = await (await db()).user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } });
    const value = isSuperAdmin(user);
    if (superAdmins.size > 2000) superAdmins.clear();
    superAdmins.set(userId, { at: Date.now(), value });
    return value;
  } catch {
    return false;
  }
}

/** True bila maintenance aktif dan pemilik proses bukan super admin → proses latar harus menunggu. */
export async function maintenanceBlocks(ownerId: string): Promise<boolean> {
  const state = await loadMaintenance();
  if (!state.enabled) return false;
  return !(await isSuperAdminId(ownerId));
}
