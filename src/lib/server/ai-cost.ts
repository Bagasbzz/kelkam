/**
 * src/lib/server/ai-cost.ts
 * -----------------------------------------------------------------------------
 * Batas biaya AI dalam RUPIAH (keputusan pemilik K3, 2026-11-11).
 *  - Diatur super admin dari panel (/superadmin), disimpan di tabel `app_settings` kunci "ai_cost".
 *  - Batas global (seluruh situs) dan per pengguna, masing-masing bisa harian, mingguan (Senin), bulanan (tgl 1), WIB.
 *  - Biaya dihitung dari token yang tercatat di `ai_usage` (Tahap 3) x harga model (USD per 1 juta token) x kurs.
 *  - Sebelum tiap panggilan AI: terpakai + perkiraan panggilan ini > batas → ditolak (AiBudgetError).
 *  - Super admin tidak kena batas per pengguna; batas global berlaku untuk semua.
 *  - Bila tabel belum ada atau DB bermasalah, pengecekan dilewati (rem harian lama di ai-budget.ts tetap aktif).
 */
import { Prisma } from "@prisma/client";
import { AiBudgetError, type BudgetCharge } from "@/lib/server/ai-budget";
import { isSuperAdminId } from "@/lib/server/maintenance";

export type CostPeriod = "day" | "week" | "month";
export const COST_PERIODS: CostPeriod[] = ["day", "week", "month"];
export type PeriodLimits = Record<CostPeriod, number | null>;
export interface ModelPrice { input: number; output: number }
export interface AiCostConfig {
  enabled: boolean;
  /** Rupiah per 1 USD kredit provider (Mindaku: 1 USD ≈ Rp1.000). */
  usdToIdr: number;
  global: PeriodLimits;
  perUser: PeriodLimits;
  /** USD per 1 juta token, per nama model persis seperti di ai_usage. */
  prices: Record<string, ModelPrice>;
  /** Harga untuk model yang belum ada di daftar (dibuat mahal agar aman). */
  defaultPrice: ModelPrice;
  /** USD per gambar. */
  imagePriceUsd: number;
}
export type PeriodSpend = Record<CostPeriod, number>;

export const DEFAULT_AI_COST_CONFIG: AiCostConfig = {
  enabled: false,
  usdToIdr: 1000,
  global: { day: null, week: null, month: null },
  perUser: { day: null, week: null, month: null },
  prices: { "claude-sonnet-5": { input: 2, output: 10 } },
  defaultPrice: { input: 2, output: 10 },
  imagePriceUsd: 0.05,
};

const SETTING_KEY = "ai_cost";
const WIB = 7 * 3_600_000;
const DAY = 86_400_000;

function positive(value: unknown, max: number): number | null {
  // Angka desimal (harga USD): koma Indonesia diterima sebagai titik desimal.
  const n = typeof value === "string" ? Number(value.replace(",", ".").replace(/[^\d.]/g, "")) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(max, n);
}
/** Nominal rupiah: titik/koma adalah pemisah ribuan ("50.000" = 50000). */
function rupiah(value: unknown, max: number): number | null {
  const n = typeof value === "string" ? Number(value.replace(/[^\d]/g, "")) : Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(max, n);
}
function price(value: unknown, fallback: ModelPrice): ModelPrice {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { input: positive(o.input, 10_000) ?? fallback.input, output: positive(o.output, 10_000) ?? fallback.output };
}
function limits(value: unknown): PeriodLimits {
  const o = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const out = {} as PeriodLimits;
  for (const p of COST_PERIODS) {
    const n = rupiah(o[p], 1_000_000_000_000);
    out[p] = n;
  }
  return out;
}

/** Validasi isi dari DB/panel. Nilai tidak valid jatuh ke bawaan; 0/kosong = tanpa batas. */
export function normalizeAiCostConfig(raw: unknown): AiCostConfig {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const defaultPrice = price(o.defaultPrice, DEFAULT_AI_COST_CONFIG.defaultPrice);
  const prices: Record<string, ModelPrice> = {};
  const rawPrices = o.prices && typeof o.prices === "object" ? (o.prices as Record<string, unknown>) : DEFAULT_AI_COST_CONFIG.prices;
  for (const [model, value] of Object.entries(rawPrices).slice(0, 50)) {
    const name = model.trim().slice(0, 80);
    if (name) prices[name] = price(value, defaultPrice);
  }
  return {
    enabled: o.enabled === true,
    usdToIdr: rupiah(o.usdToIdr, 1_000_000) ?? DEFAULT_AI_COST_CONFIG.usdToIdr,
    global: limits(o.global),
    perUser: limits(o.perUser),
    prices,
    defaultPrice,
    imagePriceUsd: positive(o.imagePriceUsd, 100) ?? DEFAULT_AI_COST_CONFIG.imagePriceUsd,
  };
}

/** Awal hari, minggu (Senin), dan bulan berjalan dalam WIB, sebagai Date UTC. */
export function periodStarts(now = new Date()): Record<CostPeriod, Date> {
  const shifted = new Date(now.getTime() + WIB);
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), d = shifted.getUTCDate();
  const day = Date.UTC(y, m, d) - WIB;
  const sinceMonday = (shifted.getUTCDay() + 6) % 7;
  return { day: new Date(day), week: new Date(day - sinceMonday * DAY), month: new Date(Date.UTC(y, m, 1) - WIB) };
}

export interface UsageRow { model: string; kind: string; input: number; output: number; calls: number }

/** Rupiah untuk sekumpulan baris pemakaian. */
export function rupiahFor(rows: UsageRow[], config: AiCostConfig): number {
  let usd = 0;
  for (const row of rows) {
    if (row.kind === "image") { usd += row.calls * config.imagePriceUsd; continue; }
    const p = config.prices[row.model] ?? config.defaultPrice;
    usd += (row.input * p.input + row.output * p.output) / 1_000_000;
  }
  return usd * config.usdToIdr;
}

/** Perkiraan rupiah satu panggilan sebelum dikirim (input perkiraan + max_tokens output, batas atas). */
export function estimateCallRupiah(charge: Pick<BudgetCharge, "model" | "kind" | "inputTokens" | "outputTokens">, config: AiCostConfig): number {
  return rupiahFor([{ model: charge.model, kind: charge.kind, input: charge.inputTokens, output: charge.outputTokens, calls: 1 }], config);
}

const PERIOD_TEXT: Record<CostPeriod, { label: string; retry: string }> = {
  day: { label: "hari ini", retry: "besok" },
  week: { label: "minggu ini", retry: "minggu depan (mulai Senin)" },
  month: { label: "bulan ini", retry: "awal bulan depan" },
};

/** Periode pertama yang terlampaui, atau null. */
export function exceededPeriod(spent: PeriodSpend, limit: PeriodLimits, extra: number): CostPeriod | null {
  for (const p of COST_PERIODS) {
    const max = limit[p];
    if (max !== null && spent[p] + extra > max) return p;
  }
  return null;
}

export function costLimitMessage(scope: "global" | "user", period: CostPeriod) {
  const t = PERIOD_TEXT[period];
  return scope === "user"
    ? `Batas pemakaian AI akun Anda untuk ${t.label} sudah tercapai. Coba lagi ${t.retry}.`
    : `Layanan AI sudah mencapai batas pemakaian ${t.label}. Coba lagi ${t.retry}.`;
}

// ---------------------------------------------------------------------------
// Akses DB (import dinamis agar modul murni di atas bisa dites tanpa DB)
// ---------------------------------------------------------------------------

async function db() {
  return (await import("@/lib/db/prisma")).prisma;
}

let configCache: { at: number; config: AiCostConfig; stored: boolean } | null = null;
const CONFIG_TTL_MS = 30_000;

/** Pengaturan aktif. `stored=false` berarti belum pernah disimpan atau tabel belum ada. */
export async function loadAiCostConfig(options: { fresh?: boolean } = {}): Promise<{ config: AiCostConfig; stored: boolean; tableMissing: boolean }> {
  if (!options.fresh && configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return { config: configCache.config, stored: configCache.stored, tableMissing: false };
  // Tanpa database (tes/offline) tidak ada pengaturan tersimpan.
  if (!process.env.DATABASE_URL) return { config: DEFAULT_AI_COST_CONFIG, stored: false, tableMissing: true };
  try {
    const row = await (await db()).appSetting.findUnique({ where: { key: SETTING_KEY } });
    const config = row ? normalizeAiCostConfig(row.value) : DEFAULT_AI_COST_CONFIG;
    configCache = { at: Date.now(), config, stored: Boolean(row) };
    return { config, stored: Boolean(row), tableMissing: false };
  } catch {
    configCache = { at: Date.now(), config: DEFAULT_AI_COST_CONFIG, stored: false };
    return { config: DEFAULT_AI_COST_CONFIG, stored: false, tableMissing: true };
  }
}

export async function saveAiCostConfig(raw: unknown, actorId: string): Promise<AiCostConfig> {
  const config = normalizeAiCostConfig(raw);
  const value = config as unknown as Prisma.InputJsonValue;
  await (await db()).appSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value, updatedBy: actorId }, update: { value, updatedBy: actorId } });
  configCache = { at: Date.now(), config, stored: true };
  spendCache.clear();
  return config;
}

const num = (value: unknown) => Number(value ?? 0) || 0;

/** Pemakaian rupiah hari/minggu/bulan ini, seluruh situs (ownerId null) atau satu pengguna. */
export async function loadSpend(config: AiCostConfig, ownerId: string | null, now = new Date()): Promise<PeriodSpend> {
  const starts = periodStarts(now);
  const from = new Date(Math.min(starts.day.getTime(), starts.week.getTime(), starts.month.getTime()));
  const rows = await (await db()).$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT model, kind,
      COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= ${starts.day}), 0) AS in_day,
      COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= ${starts.day}), 0) AS out_day,
      COUNT(*) FILTER (WHERE created_at >= ${starts.day}) AS calls_day,
      COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= ${starts.week}), 0) AS in_week,
      COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= ${starts.week}), 0) AS out_week,
      COUNT(*) FILTER (WHERE created_at >= ${starts.week}) AS calls_week,
      COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= ${starts.month}), 0) AS in_month,
      COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= ${starts.month}), 0) AS out_month,
      COUNT(*) FILTER (WHERE created_at >= ${starts.month}) AS calls_month
    FROM ai_usage
    WHERE created_at >= ${from} ${ownerId ? Prisma.sql`AND owner_id = ${ownerId}` : Prisma.empty}
    GROUP BY model, kind`);
  const spend = {} as PeriodSpend;
  for (const p of COST_PERIODS) {
    spend[p] = rupiahFor(rows.map((row) => ({ model: String(row.model), kind: String(row.kind), input: num(row[`in_${p}`]), output: num(row[`out_${p}`]), calls: num(row[`calls_${p}`]) })), config);
  }
  return spend;
}

/** Pemakaian rupiah bulan ini per pengguna (untuk panel). */
export async function loadUserSpendThisMonth(config: AiCostConfig, limit = 15, now = new Date()) {
  const start = periodStarts(now).month;
  const rows = await (await db()).$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT a.owner_id, COALESCE(u.email, a.owner_id) AS email, a.model, a.kind,
      SUM(a.input_tokens) AS input, SUM(a.output_tokens) AS output, COUNT(*) AS calls
    FROM ai_usage a LEFT JOIN users u ON u.id = a.owner_id
    WHERE a.created_at >= ${start}
    GROUP BY a.owner_id, u.email, a.model, a.kind`);
  const byOwner = new Map<string, { email: string; calls: number; rows: UsageRow[] }>();
  for (const row of rows) {
    const id = String(row.owner_id);
    const entry = byOwner.get(id) ?? { email: String(row.email), calls: 0, rows: [] };
    entry.calls += num(row.calls);
    entry.rows.push({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) });
    byOwner.set(id, entry);
  }
  return [...byOwner.entries()]
    .map(([ownerId, entry]) => ({ ownerId, email: entry.email, calls: entry.calls, rupiah: rupiahFor(entry.rows, config) }))
    .sort((a, b) => b.rupiah - a.rupiah)
    .slice(0, limit);
}

/** Model yang dipakai 30 hari terakhir (agar pemilik bisa mengisi harganya). */
export async function loadRecentModels(): Promise<Array<{ model: string; kind: string; calls: number }>> {
  const rows = await (await db()).$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT model, kind, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ${new Date(Date.now() - 30 * DAY)} GROUP BY model, kind ORDER BY 3 DESC LIMIT 30`);
  return rows.map((row) => ({ model: String(row.model), kind: String(row.kind), calls: num(row.calls) }));
}

/** Data panel super admin. Tiap bagian berdiri sendiri: tabel yang belum ada dilaporkan, bukan error. */
export async function loadAiCostOverview() {
  const { config, stored, tableMissing } = await loadAiCostConfig({ fresh: true });
  let usageMissing = false;
  const guard = async <T,>(fallback: T, run: () => Promise<T>) => { try { return await run(); } catch { usageMissing = true; return fallback; } };
  const [spend, users, models] = await Promise.all([
    guard<PeriodSpend>({ day: 0, week: 0, month: 0 }, () => loadSpend(config, null)),
    guard([] as Awaited<ReturnType<typeof loadUserSpendThisMonth>>, () => loadUserSpendThisMonth(config)),
    guard([] as Awaited<ReturnType<typeof loadRecentModels>>, () => loadRecentModels()),
  ]);
  return { config, stored, tableMissing, usageMissing, spend, users, models };
}

// Cache singkat untuk pengecekan per panggilan AI (job laporan bisa memanggil banyak sekaligus).
const SPEND_TTL_MS = 10_000;
const spendCache = new Map<string, { at: number; spend: PeriodSpend }>();
async function cachedSpend(config: AiCostConfig, ownerId: string | null) {
  const key = ownerId ?? "*";
  const hit = spendCache.get(key);
  if (hit && Date.now() - hit.at < SPEND_TTL_MS) return hit.spend;
  const spend = await loadSpend(config, ownerId);
  if (spendCache.size > 2000) spendCache.clear();
  spendCache.set(key, { at: Date.now(), spend });
  return spend;
}

let warned = false;

/** Dipanggil sebelum setiap panggilan provider AI. Melempar AiBudgetError bila batas rupiah terlampaui. */
export async function assertAiCostAllowed(ownerId: string, charge: Pick<BudgetCharge, "model" | "kind" | "inputTokens" | "outputTokens">) {
  const { config } = await loadAiCostConfig();
  if (!config.enabled) return;
  const hasGlobal = COST_PERIODS.some((p) => config.global[p] !== null);
  const hasUser = COST_PERIODS.some((p) => config.perUser[p] !== null);
  if (!hasGlobal && !hasUser) return;
  const extra = estimateCallRupiah(charge, config);
  try {
    if (hasGlobal) {
      const period = exceededPeriod(await cachedSpend(config, null), config.global, extra);
      if (period) throw new AiBudgetError(costLimitMessage("global", period));
    }
    if (hasUser && !(await isSuperAdminId(ownerId))) {
      const period = exceededPeriod(await cachedSpend(config, ownerId), config.perUser, extra);
      if (period) throw new AiBudgetError(costLimitMessage("user", period));
    }
  } catch (error) {
    if (error instanceof AiBudgetError) throw error;
    // DB/tabel ai_usage bermasalah: jangan matikan semua fitur AI; rem harian lama tetap menjaga.
    if (!warned) { warned = true; console.warn("[ai-cost] pengecekan batas rupiah dilewati:", error instanceof Error ? error.message.slice(0, 200) : error); }
  }
}
