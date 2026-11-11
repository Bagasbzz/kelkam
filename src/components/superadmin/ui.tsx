/** Komponen tampilan panel super admin (server component, tanpa state). */
import type { ReactNode } from "react";

export const fmt = (value: number) => Math.round(value).toLocaleString("id-ID");
export const rp = (value: number) => `Rp${fmt(value)}`;

export function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{typeof value === "number" ? fmt(value) : value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Table({ head, rows, empty = "Belum ada data." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody>
          {rows.length ? rows.map((row, i) => <tr key={i} className="border-t border-slate-100">{row.map((cell, j) => <td key={j} className="px-3 py-2 text-slate-700">{typeof cell === "number" ? fmt(cell) : cell}</td>)}</tr>)
            : <tr><td colSpan={head.length} className="px-3 py-4 text-center text-slate-400">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Grafik batang harian sederhana (CSS), label tanggal tiap beberapa hari. */
export function BarChart({ title, data, color = "bg-blue-500", format = fmt, height = 96 }: {
  title: string; data: Array<{ day: string; value: number }>; color?: string; format?: (value: number) => string; height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const step = Math.max(1, Math.ceil(data.length / 10));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
        <p className="text-xs text-slate-500">total {format(total)}</p>
      </div>
      <div className="mt-3 flex items-end gap-[3px]" style={{ height }}>
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${format(d.value)}`}>
            <div className={`w-full rounded-t ${color}`} style={{ height: `${d.value ? Math.max(3, (d.value / max) * 100) : 1}%`, opacity: d.value ? 1 : 0.25 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px]">
        {data.map((d, i) => <span key={d.day} className="flex-1 text-center text-[9px] text-slate-400">{i % step === 0 || i === data.length - 1 ? d.day.slice(8) : ""}</span>)}
      </div>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{children}</p>;
}
