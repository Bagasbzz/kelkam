/**
 * Statistik panel super admin (Tahap 4 ringkas). Setiap kueri berdiri sendiri: bila tabel belum ada
 * (SQL hotfix belum dijalankan), bagian itu kosong dan namanya dilaporkan di `missing`.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const DAY = 86_400_000;
const WIB = 7 * 3_600_000;

/** Awal hari ini dalam WIB, sebagai Date UTC. */
function startOfTodayWib(now = Date.now()) {
  const shifted = new Date(now + WIB);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - WIB);
}
const wibText = (date: Date) => new Date(date.getTime() + WIB).toISOString().slice(0, 16).replace("T", " ");
const num = (value: unknown) => Number(value ?? 0) || 0;

export async function loadSuperAdminStats() {
  const missing: string[] = [];
  const safe = async <T,>(name: string, fallback: T, run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch { if (!missing.includes(name)) missing.push(name); return fallback; }
  };
  const today = startOfTodayWib();
  const now = Date.now();
  const week = new Date(now - 7 * DAY);
  const month = new Date(now - 30 * DAY);

  const [users, presence, logins, visits, ai, feedback, audit, signupsByDay] = await Promise.all([
    safe("users", { total: 0, new7d: 0 }, async () => ({
      total: await prisma.user.count(),
      new7d: await prisma.user.count({ where: { createdAt: { gte: week } } }),
    })),
    safe("user_presence", { online: 0, today: 0, week: 0, month: 0 }, async () => {
      const [online, t, w, m] = await Promise.all([
        prisma.userPresence.count({ where: { lastSeenAt: { gte: new Date(now - 5 * 60_000) } } }),
        prisma.userPresence.count({ where: { lastSeenAt: { gte: today } } }),
        prisma.userPresence.count({ where: { lastSeenAt: { gte: week } } }),
        prisma.userPresence.count({ where: { lastSeenAt: { gte: month } } }),
      ]);
      return { online, today: t, week: w, month: m };
    }),
    safe("login_events", { today: 0, week: 0 }, async () => ({
      today: await prisma.loginEvent.count({ where: { createdAt: { gte: today } } }),
      week: await prisma.loginEvent.count({ where: { createdAt: { gte: week } } }),
    })),
    safe("activity_events", { today: 0, week: 0, uniqueToday: 0, uniqueWeek: 0, byFeature: [] as { feature: string; views: number; visitors: number }[] }, async () => {
      const [counts] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE created_at >= ${today}) AS today, COUNT(*) AS week,
               COUNT(DISTINCT visitor_id) FILTER (WHERE created_at >= ${today}) AS unique_today, COUNT(DISTINCT visitor_id) AS unique_week
        FROM activity_events WHERE created_at >= ${week}`);
      const byFeature = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(feature, '-') AS feature, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
        FROM activity_events WHERE created_at >= ${week} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
      return {
        today: num(counts?.today), week: num(counts?.week), uniqueToday: num(counts?.unique_today), uniqueWeek: num(counts?.unique_week),
        byFeature: byFeature.map((row) => ({ feature: String(row.feature), views: num(row.views), visitors: num(row.visitors) })),
      };
    }),
    safe("ai_usage", { callsToday: 0, tokensToday: 0, tokensWeek: 0, actualShare: 0, byModel: [] as { model: string; calls: number; input: number; output: number; failed: number }[], byOperation: [] as { operation: string; calls: number; tokens: number }[], topUsers: [] as { email: string; calls: number; tokens: number }[] }, async () => {
      const [totals] = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE created_at >= ${today}) AS calls_today,
               COALESCE(SUM(input_tokens + output_tokens) FILTER (WHERE created_at >= ${today}), 0) AS tokens_today,
               COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens_week,
               COUNT(*) FILTER (WHERE actual) AS actual_calls, COUNT(*) AS calls_week
        FROM ai_usage WHERE created_at >= ${week}`);
      const byModel = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT model, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, COUNT(*) FILTER (WHERE NOT ok) AS failed
        FROM ai_usage WHERE created_at >= ${week} GROUP BY model ORDER BY 2 DESC`);
      const byOperation = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT operation, COUNT(*) AS calls, SUM(input_tokens + output_tokens) AS tokens
        FROM ai_usage WHERE created_at >= ${week} GROUP BY operation ORDER BY 3 DESC LIMIT 12`);
      const topUsers = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(u.email, a.owner_id) AS email, COUNT(*) AS calls, SUM(a.input_tokens + a.output_tokens) AS tokens
        FROM ai_usage a LEFT JOIN users u ON u.id = a.owner_id
        WHERE a.created_at >= ${week} GROUP BY 1 ORDER BY 3 DESC LIMIT 10`);
      const callsWeek = num(totals?.calls_week);
      return {
        callsToday: num(totals?.calls_today), tokensToday: num(totals?.tokens_today), tokensWeek: num(totals?.tokens_week),
        actualShare: callsWeek ? Math.round((num(totals?.actual_calls) / callsWeek) * 100) : 0,
        byModel: byModel.map((row) => ({ model: String(row.model), calls: num(row.calls), input: num(row.input), output: num(row.output), failed: num(row.failed) })),
        byOperation: byOperation.map((row) => ({ operation: String(row.operation), calls: num(row.calls), tokens: num(row.tokens) })),
        topUsers: topUsers.map((row) => ({ email: String(row.email), calls: num(row.calls), tokens: num(row.tokens) })),
      };
    }),
    safe("feedbacks", { summary: [] as { feature: string; up: number; down: number }[], negative: [] as { at: string; feature: string; comment: string }[] }, async () => {
      const summary = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT feature, COUNT(*) FILTER (WHERE rating > 0) AS up, COUNT(*) FILTER (WHERE rating < 0) AS down
        FROM feedbacks WHERE created_at >= ${month} GROUP BY feature ORDER BY feature`);
      const negative = await prisma.feedback.findMany({ where: { rating: { lt: 0 }, comment: { not: null } }, orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, feature: true, comment: true } });
      return {
        summary: summary.map((row) => ({ feature: String(row.feature), up: num(row.up), down: num(row.down) })),
        negative: negative.map((row) => ({ at: wibText(row.createdAt), feature: row.feature, comment: row.comment || "" })),
      };
    }),
    safe("admin_audit_logs", [] as { at: string; action: string; detail: string }[], async () => {
      const rows = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 15, select: { createdAt: true, action: true, detail: true } });
      return rows.map((row) => ({ at: wibText(row.createdAt), action: row.action, detail: row.detail }));
    }),
    safe("users", [] as { day: string; count: number }[], async () => {
      const since = new Date(today.getTime() - 13 * DAY);
      const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT to_char((created_at + interval '7 hours')::date, 'YYYY-MM-DD') AS day, COUNT(*) AS count
        FROM users WHERE created_at >= ${since} GROUP BY 1`);
      const byDay = new Map(rows.map((row) => [String(row.day), num(row.count)]));
      return Array.from({ length: 14 }, (_, i) => {
        const day = new Date(since.getTime() + i * DAY + WIB).toISOString().slice(0, 10);
        return { day, count: byDay.get(day) ?? 0 };
      });
    }),
  ]);

  return { users, presence, logins, visits, ai, feedback, audit, signupsByDay, missing };
}
