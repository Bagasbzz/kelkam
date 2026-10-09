"use client";

/**
 * Panel progres live agent run: status, langkah, elapsed, daftar event terbaru,
 * tombol Jeda / Hentikan. Dipakai Asisten Laporan dan Asisten Dosen.
 */
import { useEffect, useState } from "react";
import { Loader2, Pause, Square, Wifi } from "lucide-react";
import { describeRunStatus, isRunLive, type AgentEvent, type AgentRunPublic } from "@/lib/client/agent-run";

interface Props {
  run: AgentRunPublic | null;
  events: AgentEvent[];
  startedAt: number;
  lastBeatAt: number;
  onPause?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}d` : `${Math.floor(s / 60)}m ${s % 60}d`;
}

export default function AgentRunProgress({ run, events, startedAt, lastBeatAt, onPause, onCancel, busy }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const live = !run || isRunLive(run.status);
  const stale = now - lastBeatAt > 20_000;
  const shown = events.slice(-6);
  const latest = shown[shown.length - 1];

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs text-slate-700">
      <div className="flex items-center gap-2">
        {live ? <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" /> : <Wifi className="h-3.5 w-3.5 text-slate-400" />}
        <span className="font-semibold text-slate-900">{describeRunStatus(run)}</span>
        <span className="text-slate-500">· {fmt(now - startedAt)}</span>
        {stale && live && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">menyambung ulang…</span>}
        <span className="ml-auto flex gap-1">
          {onPause && live && (
            <button type="button" onClick={onPause} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" title="Jeda — bisa dilanjutkan dengan mengetik 'lanjut'">
              <Pause className="h-3 w-3" /> Jeda
            </button>
          )}
          {onCancel && live && (
            <button type="button" onClick={onCancel} disabled={busy} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              <Square className="h-3 w-3" /> Hentikan
            </button>
          )}
        </span>
      </div>
      {latest && (
        <div className="mt-1 truncate font-medium text-blue-800" title={latest.text}>{latest.text}</div>
      )}
      {shown.length > 1 && (
        <ol className="mt-1 space-y-0.5 border-t border-blue-100 pt-1 text-[11px] text-slate-500">
          {shown.slice(0, -1).map((e, i) => (
            <li key={`${e.t}-${i}`} className={`truncate ${e.level === "error" ? "text-red-600" : e.level === "warn" ? "text-amber-700" : ""}`} title={e.text}>
              <span className="mr-1 tabular-nums text-slate-400">{new Date(e.t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              {e.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
