"use client";
/** Saklar mode maintenance di /superadmin. */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/components/AuthProvider";

export interface MaintenanceProps { enabled: boolean; message: string; until: string; startedAt: string | null }

export default function MaintenancePanel({ initial }: { initial: MaintenanceProps }) {
  const router = useRouter();
  const [message, setMessage] = useState(initial.message);
  const [until, setUntil] = useState(initial.until);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (enabled: boolean) => {
    if (enabled && !window.confirm("Aktifkan mode maintenance? Semua pengguna selain super admin akan melihat halaman pemeliharaan dan proses AI mereka dijeda.")) return;
    setBusy(true); setNotice(null);
    try {
      const res = await authenticatedFetch("/api/admin/maintenance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, message, until }) });
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; message?: string } | null;
      if (!res.ok || !data?.success) throw new Error(data?.error || `Gagal menyimpan (${res.status}).`);
      setNotice({ ok: true, text: data.message || "Tersimpan." });
      router.refresh();
    } catch (error) {
      setNotice({ ok: false, text: error instanceof Error ? error.message : "Gagal menyimpan." });
    } finally { setBusy(false); }
  };

  const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";
  return (
    <div className={`rounded-2xl border p-5 ${initial.enabled ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}>
      <p className="text-sm font-bold text-slate-900">
        Status: {initial.enabled ? <span className="text-red-700">AKTIF{initial.startedAt ? ` sejak ${new Date(initial.startedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : ""}</span> : <span className="text-emerald-700">mati (situs normal)</span>}
      </p>
      <p className="mt-1 text-xs text-slate-500">Saat aktif: halaman dan API ditutup untuk semua orang kecuali super admin; job laporan, presentasi, dan gambar dijeda lalu berlanjut otomatis setelah dimatikan. Halaman login tetap terbuka.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-2"><span className="font-semibold">Pesan untuk pengguna (opsional)</span><input className={input} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Contoh: Kami sedang memperbarui fitur Laporan." /></label>
        <label className="text-sm"><span className="font-semibold">Perkiraan selesai (opsional)</span><input className={input} maxLength={80} value={until} onChange={(e) => setUntil(e.target.value)} placeholder="pukul 22.00 WIB" /></label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {initial.enabled ? (
          <>
            <button type="button" disabled={busy} onClick={() => void save(false)} className="rounded-xl bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Matikan maintenance</button>
            <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Perbarui pesan</button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => void save(true)} className="rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">Aktifkan maintenance</button>
        )}
        <a href="/maintenance" target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:underline">Lihat halaman pemeliharaan</a>
        {notice && <span className={`text-sm ${notice.ok ? "text-emerald-700" : "text-red-600"}`}>{notice.text}</span>}
      </div>
    </div>
  );
}
