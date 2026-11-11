"use client";
/**
 * Panel "Batas biaya AI (rupiah)" di /superadmin. Data awal dari server, simpan lewat PUT /api/admin/ai-cost.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatedFetch } from "@/components/AuthProvider";

type Period = "day" | "week" | "month";
type Limits = Record<Period, number | null>;
interface Price { input: number; output: number }
export interface AiCostOverviewProps {
  config: { enabled: boolean; usdToIdr: number; global: Limits; perUser: Limits; prices: Record<string, Price>; defaultPrice: Price; imagePriceUsd: number };
  stored: boolean;
  tableMissing: boolean;
  usageMissing: boolean;
  spend: Record<Period, number>;
  users: Array<{ ownerId: string; email: string; calls: number; rupiah: number }>;
  models: Array<{ model: string; kind: string; calls: number }>;
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "day", label: "Harian" },
  { key: "week", label: "Mingguan (Senin)" },
  { key: "month", label: "Bulanan (tgl 1)" },
];
const rp = (value: number) => `Rp${Math.round(value).toLocaleString("id-ID")}`;
const toText = (value: number | null) => (value === null ? "" : String(value));
/** Rupiah: titik/koma = pemisah ribuan ("50.000" → 50000). */
const toRupiah = (value: string) => {
  const n = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** Harga USD: koma diterima sebagai desimal ("0,5" → 0.5). */
const toNumber = (value: string) => {
  const n = Number(value.replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function AiCostPanel({ initial }: { initial: AiCostOverviewProps }) {
  const router = useRouter();
  const { config } = initial;
  const [enabled, setEnabled] = useState(config.enabled);
  const [rate, setRate] = useState(String(config.usdToIdr));
  const [globalLimits, setGlobalLimits] = useState(() => Object.fromEntries(PERIODS.map((p) => [p.key, toText(config.global[p.key])])) as Record<Period, string>);
  const [userLimits, setUserLimits] = useState(() => Object.fromEntries(PERIODS.map((p) => [p.key, toText(config.perUser[p.key])])) as Record<Period, string>);
  const modelNames = useMemo(() => Array.from(new Set([...Object.keys(config.prices), ...initial.models.filter((m) => m.kind !== "image").map((m) => m.model)])), [config.prices, initial.models]);
  const [prices, setPrices] = useState(() => Object.fromEntries(modelNames.map((name) => [name, { input: String(config.prices[name]?.input ?? ""), output: String(config.prices[name]?.output ?? "") }])) as Record<string, { input: string; output: string }>);
  const [defaultPrice, setDefaultPrice] = useState({ input: String(config.defaultPrice.input), output: String(config.defaultPrice.output) });
  const [imagePrice, setImagePrice] = useState(String(config.imagePriceUsd));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true); setMessage(null);
    const limits = (values: Record<Period, string>) => Object.fromEntries(PERIODS.map((p) => [p.key, toRupiah(values[p.key])]));
    const body = {
      enabled,
      usdToIdr: toRupiah(rate),
      global: limits(globalLimits),
      perUser: limits(userLimits),
      // Model tanpa harga diisi tidak disimpan → memakai harga bawaan.
      prices: Object.fromEntries(Object.entries(prices).filter(([, p]) => toNumber(p.input) && toNumber(p.output)).map(([name, p]) => [name, { input: toNumber(p.input), output: toNumber(p.output) }])),
      defaultPrice: { input: toNumber(defaultPrice.input), output: toNumber(defaultPrice.output) },
      imagePriceUsd: toNumber(imagePrice),
    };
    try {
      const res = await authenticatedFetch("/api/admin/ai-cost", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; message?: string } | null;
      if (!res.ok || !data?.success) throw new Error(data?.error || `Gagal menyimpan (${res.status}).`);
      setMessage({ ok: true, text: data.message || "Tersimpan." });
      router.refresh();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : "Gagal menyimpan." });
    } finally { setBusy(false); }
  };

  const input = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none";
  const monthUserLimit = toRupiah(userLimits.month);

  return (
    <div className="space-y-4">
      {initial.tableMissing && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Tabel pengaturan belum ada. Jalankan <code>database-hotfix-2026-11-11-app-settings.sql</code> di phpPgAdmin agar batas bisa disimpan.
        </p>
      )}
      {initial.usageMissing && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Data pemakaian AI belum bisa dibaca. Jalankan <code>database-hotfix-2026-11-10-analytics.sql</code>; tanpa itu biaya tidak terhitung dan batas tidak bekerja.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {PERIODS.map((p) => {
          const limit = config.enabled ? config.global[p.key] : null;
          const pct = limit ? Math.min(100, Math.round((initial.spend[p.key] / limit) * 100)) : 0;
          return (
            <div key={p.key} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Terpakai {p.key === "day" ? "hari ini" : p.key === "week" ? "minggu ini" : "bulan ini"}</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{rp(initial.spend[p.key])}</p>
              <p className="mt-0.5 text-xs text-slate-500">{limit ? `dari batas global ${rp(limit)} (${pct}%)` : "tanpa batas global"}</p>
              {limit ? <div className="mt-2 h-1.5 rounded bg-slate-100"><div className={`h-1.5 rounded ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div> : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <label className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4" />
          Batas biaya aktif
        </label>
        <p className="mt-1 text-xs text-slate-500">Kosongkan kolom batas = tanpa batas untuk periode itu. Super admin tidak kena batas per pengguna. Periode dihitung WIB.</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="py-2 pr-3">Batas (Rp)</th>{PERIODS.map((p) => <th key={p.key} className="py-2 pr-3">{p.label}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-2 pr-3 font-semibold">Seluruh situs</td>
                {PERIODS.map((p) => <td key={p.key} className="py-2 pr-3"><input inputMode="numeric" placeholder="tanpa batas" className={input} value={globalLimits[p.key]} onChange={(e) => setGlobalLimits({ ...globalLimits, [p.key]: e.target.value })} /></td>)}
              </tr>
              <tr>
                <td className="py-2 pr-3 font-semibold">Per pengguna</td>
                {PERIODS.map((p) => <td key={p.key} className="py-2 pr-3"><input inputMode="numeric" placeholder="tanpa batas" className={input} value={userLimits[p.key]} onChange={(e) => setUserLimits({ ...userLimits, [p.key]: e.target.value })} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm"><span className="font-semibold">Kurs (Rp per 1 USD kredit)</span><input inputMode="decimal" className={`${input} mt-1`} value={rate} onChange={(e) => setRate(e.target.value)} /></label>
          <label className="text-sm"><span className="font-semibold">Harga gambar (USD per gambar)</span><input inputMode="decimal" className={`${input} mt-1`} value={imagePrice} onChange={(e) => setImagePrice(e.target.value)} /></label>
        </div>

        <h3 className="mt-5 text-sm font-bold text-slate-900">Harga model (USD per 1 juta token)</h3>
        <p className="text-xs text-slate-500">Isi sesuai daftar harga di Mindaku. Model yang kosong memakai harga bawaan.</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2 pr-3">Model</th><th className="py-2 pr-3">Input</th><th className="py-2 pr-3">Output</th><th className="py-2 pr-3">Dipakai 30 hari</th></tr></thead>
            <tbody>
              {modelNames.map((name) => (
                <tr key={name} className="border-t border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{name}</td>
                  <td className="py-2 pr-3"><input inputMode="decimal" placeholder={String(defaultPrice.input)} className={input} value={prices[name]?.input ?? ""} onChange={(e) => setPrices({ ...prices, [name]: { ...prices[name], input: e.target.value } })} /></td>
                  <td className="py-2 pr-3"><input inputMode="decimal" placeholder={String(defaultPrice.output)} className={input} value={prices[name]?.output ?? ""} onChange={(e) => setPrices({ ...prices, [name]: { ...prices[name], output: e.target.value } })} /></td>
                  <td className="py-2 pr-3 text-slate-500">{(initial.models.find((m) => m.model === name)?.calls ?? 0).toLocaleString("id-ID")} panggilan</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200">
                <td className="py-2 pr-3 font-semibold">Bawaan (model lain)</td>
                <td className="py-2 pr-3"><input inputMode="decimal" className={input} value={defaultPrice.input} onChange={(e) => setDefaultPrice({ ...defaultPrice, input: e.target.value })} /></td>
                <td className="py-2 pr-3"><input inputMode="decimal" className={input} value={defaultPrice.output} onChange={(e) => setDefaultPrice({ ...defaultPrice, output: e.target.value })} /></td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={busy} className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? "Menyimpan..." : "Simpan batas biaya"}</button>
          {message && <span className={`text-sm ${message.ok ? "text-emerald-700" : "text-red-600"}`}>{message.text}</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Pengguna (bulan ini)</th><th className="px-3 py-2">Panggilan</th><th className="px-3 py-2">Biaya</th><th className="px-3 py-2">Dari batas bulanan</th></tr></thead>
          <tbody>
            {initial.users.length ? initial.users.map((u) => (
              <tr key={u.ownerId} className="border-t border-slate-100">
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.calls.toLocaleString("id-ID")}</td>
                <td className="px-3 py-2 font-semibold">{rp(u.rupiah)}</td>
                <td className="px-3 py-2 text-slate-500">{monthUserLimit ? `${Math.round((u.rupiah / monthUserLimit) * 100)}%` : "-"}</td>
              </tr>
            )) : <tr><td colSpan={4} className="px-3 py-4 text-center text-slate-400">Belum ada data.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Biaya dihitung dari token yang dicatat sistem x harga model x kurs, jadi perkiraan dekat dengan tagihan Mindaku, bukan angka tagihan resmi. Batas dicek sebelum tiap panggilan AI; proses yang sedang berjalan bisa sedikit melewati batas.</p>
    </div>
  );
}
