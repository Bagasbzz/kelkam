"use client";

/**
 * ReportJobProgress — panel progres detail ala "sedang dikerjakan":
 *  - progress bar + stage + ETA kasar
 *  - daftar BAB dengan status, durasi, kata, percobaan
 *  - log event server (apa yang sedang dilakukan AI)
 *  - deteksi macet (heartbeat) → tombol Lanjutkan; gagal → Coba lagi
 */

import { useEffect, useMemo, useState } from "react";
import type { ReportJob, ReportJobStep } from "@/lib/client/report-job";

interface Props {
  job: ReportJob | null;
  /** true saat client sedang polling */
  polling: boolean;
  onResume?: () => void;
  onRetry?: (redoFallback: boolean) => void;
  onCancel?: () => void;
  onDiscard?: () => void;
  compact?: boolean;
}

const STEP_DOT: Record<ReportJobStep["status"], string> = {
  queued: "bg-slate-300",
  running: "bg-blue-500 animate-pulse",
  done: "bg-emerald-500",
  fallback: "bg-amber-500",
  failed: "bg-red-500",
};

const STEP_LABEL: Record<ReportJobStep["status"], string> = {
  queued: "menunggu",
  running: "sedang ditulis",
  done: "selesai",
  fallback: "placeholder",
  failed: "gagal",
};

function seconds(a?: string, b?: string, nowMs?: number) {
  if (!a) return null;
  const end = b ? new Date(b).getTime() : (nowMs ?? new Date(a).getTime());
  return Math.max(0, Math.round((end - new Date(a).getTime()) / 1000));
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return ""; }
}

export default function ReportJobProgress({ job, polling, onResume, onRetry, onCancel, onDiscard, compact }: Props) {
  // Jam klien yang di-update tiap detik; dipakai untuk durasi langkah yang masih berjalan.
  const [nowMs, setNowMs] = useState(0);
  // Selisih jam klien vs server agar durasi langkah tidak salah saat jam PC melenceng.
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed" || job.status === "cancelled") return;
    const serverNow = job.serverNow ? new Date(job.serverNow).getTime() : NaN;
    const sync = () => {
      const t = Date.now();
      setNowMs(t);
      if (Number.isFinite(serverNow)) setClockOffsetMs(t - serverNow);
    };
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [job]);

  const eta = useMemo(() => {
    if (!job) return null;
    const finished = job.steps.filter((s) => (s.status === "done" || s.status === "fallback") && s.startedAt && s.finishedAt);
    if (!finished.length) return null;
    const avg = finished.reduce((acc, s) => acc + (seconds(s.startedAt, s.finishedAt) || 0), 0) / finished.length;
    const remaining = job.totalSteps - job.doneSteps;
    return Math.round(avg * remaining);
  }, [job]);

  if (!job) return null;

  const active = job.status === "queued" || job.status === "running";
  const idle = Math.max(job.idleSeconds, 0);
  // Macet: server tidak menyentuh job > 75s padahal belum selesai.
  const stuck = active && !polling && idle > 75;
  const stalled = active && polling && idle > 100;
  const hasFallback = job.steps.some((s) => s.status === "fallback");
  const runningStep = job.steps.find((s) => s.status === "running");

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-slate-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-black text-blue-800">
        <span className="flex items-center gap-2">
          {active && <span className="inline-block h-2 w-2 animate-ping rounded-full bg-blue-500" />}
          {job.stage}
        </span>
        <span>
          {job.doneSteps}/{job.totalSteps} bagian · {job.progress}%
          {eta != null && active ? ` · ±${eta >= 60 ? `${Math.ceil(eta / 60)} mnt` : `${eta} dtk`} lagi` : ""}
        </span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-white">
        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 transition-all duration-700" style={{ width: `${job.progress}%` }} />
      </div>

      {runningStep && active && (
        <p className="mt-2 text-[11px] text-blue-700">
          Sedang menulis <b>{runningStep.title}</b> — {seconds(runningStep.startedAt, undefined, nowMs ? nowMs - clockOffsetMs : undefined) ?? 0} dtk
          {runningStep.attempts > 1 ? ` (percobaan ${runningStep.attempts})` : ""}. Satu bagian biasanya 15-60 dtk.
        </p>
      )}

      {(stuck || stalled) && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <b>Proses tidak bergerak {idle} dtk.</b> {stuck
            ? "Koneksi/polling terputus. Klik Lanjutkan — pekerjaan diteruskan dari bagian terakhir, bukan dari awal."
            : "Server mungkin lambat. Kalau terus diam >2 menit, refresh halaman lalu klik Lanjutkan."}
        </div>
      )}

      {job.status === "failed" && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <b>Gagal:</b> {job.error || "tidak diketahui"}. Bagian yang sudah selesai tetap tersimpan.
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">Job dibatalkan.</div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {(stuck || job.needsResume) && active && onResume && (
          <button type="button" onClick={onResume} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Lanjutkan dari bagian terakhir</button>
        )}
        {(job.status === "failed" || job.status === "cancelled") && onRetry && (
          <button type="button" onClick={() => onRetry(false)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Coba lagi (lanjut dari yang gagal)</button>
        )}
        {job.status === "done" && hasFallback && onRetry && (
          <button type="button" onClick={() => onRetry(true)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold text-amber-700">Tulis ulang bagian placeholder</button>
        )}
        {active && onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Batalkan</button>
        )}
        {!active && onDiscard && (
          <button type="button" onClick={onDiscard} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">Tutup</button>
        )}
      </div>

      {!compact && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg bg-white p-3">
            <div className="mb-2 text-[10px] font-black uppercase text-slate-400">Bagian laporan</div>
            <ul className="space-y-1.5">
              {job.steps.map((step) => {
                const dur = seconds(step.startedAt, step.finishedAt);
                return (
                  <li key={step.index} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${STEP_DOT[step.status]}`} />
                    <span className="flex-1">
                      <span className={step.status === "running" ? "font-bold text-blue-700" : "text-slate-700"}>{step.title}</span>
                      <span className="ml-1 text-[10px] text-slate-400">
                        {STEP_LABEL[step.status]}
                        {step.words ? ` · ${step.words} kata` : ""}
                        {dur != null && step.status !== "queued" ? ` · ${dur} dtk` : ""}
                        {step.attempts > 1 ? ` · ${step.attempts}x` : ""}
                      </span>
                      {step.error && step.status !== "done" && <span className="block text-[10px] text-red-500">{step.error}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-slate-200">
            <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase text-slate-400">
              <span>Log proses</span>
            </div>
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {job.log.length === 0 && <div className="text-slate-500">Menunggu event...</div>}
              {[...job.log].reverse().map((event, i) => (
                <div key={`${event.t}-${i}`} className={event.level === "error" ? "text-red-300" : event.level === "warn" ? "text-amber-300" : ""}>
                  <span className="text-slate-500">{fmtTime(event.t)}</span> {event.msg}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
