/**
 * /superadmin — panel super admin (Tahap 1 + Tahap 4 ringkas).
 * Bisa dibuka di https://admin.keluhkampus.my.id (subdomain dipetakan ke sini oleh proxy) atau /superadmin.
 * Hanya super admin (isSuperAdmin); akun lain mendapat 404 agar halaman ini tidak terlihat ada.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/server/auth";
import { loadSuperAdminStats } from "@/lib/server/superadmin-stats";
import { loadAiCostOverview } from "@/lib/server/ai-cost";
import AiCostPanel from "@/components/superadmin/AiCostPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Super Admin", robots: { index: false, follow: false } };

const fmt = (value: number) => value.toLocaleString("id-ID");

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{typeof value === "number" ? fmt(value) : value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-lg font-black text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{head.map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, i) => <tr key={i} className="border-t border-slate-100">{row.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-700">{typeof cell === "number" ? fmt(cell) : cell}</td>)}</tr>)
            : <tr><td colSpan={head.length} className="px-3 py-4 text-center text-slate-400">Belum ada data.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export default async function SuperAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/");
  if (!isSuperAdmin(user)) notFound();
  const [s, aiCost] = await Promise.all([loadSuperAdminStats(), loadAiCostOverview()]);
  const maxSignup = Math.max(1, ...s.signupsByDay.map((day) => day.count));

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 text-slate-800">
      <div className="rounded-3xl bg-slate-950 p-8 text-white">
        <p className="text-sm font-bold text-blue-300">Super Admin</p>
        <h1 className="mt-1 text-3xl font-black">Panel sistem keluhkampus</h1>
        <p className="mt-2 text-sm text-slate-300">Masuk sebagai {user.email} (ID akun: <code className="text-white">{user.id}</code>). Data dihitung saat halaman dibuka (WIB).</p>
        <div className="mt-5 flex flex-wrap gap-2 text-sm font-bold">
          <Link href="/tugas/admin694" className="rounded-xl bg-white px-4 py-2 text-slate-900">Kelola Tugas</Link>
          <Link href="/tugas/admin694/users" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Daftar akun & reset sandi</Link>
          <a href="/api/admin/db-health" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Cek database</a>
          <a href="/api/admin/ai-check" className="rounded-xl bg-white/10 px-4 py-2 hover:bg-white/20">Cek layanan AI</a>
        </div>
      </div>

      {s.missing.length > 0 && (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sebagian data belum bisa dibaca ({s.missing.join(", ")}). Jalankan file SQL hotfix terbaru di phpPgAdmin.
        </p>
      )}

      <Section title="Pengguna">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Total akun" value={s.users.total} hint={`+${fmt(s.users.new7d)} dalam 7 hari`} />
          <Card label="Online sekarang" value={s.presence.online} hint="aktif 5 menit terakhir" />
          <Card label="Aktif hari ini" value={s.presence.today} hint={`7 hari: ${fmt(s.presence.week)} · 30 hari: ${fmt(s.presence.month)}`} />
          <Card label="Login" value={s.logins.today} hint={`hari ini · 7 hari: ${fmt(s.logins.week)}`} />
        </div>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Pendaftaran 14 hari terakhir</p>
          <div className="mt-3 flex h-28 items-end gap-1.5">
            {s.signupsByDay.map((day) => (
              <div key={day.day} className="flex flex-1 flex-col items-center gap-1" title={`${day.day}: ${day.count}`}>
                <span className="text-[10px] text-slate-500">{day.count || ""}</span>
                <div className="w-full rounded-t bg-blue-500" style={{ height: `${Math.max(2, (day.count / maxSignup) * 80)}px` }} />
                <span className="text-[10px] text-slate-400">{day.day.slice(8)}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Kunjungan">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Halaman dibuka hari ini" value={s.visits.today} />
          <Card label="Pengunjung unik hari ini" value={s.visits.uniqueToday} hint="termasuk tamu" />
          <Card label="Halaman dibuka 7 hari" value={s.visits.week} />
          <Card label="Pengunjung unik 7 hari" value={s.visits.uniqueWeek} />
        </div>
        <div className="mt-4"><Table head={["Fitur (7 hari)", "Dibuka", "Pengunjung unik"]} rows={s.visits.byFeature.map((row) => [row.feature, row.views, row.visitors])} /></div>
      </Section>

      <Section title="Pemakaian AI">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Panggilan AI hari ini" value={s.ai.callsToday} />
          <Card label="Token hari ini" value={s.ai.tokensToday} hint="input + output" />
          <Card label="Token 7 hari" value={s.ai.tokensWeek} />
          <Card label="Token aktual dari provider" value={`${s.ai.actualShare}%`} hint="sisanya perkiraan" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Table head={["Model (7 hari)", "Panggilan", "Input", "Output", "Gagal"]} rows={s.ai.byModel.map((row) => [row.model, row.calls, row.input, row.output, row.failed])} />
          <Table head={["Fitur/operasi (7 hari)", "Panggilan", "Token"]} rows={s.ai.byOperation.map((row) => [row.operation, row.calls, row.tokens])} />
        </div>
        <div className="mt-4"><Table head={["Pengguna AI terbanyak (7 hari)", "Panggilan", "Token"]} rows={s.ai.topUsers.map((row) => [row.email, row.calls, row.tokens])} /></div>
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
