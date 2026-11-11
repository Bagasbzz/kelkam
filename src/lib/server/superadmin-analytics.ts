/**
 * src/lib/server/superadmin-analytics.ts
 * -----------------------------------------------------------------------------
 * Dashboard analitik lengkap (Tahap 4, rancangan C): tren 30 hari, retensi, pengguna online,
 * daftar pengguna, dan detail per pengguna. Definisi:
 *   kunjungan = halaman dibuka (termasuk tamu) · aktif = akun yang membuka halaman atau memakai AI pada hari itu
 *   online = aktivitas 5 menit terakhir · kembali = aktif di ≥2 hari berbeda dalam 30 hari.
 * Setiap kueri berdiri sendiri; tabel yang belum ada dilaporkan di `missing`, bukan error.
 * Waktu dihitung WIB.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { loadAiCostConfig, periodStarts, rupiahFor, type UsageRow } from "@/lib/server/ai-cost";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
const num = (value: unknown) => Number(value ?? 0) || 0;
/** Tanggal WIB dari kolom created_at (semua tabel analitik memakai nama kolom ini). */
const DAY_SQL = () => Prisma.sql`to_char((created_at + interval '7 hours')::date, 'YYYY-MM-DD')`;
export const wibText = (date: Date | null | undefined) => (date ? new Date(date.getTime() + WIB).toISOString().slice(0, 16).replace("T", " ") : "-");

function guard(missing: string[]) {
  return async <T,>(name: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch { if (!missing.includes(name)) missing.push(name); return fallback; }
  };
}

/** Label hari (YYYY-MM-DD WIB) untuk `days` hari terakhir termasuk hari ini, beserta awalnya (UTC). */
export function dayRange(days: number, now = new Date()) {
  const today = periodStarts(now).day;
  const from = new Date(today.getTime() - (days - 1) * DAY);
  const labels = Array.from({ length: days }, (_, i) => new Date(from.getTime() + i * DAY + WIB).toISOString().slice(0, 10));
  return { from, labels };
}

export interface TrendPoint { day: string; views: number; visitors: number; active: number; signups: number; logins: number; aiCalls: number; aiCost: number }

/** Tren harian 30 hari + retensi (dari pasangan hari-akun aktif). */
export async function loadTrends(days = 30) {
  const missing: string[] = [];
  const safe = guard(missing);
  const { from, labels } = dayRange(days);
  const { config } = await loadAiCostConfig();

  const [views, signups, logins, aiRows, activityPairs, aiPairs] = await Promise.all([
    safe("activity_events", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
      FROM activity_events WHERE created_at >= ${from} GROUP BY 1`)),
    safe("users", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, COUNT(*) AS count FROM users WHERE created_at >= ${from} GROUP BY 1`)),
    safe("login_events", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, COUNT(*) AS count FROM login_events WHERE created_at >= ${from} GROUP BY 1`)),
    safe("ai_usage", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, model, kind, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
      FROM ai_usage WHERE created_at >= ${from} GROUP BY 1, 2, 3`)),
    safe("activity_events", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT DISTINCT ${DAY_SQL()} AS day, user_id AS uid FROM activity_events WHERE user_id IS NOT NULL AND created_at >= ${from}`)),
    safe("ai_usage", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT DISTINCT ${DAY_SQL()} AS day, owner_id AS uid FROM ai_usage WHERE created_at >= ${from}`)),
  ]);

  const activeByDay = new Map<string, Set<string>>();
  const daysByUser = new Map<string, Set<string>>();
  for (const row of [...activityPairs, ...aiPairs]) {
    const day = String(row.day), uid = String(row.uid);
    if (!activeByDay.has(day)) activeByDay.set(day, new Set());
    activeByDay.get(day)!.add(uid);
    if (!daysByUser.has(uid)) daysByUser.set(uid, new Set());
    daysByUser.get(uid)!.add(day);
  }
  const aiByDay = new Map<string, UsageRow[]>();
  for (const row of aiRows) {
    const day = String(row.day);
    if (!aiByDay.has(day)) aiByDay.set(day, []);
    aiByDay.get(day)!.push({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) });
  }
  const viewMap = new Map(views.map((row) => [String(row.day), row]));
  const signupMap = new Map(signups.map((row) => [String(row.day), num(row.count)]));
  const loginMap = new Map(logins.map((row) => [String(row.day), num(row.count)]));

  const series: TrendPoint[] = labels.map((day) => {
    const ai = aiByDay.get(day) ?? [];
    return {
      day,
      views: num(viewMap.get(day)?.views), visitors: num(viewMap.get(day)?.visitors),
      active: activeByDay.get(day)?.size ?? 0,
      signups: signupMap.get(day) ?? 0, logins: loginMap.get(day) ?? 0,
      aiCalls: ai.reduce((sum, row) => sum + row.calls, 0), aiCost: rupiahFor(ai, config),
    };
  });

  const activeUsers = daysByUser.size;
  const returning = [...daysByUser.values()].filter((set) => set.size >= 2).length;
  const week = new Set(labels.slice(-7));
  const activeWeek = [...daysByUser.values()].filter((set) => [...set].some((day) => week.has(day))).length;
  return {
    series,
    totals: {
      views: series.reduce((s, p) => s + p.views, 0),
      signups: series.reduce((s, p) => s + p.signups, 0),
      logins: series.reduce((s, p) => s + p.logins, 0),
      aiCalls: series.reduce((s, p) => s + p.aiCalls, 0),
      aiCost: series.reduce((s, p) => s + p.aiCost, 0),
      activeUsers, activeWeek, returning,
      returningPct: activeUsers ? Math.round((returning / activeUsers) * 100) : 0,
      avgDailyActive: Math.round(series.reduce((s, p) => s + p.active, 0) / Math.max(1, series.length)),
    },
    missing,
  };
}

/** Akun yang aktif 5 menit terakhir. */
export async function loadOnlineUsers() {
  try {
    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT p.user_id, u.email, p.last_seen_at FROM user_presence p LEFT JOIN users u ON u.id = p.user_id
      WHERE p.last_seen_at >= ${new Date(Date.now() - 5 * 60_000)} ORDER BY p.last_seen_at DESC LIMIT 30`);
    return rows.map((row) => ({ id: String(row.user_id), email: String(row.email ?? row.user_id), at: wibText(row.last_seen_at as Date) }));
  } catch { return []; }
}

export type UserSort = "aktif" | "baru" | "ai" | "biaya";
export const USER_SORTS: Record<UserSort, string> = { aktif: "Terakhir aktif", baru: "Terbaru daftar", ai: "Pemakaian AI 30 hari", biaya: "Biaya AI bulan ini" };

export interface UserRow {
  id: string; email: string; name: string | null; role: string; createdAt: string; lastSeen: string;
  logins30: number; views30: number; aiCalls30: number; laporan: number; presentasi: number; costMonth: number;
}

/** Biaya rupiah bulan ini per akun. */
async function monthCostByOwner(ownerIds: string[] | null) {
  const { config } = await loadAiCostConfig();
  const start = periodStarts().month;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT owner_id, model, kind, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
    FROM ai_usage WHERE created_at >= ${start} ${ownerIds ? Prisma.sql`AND owner_id IN (${Prisma.join(ownerIds.length ? ownerIds : [""])})` : Prisma.empty}
    GROUP BY 1, 2, 3`);
  const byOwner = new Map<string, UsageRow[]>();
  for (const row of rows) {
    const id = String(row.owner_id);
    if (!byOwner.has(id)) byOwner.set(id, []);
    byOwner.get(id)!.push({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) });
  }
  return new Map([...byOwner].map(([id, list]) => [id, rupiahFor(list, config)]));
}

/** Daftar pengguna untuk /superadmin/pengguna (50 per halaman). */
export async function loadUserList(input: { q?: string; sort?: UserSort; page?: number }) {
  const q = (input.q || "").trim().slice(0, 100);
  const sort: UserSort = input.sort && input.sort in USER_SORTS ? input.sort : "aktif";
  const page = Math.max(1, Math.floor(input.page || 1));
  const size = 50;
  const from30 = new Date(Date.now() - 30 * DAY);
  const where = q ? Prisma.sql`WHERE u.email ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`}` : Prisma.empty;
  const total = await prisma.user.count({ where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {} });
  let full = true;
  let rows: Array<Record<string, unknown>>;
  let costs = new Map<string, number>();

  if (sort === "biaya") {
    // Urut biaya: hitung biaya semua akun yang memakai AI bulan ini, lalu ambil satu halaman.
    try { costs = await monthCostByOwner(null); } catch { full = false; }
  }
  try {
    const order = sort === "baru" ? Prisma.sql`u.created_at DESC`
      : sort === "ai" ? Prisma.sql`ai_calls DESC, p.last_seen_at DESC NULLS LAST`
      : Prisma.sql`p.last_seen_at DESC NULLS LAST, u.created_at DESC`;
    const byCost = sort === "biaya" && costs.size;
    const ids = byCost ? [...costs.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id) : null;
    rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT u.id, u.email, u.name, u.role, u.created_at, p.last_seen_at,
        (SELECT COUNT(*) FROM login_events l WHERE l.user_id = u.id AND l.created_at >= ${from30}) AS logins,
        (SELECT COUNT(*) FROM activity_events a WHERE a.user_id = u.id AND a.created_at >= ${from30}) AS views,
        (SELECT COUNT(*) FROM ai_usage x WHERE x.owner_id = u.id AND x.created_at >= ${from30}) AS ai_calls,
        (SELECT COUNT(*) FROM report_sessions r WHERE r.owner_id = u.id) AS laporan,
        (SELECT COUNT(*) FROM projects pr WHERE pr.owner_id = u.id AND pr.metadata->>'kind' = 'presentation') AS presentasi
      FROM users u LEFT JOIN user_presence p ON p.user_id = u.id
      ${where}
      ${byCost ? Prisma.empty : Prisma.sql`ORDER BY ${order} LIMIT ${size} OFFSET ${(page - 1) * size}`}`);
    if (ids) {
      const rank = new Map(ids.map((id, i) => [id, i]));
      rows = rows.sort((a, b) => (rank.get(String(a.id)) ?? 1e9) - (rank.get(String(b.id)) ?? 1e9)).slice((page - 1) * size, page * size);
    }
  } catch {
    // Tabel analitik belum ada: tampilkan data dasar akun.
    full = false;
    const users = await prisma.user.findMany({
      where: q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" }, skip: (page - 1) * size, take: size,
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    rows = users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.createdAt }));
  }
  if (sort !== "biaya") {
    try { costs = await monthCostByOwner(rows.map((row) => String(row.id))); } catch { /* ai_usage belum ada */ }
  }
  const users: UserRow[] = rows.map((row) => ({
    id: String(row.id), email: String(row.email), name: (row.name as string | null) ?? null, role: String(row.role),
    createdAt: wibText(row.created_at as Date), lastSeen: wibText((row.last_seen_at as Date | null) ?? null),
    logins30: num(row.logins), views30: num(row.views), aiCalls30: num(row.ai_calls), laporan: num(row.laporan), presentasi: num(row.presentasi),
    costMonth: costs.get(String(row.id)) ?? 0,
  }));
  return { users, total, page, pageSize: size, sort, q, full };
}

/** Detail satu pengguna untuk /superadmin/pengguna/[id]. Tidak membaca isi prompt/percakapan. */
export async function loadUserDetail(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, role: true, createdAt: true } });
  if (!user) return null;
  const missing: string[] = [];
  const safe = guard(missing);
  const { from, labels } = dayRange(30);
  const { config } = await loadAiCostConfig();
  const monthStart = periodStarts().month;

  const [presence, logins, viewDays, aiDays, features, aiOps, aiMonth, laporan, presentasi, jobs, images, feedback] = await Promise.all([
    safe("user_presence", null as Date | null, async () => (await prisma.userPresence.findUnique({ where: { userId } }))?.lastSeenAt ?? null),
    safe("login_events", [] as Array<{ at: string; method: string }>, async () => (await prisma.loginEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15 })).map((row) => ({ at: wibText(row.createdAt), method: row.method }))),
    safe("activity_events", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, COUNT(*) AS count FROM activity_events WHERE user_id = ${userId} AND created_at >= ${from} GROUP BY 1`)),
    safe("ai_usage", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${DAY_SQL()} AS day, model, kind, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
      FROM ai_usage WHERE owner_id = ${userId} AND created_at >= ${from} GROUP BY 1, 2, 3`)),
    safe("activity_events", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT COALESCE(feature, '-') AS feature, COUNT(*) AS views, MAX(created_at) AS last_at
      FROM activity_events WHERE user_id = ${userId} AND created_at >= ${from} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`)),
    safe("ai_usage", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT operation, model, kind, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
      FROM ai_usage WHERE owner_id = ${userId} AND created_at >= ${from} GROUP BY 1, 2, 3`)),
    safe("ai_usage", [] as Array<Record<string, unknown>>, () => prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT model, kind, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output
      FROM ai_usage WHERE owner_id = ${userId} AND created_at >= ${monthStart} GROUP BY 1, 2`)),
    safe("report_sessions", [] as Array<{ id: string; title: string; stage: string; updatedAt: string }>, async () => (await prisma.reportSession.findMany({ where: { ownerId: userId }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, title: true, stage: true, updatedAt: true } })).map((row) => ({ id: row.id, title: row.title || "Tanpa judul", stage: row.stage, updatedAt: wibText(row.updatedAt) }))),
    safe("projects", [] as Array<{ title: string; updatedAt: string; slides: number }>, async () => {
      const rows = await prisma.project.findMany({ where: { ownerId: userId, metadata: { path: ["kind"], equals: "presentation" } }, select: { metadata: true, createdAt: true }, take: 50 });
      return rows.map((row) => {
        const meta = (row.metadata ?? {}) as { updatedAt?: string; deck?: { title?: string; slides?: unknown[] } };
        return { title: meta.deck?.title || "Tanpa judul", updatedAt: meta.updatedAt ? wibText(new Date(meta.updatedAt)) : wibText(row.createdAt), slides: Array.isArray(meta.deck?.slides) ? meta.deck!.slides!.length : 0 };
      }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
    }),
    safe("report_jobs", [] as Array<{ title: string; status: string; mode: string; createdAt: string }>, async () => (await prisma.reportJob.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "desc" }, take: 10, select: { title: true, status: true, mode: true, createdAt: true } })).map((row) => ({ title: row.title || "Laporan", status: row.status, mode: row.mode, createdAt: wibText(row.createdAt) }))),
    safe("image_jobs", { done: 0, failed: 0 }, async () => ({
      done: await prisma.imageJob.count({ where: { ownerId: userId, status: "done" } }),
      failed: await prisma.imageJob.count({ where: { ownerId: userId, status: "failed" } }),
    })),
    safe("feedbacks", [] as Array<{ at: string; feature: string; rating: number; comment: string }>, async () => (await prisma.feedback.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 15 })).map((row) => ({ at: wibText(row.createdAt), feature: row.feature, rating: row.rating, comment: row.comment || "" }))),
  ]);

  const viewMap = new Map(viewDays.map((row) => [String(row.day), num(row.count)]));
  const aiByDay = new Map<string, UsageRow[]>();
  for (const row of aiDays) {
    const day = String(row.day);
    if (!aiByDay.has(day)) aiByDay.set(day, []);
    aiByDay.get(day)!.push({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) });
  }
  const daily = labels.map((day) => {
    const ai = aiByDay.get(day) ?? [];
    return { day, views: viewMap.get(day) ?? 0, aiCalls: ai.reduce((s, r) => s + r.calls, 0), aiCost: rupiahFor(ai, config) };
  });
  const opMap = new Map<string, { calls: number; tokens: number; rows: UsageRow[] }>();
  for (const row of aiOps) {
    const key = String(row.operation);
    const entry = opMap.get(key) ?? { calls: 0, tokens: 0, rows: [] };
    entry.calls += num(row.calls); entry.tokens += num(row.input) + num(row.output);
    entry.rows.push({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) });
    opMap.set(key, entry);
  }
  const operations = [...opMap].map(([operation, e]) => ({ operation, calls: e.calls, tokens: e.tokens, cost: rupiahFor(e.rows, config) })).sort((a, b) => b.cost - a.cost);
  const monthRows: UsageRow[] = aiMonth.map((row) => ({ model: String(row.model), kind: String(row.kind), input: num(row.input), output: num(row.output), calls: num(row.calls) }));

  return {
    user: { ...user, createdAt: wibText(user.createdAt) },
    lastSeen: wibText(presence),
    activeDays30: daily.filter((d) => d.views || d.aiCalls).length,
    daily,
    totals30: { views: daily.reduce((s, d) => s + d.views, 0), aiCalls: daily.reduce((s, d) => s + d.aiCalls, 0), aiCost: daily.reduce((s, d) => s + d.aiCost, 0) },
    costMonth: rupiahFor(monthRows, config),
    costLimitMonth: config.enabled ? config.perUser.month : null,
    logins, features: features.map((row) => ({ feature: String(row.feature), views: num(row.views), lastAt: wibText(row.last_at as Date) })),
    operations, laporan, presentasi, jobs, images, feedback, missing,
  };
}
