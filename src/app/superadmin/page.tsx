/**
 * /superadmin — panel super admin (Tahap 1 + Tahap 4 + Tahap 2).
 * Bisa dibuka di https://admin.keluhkampus.my.id (subdomain dipetakan ke sini oleh proxy) atau /superadmin.
 * Hanya super admin (isSuperAdmin); akun lain mendapat 404 agar halaman ini tidak terlihat ada.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/server/auth";
import { loadSuperAdminStats } from "@/lib/server/superadmin-stats";
import { loadOnlineUsers, loadTrends } from "@/lib/server/superadmin-analytics";
import { loadAiCostOverview } from "@/lib/server/ai-cost";
import { loadMaintenance } from "@/lib/server/maintenance";
import AiCostPanel from "@/components/superadmin/AiCostPanel";
import MaintenancePanel from "@/components/superadmin/MaintenancePanel";
import { BarChart, Card, fmt, Notice, rp, Section, Table } from "@/components/superadmin/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Super Admin", robots: { index: false, follow: false } };

const userLink = (id: string, label: string) => <Link href={`/superadmin/pengguna/${encodeURIComponent(id)}`} className="font-semibold text-blue-600 hover:underline">{label}</Link>;

export default async function SuperAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/");
  if (!isSuperAdmin(user)) notFound();
  const [s, trends, online, aiCost, maintenance] = await Promise.all([loadSuperAdminStats(), loadTrends(30), loadOnlineUsers(), loadAiCostOverview(), loadMaintenance({ fresh: true })]);
  const missing = [...new Set([...s.missing, ...trends.missing])];
  const t = trends.totals;
  const series = (key: "views" | "visitors" | "active" | "signups" | "logins" | "aiCalls" | "aiCost") => trends.series.map((p) => ({ day: p.day, value: p[key] }));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 text-slate-800">
      <div className="rounded-3xl bg-slate-950 p-8 text-white">
        <p className="text-sm font-bold text-blue-300">Super Admin</p>
        <h1 className="mt-1 text-3xl font-black">Panel sistem keluhkampus</h1>
        <p className="mt-2 text-sm text-slate-300">Masuk sebagai {user.email} (ID akun: <code className="text-white">{user.id}</code>). Data dihitung saat halaman dibuka (WIB).</p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/superadmin/pengguna" className="rounded-xl bg-blue-500 px-4 py-2 text-white hover:bg-blue-400">Analitik per pengguna</Link>
          <Link href="/tugas/admin694" className="rounded-xl bg-white px-4 py-2 text-slate-900">Kelola Tugas</Link>
          <Link href="/tugas/admin694/users" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Daftar akun & reset sandi</Link>
          <a href="/api/admin/db-health" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Cek database</a>
          <a href="/api/admin/ai-check" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Cek layanan AI</a>
        </div>
      </div>

      {maintenance.enabled && <Notice><b>Mode maintenance sedang AKTIF.</b> Pengguna lain melihat halaman pemeliharaan; matikan di bagian Mode maintenance di bawah.</Notice>}
      {missing.length > 0 && <Notice>Sebagian data belum bisa dibaca ({missing.join(", ")}). Jalankan file SQL hotfix terbaru di phpPgAdmin.</Notice>}

      <Section title="Ringkasan hari ini">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Total akun" value={s.users.total} hint={`+${fmt(s.users.new7d)} dalam 7 hari`} />
          <Card label="Online sekarang" value={s.presence.online} hint="aktif 5 menit terakhir" />
          <Card label="Aktif hari ini" value={s.presence.today} hint={`7 hari: ${fmt(s.presence.week)} · 30 hari: ${fmt(s.presence.month)}`} />
          <Card label="Login hari ini" value={s.logins.today} hint={`7 hari: ${fmt(s.logins.week)}`} />
          <Card label="Halaman dibuka hari ini" value={s.visits.today} hint={`pengunjung unik ${fmt(s.visits.uniqueToday)} (termasuk tamu)`} />
          <Card label="Panggilan AI hari ini" value={s.ai.callsToday} hint={`token ${fmt(s.ai.tokensToday)}`} />
          <Card label="Biaya AI hari ini" value={rp(aiCost.spend.day)} hint={`bulan ini ${rp(aiCost.spend.month)}`} />
          <Card label="Token aktual dari provider" value={`${s.ai.actualShare}%`} hint="sisanya perkiraan" />
        </div>
        {online.length > 0 && (
          <p className="mt-3 text-sm text-slate-600">Sedang online: {online.map((item, i) => <span key={item.id}>{i ? ", " : ""}{userLink(item.id, item.email)}</span>)}</p>
        )}
      </Section>

      <Section title="Tren 30 hari">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Akun aktif 30 hari" value={t.activeUsers} hint={`7 hari: ${fmt(t.activeWeek)} · rata-rata harian ${fmt(t.avgDailyActive)}`} />
          <Card label="Pengguna kembali" value={`${t.returningPct}%`} hint={`${fmt(t.returning)} akun aktif di ≥2 hari berbeda`} />
          <Card label="Pendaftaran 30 hari" value={t.signups} hint={`login ${fmt(t.logins)} kali`} />
          <Card label="Biaya AI 30 hari" value={rp(t.aiCost)} hint={`${fmt(t.aiCalls)} panggilan AI`} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <BarChart title="Akun aktif per hari" data={series("active")} color="bg-emerald-500" />
          <BarChart title="Pengunjung unik per hari (termasuk tamu)" data={series("visitors")} color="bg-blue-500" />
          <BarChart title="Halaman dibuka per hari" data={series("views")} color="bg-sky-400" />
          <BarChart title="Pendaftaran akun baru per hari" data={series("signups")} color="bg-violet-500" />
          <BarChart title="Panggilan AI per hari" data={series("aiCalls")} color="bg-amber-500" />
          <BarChart title="Biaya AI per hari" data={series("aiCost")} color="bg-red-500" format={rp} />
        </div>
      </Section>

      <Section title="Mode maintenance">
        <MaintenancePanel initial={maintenance} />
      </Section>

      <Section title="Kunjungan per fitur (7 hari)">
        <Table head={["Fitur", "Dibuka", "Pengunjung unik"]} rows={s.visits.byFeature.map((row) => [row.feature, row.views, row.visitors])} />
      </Section>

      <Section title="Pemakaian AI (7 hari)" action={<Link href="/superadmin/pengguna?sort=biaya" className="text-sm font-semibold text-blue-600 hover:underline">Biaya per pengguna →</Link>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={["Model", "Panggilan", "Input", "Output", "Gagal"]} rows={s.ai.byModel.map((row) => [row.model, row.calls, row.input, row.output, row.failed])} />
          <Table head={["Fitur/operasi", "Panggilan", "Token"]} rows={s.ai.byOperation.map((row) => [row.operation, row.calls, row.tokens])} />
        </div>
        <div className="mt-4"><Table head={["Pengguna AI terbanyak", "Panggilan", "Token"]} rows={s.ai.topUsers.map((row) => [userLink(row.id, row.email), row.calls, row.tokens])} /></div>
      </Section>

      <Section title="Batas biaya AI (rupiah)">
        <AiCostPanel initial={aiCost} />
      </Section>

      <Section title="Feedback pengguna (30 hari)">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {s.feedback.summary.map((row) => <Card key={row.feature} label={row.feature} value={`👍 ${fmt(row.up)} · 👎 ${fmt(row.down)}`} />)}
          {!s.feedback.summary.length && <Card label="Feedback" value="Belum ada" />}
        </div>
        <div className="mt-4"><Table head={["Waktu", "Fitur", "Komentar 👎"]} rows={s.feedback.negative.map((row) => [row.at, row.feature, row.comment])} /></div>
      </Section>

      <Section title="Log aksi admin">
        <Table head={["Waktu", "Aksi", "Detail"]} rows={s.audit.map((row) => [row.at, row.action, row.detail])} />
      </Section>
    </main>
  );
}
