/**
 * /superadmin/pengguna/[id] — detail satu pengguna: aktivitas harian, fitur, pemakaian & biaya AI, login,
 * daftar laporan/presentasi (judul saja, tanpa isi percakapan), feedback. Super admin saja; dibuka tercatat di log audit.
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/server/auth";
import { recordAdminAction } from "@/lib/server/analytics";
import { loadUserDetail } from "@/lib/server/superadmin-analytics";
import { BarChart, Card, fmt, Notice, rp, Section, Table } from "@/components/superadmin/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Detail pengguna · Super Admin", robots: { index: false, follow: false } };

const STAGE: Record<string, string> = { intake: "Ngobrol", planned: "Rencana siap", executing: "Menulis", drafted: "Draft jadi" };

export default async function SuperAdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentUser();
  const { id } = await params;
  if (!admin) redirect(`/login?redirect=/superadmin/pengguna/${encodeURIComponent(id)}`);
  if (!isSuperAdmin(admin)) notFound();
  const d = await loadUserDetail(decodeURIComponent(id).slice(0, 100));
  if (!d) notFound();
  await recordAdminAction({ actorId: admin.id, action: "view-user", targetId: d.user.id, detail: d.user.email });
  const limit = d.costLimitMonth;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 text-slate-800">
      <Link href="/superadmin/pengguna" className="text-sm font-semibold text-blue-600 hover:underline">← Semua pengguna</Link>
      <h1 className="mt-2 text-3xl font-black text-slate-900">{d.user.email}</h1>
      <p className="mt-1 text-sm text-slate-500">{d.user.name ? `${d.user.name} · ` : ""}Role {d.user.role} · daftar {d.user.createdAt} WIB · ID <code>{d.user.id}</code></p>
      {d.missing.length > 0 && <Notice>Sebagian data belum bisa dibaca ({d.missing.join(", ")}). Jalankan SQL hotfix terbaru di phpPgAdmin.</Notice>}

      <Section title="Ringkasan">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card label="Terakhir aktif" value={d.lastSeen} hint="WIB" />
          <Card label="Hari aktif (30 hari)" value={d.activeDays30} hint={`${fmt(d.totals30.views)} halaman dibuka`} />
          <Card label="Panggilan AI (30 hari)" value={d.totals30.aiCalls} hint={`biaya ${rp(d.totals30.aiCost)}`} />
          <Card label="Biaya AI bulan ini" value={rp(d.costMonth)} hint={limit ? `batas per pengguna ${rp(limit)} (${Math.round((d.costMonth / limit) * 100)}%)` : "tanpa batas bulanan"} />
          <Card label="Laporan" value={d.laporan.length} hint={`${d.jobs.length} job penulisan terakhir`} />
          <Card label="Presentasi" value={d.presentasi.length} />
          <Card label="Gambar AI" value={d.images.done} hint={`${fmt(d.images.failed)} gagal`} />
          <Card label="Feedback" value={d.feedback.length} hint={`👍 ${d.feedback.filter((f) => f.rating > 0).length} · 👎 ${d.feedback.filter((f) => f.rating < 0).length}`} />
        </div>
      </Section>

      <Section title="Aktivitas 30 hari">
        <div className="grid gap-4 lg:grid-cols-3">
          <BarChart title="Halaman dibuka" data={d.daily.map((p) => ({ day: p.day, value: p.views }))} color="bg-blue-500" />
          <BarChart title="Panggilan AI" data={d.daily.map((p) => ({ day: p.day, value: p.aiCalls }))} color="bg-amber-500" />
          <BarChart title="Biaya AI" data={d.daily.map((p) => ({ day: p.day, value: p.aiCost }))} color="bg-red-500" format={rp} />
        </div>
      </Section>

      <Section title="Fitur yang dipakai (30 hari)">
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={["Fitur (halaman)", "Dibuka", "Terakhir"]} rows={d.features.map((f) => [f.feature, f.views, f.lastAt])} />
          <Table head={["Operasi AI", "Panggilan", "Token", "Biaya"]} rows={d.operations.map((o) => [o.operation, o.calls, o.tokens, rp(o.cost)])} />
        </div>
      </Section>

      <Section title="Laporan">
        <Table head={["Judul", "Tahap", "Diperbarui"]} rows={d.laporan.map((r) => [r.title, STAGE[r.stage] ?? r.stage, r.updatedAt])} />
        <div className="mt-4"><Table head={["Job penulisan", "Mode", "Status", "Dibuat"]} rows={d.jobs.map((j) => [j.title, j.mode, j.status, j.createdAt])} /></div>
      </Section>

      <Section title="Presentasi">
        <Table head={["Judul", "Slide", "Diperbarui"]} rows={d.presentasi.map((p) => [p.title, p.slides, p.updatedAt])} />
      </Section>

      <Section title="Login terakhir & feedback">
        <div className="grid gap-4 lg:grid-cols-2">
          <Table head={["Waktu login", "Cara"]} rows={d.logins.map((l) => [l.at, l.method])} />
          <Table head={["Waktu", "Fitur", "Nilai", "Komentar"]} rows={d.feedback.map((f) => [f.at, f.feature, f.rating > 0 ? "👍" : "👎", f.comment])} />
        </div>
      </Section>
    </main>
  );
}
