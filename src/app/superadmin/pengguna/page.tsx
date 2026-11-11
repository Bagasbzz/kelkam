/**
 * /superadmin/pengguna — daftar pengguna dengan aktivitas, pemakaian AI, dan biaya (super admin saja).
 */
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/server/auth";
import { loadUserList, USER_SORTS, type UserSort } from "@/lib/server/superadmin-analytics";
import { Notice, rp, Table } from "@/components/superadmin/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pengguna · Super Admin", robots: { index: false, follow: false } };

export default async function SuperAdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/superadmin/pengguna");
  if (!isSuperAdmin(user)) notFound();
  const params = await searchParams;
  const list = await loadUserList({ q: params.q, sort: params.sort as UserSort, page: Number(params.page) || 1 });
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const href = (patch: Record<string, string | number>) => {
    const query = new URLSearchParams({ ...(list.q ? { q: list.q } : {}), sort: list.sort, page: String(list.page), ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) });
    return `/superadmin/pengguna?${query.toString()}`;
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10 text-slate-800">
      <Link href="/superadmin" className="text-sm font-semibold text-blue-600 hover:underline">← Panel super admin</Link>
      <h1 className="mt-2 text-3xl font-black text-slate-900">Analitik per pengguna</h1>
      <p className="mt-1 text-sm text-slate-500">{list.total.toLocaleString("id-ID")} akun. Aktivitas dan pemakaian AI dihitung 30 hari terakhir, biaya untuk bulan berjalan (WIB). Klik email untuk detail.</p>

      <form className="mt-5 flex flex-wrap items-end gap-3" action="/superadmin/pengguna">
        <label className="text-sm"><span className="font-semibold">Cari email/nama</span><input name="q" defaultValue={list.q} className="mt-1 block w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        <label className="text-sm"><span className="font-semibold">Urutkan</span>
          <select name="sort" defaultValue={list.sort} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {Object.entries(USER_SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Terapkan</button>
      </form>

      {!list.full && <Notice>Data aktivitas belum lengkap (tabel analitik/ai_usage belum ada). Jalankan SQL hotfix analytics 2026-11-10 di phpPgAdmin.</Notice>}

      <div className="mt-5">
        <Table
          head={["Email", "Role", "Daftar", "Terakhir aktif", "Login 30h", "Halaman 30h", "AI 30h", "Laporan", "Presentasi", "Biaya bulan ini"]}
          rows={list.users.map((u) => [
            <Link key="e" href={`/superadmin/pengguna/${encodeURIComponent(u.id)}`} className="font-semibold text-blue-600 hover:underline">{u.email}</Link>,
            u.role, u.createdAt, u.lastSeen, u.logins30, u.views30, u.aiCalls30, u.laporan, u.presentasi, rp(u.costMonth),
          ])}
          empty="Tidak ada akun yang cocok."
        />
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        {list.page > 1 && <Link href={href({ page: list.page - 1 })} className="font-semibold text-blue-600 hover:underline">← Sebelumnya</Link>}
        <span className="text-slate-500">Halaman {list.page} dari {pages}</span>
        {list.page < pages && <Link href={href({ page: list.page + 1 })} className="font-semibold text-blue-600 hover:underline">Berikutnya →</Link>}
      </div>
    </main>
  );
}
