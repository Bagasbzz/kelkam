/**
 * src/components/tools/ToolPanelShell.tsx
 * -----------------------------------------------------------------------------
 * Layout shell untuk semua tool di /tools (PDF / DOCX / Image).
 *
 * Pattern: sidebar list (TOOLS array) + content area (form + run button).
 * Sidebar di-mobile collapse ke top tabs (lihat parent /tools/page.tsx).
 *
 * Props dikontrol oleh caller — shell cuma render + kasih state.
 * Untuk Tabs umbrella antar-kategori (PDF/DOCX/Image), lihat Tabs.tsx.
 * -----------------------------------------------------------------------------
 */

"use client";

import { Loader2 } from "lucide-react";
import { type ReactNode } from "react";

export interface ToolDescriptor {
  id: string;
  label: string;
  description: string;
  multiple?: boolean;
}

interface ToolPanelShellProps {
  tools: ToolDescriptor[];
  active: string;
  onSelect: (id: string) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  filePicker?: ReactNode;
  runButton?: ReactNode;
  result?: ReactNode;
}

export function ToolPanelShell({
  tools,
  active,
  onSelect,
  title,
  subtitle,
  children,
  filePicker,
  runButton,
  result,
}: ToolPanelShellProps) {
  const current = tools.find((t) => t.id === active);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr]">
      <aside>
        <h2 className="mb-3 px-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          {title}
        </h2>
        <div className="flex flex-row gap-1 overflow-x-auto md:flex-col md:gap-0.5 md:overflow-visible">
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className={`whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-bold transition md:w-full ${
                active === t.id
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
              aria-current={active === t.id ? "true" : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {current && (
          <header className="mb-5">
            <h1 className="text-2xl font-bold text-slate-900">{current.label}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {subtitle ?? current.description}
            </p>
          </header>
        )}

        {filePicker}
        {children}

        {runButton && <div className="mt-6">{runButton}</div>}

        {result && <div className="mt-4">{result}</div>}
      </section>
    </div>
  );
}

interface RunButtonProps {
  busy: boolean;
  disabled: boolean;
  label?: string;
  onClick: () => void;
}

export function RunButton({ busy, disabled, label = "Proses", onClick }: RunButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-500/30 transition hover:bg-blue-700 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:active:scale-100 sm:w-auto"
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {busy ? "Memproses..." : label}
    </button>
  );
}

interface ResultBannerProps {
  tone?: "info" | "success" | "warn";
  children: ReactNode;
}

export function ResultBanner({ tone = "info", children }: ResultBannerProps) {
  const tones = {
    info: "bg-blue-50 text-blue-700",
    success: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
  } as const;
  return (
    <div className={`rounded-xl px-4 py-2 text-sm ${tones[tone]}`} role="status">
      {children}
    </div>
  );
}