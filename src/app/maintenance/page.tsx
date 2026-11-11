/**
 * /maintenance — ditampilkan proxy (rewrite) ke semua pengunjung selama mode maintenance aktif.
 * Super admin tidak diarahkan ke sini dan tetap bisa memakai situs.
 */
import Link from "next/link";
import { loadMaintenance, maintenanceText } from "@/lib/server/maintenance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sedang pemeliharaan", robots: { index: false, follow: false } };

export default async function MaintenancePage() {
  const state = await loadMaintenance();
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-2xl" aria-hidden>🛠️</div>
        <h1 className="text-2xl font-black text-slate-900">{state.enabled ? "Sedang pemeliharaan" : "Pemeliharaan selesai"}</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{state.enabled ? maintenanceText(state) : "Situs sudah bisa dipakai kembali. Silakan lanjutkan."}</p>
        {state.enabled && <p className="mt-3 text-xs text-slate-500">Pekerjaan Anda yang sedang diproses (laporan, presentasi, gambar) tidak hilang. Prosesnya dijeda dan dilanjutkan otomatis setelah pemeliharaan selesai.</p>}
        <Link href="/" className="mt-6 inline-flex rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">Coba muat ulang</Link>
      </div>
    </main>
  );
}
