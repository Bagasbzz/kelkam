"use client";

/**
 * src/components/ui/GuidedTour.tsx
 * -----------------------------------------------------------------------------
 * Panduan interaktif (onboarding tour): menyorot satu bagian layar, menggelapkan sisanya,
 * dan menjelaskan fungsinya. Tombol Kembali / Lanjut / Lewati, tombol panah keyboard, Esc.
 * Muncul sendiri pada kunjungan pertama (localStorage), lewat ?panduan=1, atau tombol "Cara pakai?".
 * Target dicari lewat atribut data-tour; bila tidak terlihat, kartu tampil di tengah.
 */
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { registerTour } from "@/lib/client/tour-registry";

export interface TourStep { target?: string; title: string; text: string }

function visibleTarget(name?: string): HTMLElement | null {
  if (!name) return null;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

export default function GuidedTour({ id, steps, label = "Cara pakai?" }: { id: string; steps: TourStep[]; label?: string }) {
  const storageKey = `tour-done:${id}`;
  const [index, setIndex] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const finish = useCallback(() => {
    setIndex(null);
    try { localStorage.setItem(storageKey, "1"); } catch { /* private mode */ }
  }, [storageKey]);

  // Start once on the first visit, or when asked with ?panduan=1.
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(storageKey) === "1"; } catch { seen = true; }
    const asked = new URLSearchParams(window.location.search).get("panduan") === "1";
    if (!asked && seen) return;
    const timer = window.setTimeout(() => setIndex(0), 700);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  // Track the highlighted element through scrolling, resizing and layout changes.
  useEffect(() => {
    if (index === null) return;
    const element = visibleTarget(steps[index]?.target);
    element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    let frame = 0;
    const update = () => setRect(visibleTarget(steps[index]?.target)?.getBoundingClientRect() ?? null);
    const tick = () => { update(); frame = window.requestAnimationFrame(tick); };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [index, steps]);

  // Tombol "Cara pakai?" ditampilkan Navbar (tidak melayang menutupi isi/tombol kirim di HP).
  useEffect(() => registerTour({ label, start: () => setIndex(0) }), [label]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight") setIndex((value) => (value === null ? value : value + 1 >= steps.length ? (finish(), null) : value + 1));
      else if (event.key === "ArrowLeft") setIndex((value) => (value ? value - 1 : value));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, steps.length, finish]);

  if (index === null) return null;

  const step = steps[index];
  const pad = 8;
  const hole = rect ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 } : null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cardW = Math.min(360, vw - 24);
  let style: React.CSSProperties = { left: (vw - cardW) / 2, top: Math.max(24, vh / 2 - 120) };
  if (hole) {
    const below = hole.y + hole.h + 12;
    const top = below + 200 < vh ? below : Math.max(12, hole.y - 212);
    style = { left: Math.min(Math.max(12, hole.x), vw - cardW - 12), top };
  }
  const last = index === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {hole ? (
        <div className="pointer-events-none absolute rounded-xl ring-2 ring-blue-400 transition-all duration-200" style={{ left: hole.x, top: hole.y, width: hole.w, height: hole.h, boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)" }} />
      ) : (
        <div className="absolute inset-0 bg-slate-900/60" />
      )}
      <div className="absolute rounded-2xl bg-white p-5 text-slate-800 shadow-2xl" style={{ ...style, width: cardW }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wide text-blue-600">Langkah {index + 1} dari {steps.length}</p>
          <button type="button" onClick={finish} aria-label="Tutup panduan" className="-m-2 rounded-full p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="tour-title" className="mt-1 text-lg font-black text-slate-900">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={finish} className="py-2 text-sm font-semibold text-slate-500 hover:text-slate-800">Lewati</button>
          <div className="ml-auto flex gap-2">
            {index > 0 && <button type="button" onClick={() => setIndex(index - 1)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Kembali</button>}
            <button type="button" onClick={() => (last ? finish() : setIndex(index + 1))} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">{last ? "Selesai" : "Lanjut"}</button>
          </div>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {steps.map((_, i) => <span key={i} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-blue-600" : "bg-slate-200"}`} />)}
        </div>
      </div>
    </div>
  );
}
