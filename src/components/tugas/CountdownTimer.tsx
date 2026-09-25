"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface CountdownTimerProps {
  /** ISO string (UTC). */
  deadline: string;
  /** Optional className untuk wrapper. */
  className?: string;
}

interface Parts {
  totalMs: number;
  overdue: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function diff(deadlineMs: number): Parts {
  const totalMs = deadlineMs - Date.now();
  if (totalMs <= 0) {
    return { totalMs: 0, overdue: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  const days = Math.floor(totalMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((totalMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((totalMs % (60 * 60 * 1000)) / (60 * 1000));
  const seconds = Math.floor((totalMs % (60 * 1000)) / 1000);
  return { totalMs, overdue: false, days, hours, minutes, seconds };
}

/**
 * Countdown real-time (1s tick).
 *
 * Tone:
 *   - emerald: > 24 jam
 *   - amber:   <= 24 jam (dan > 1 jam)
 *   - red:     <= 1 jam ATAU overdue
 */
export default function CountdownTimer({ deadline, className = "" }: CountdownTimerProps) {
  const [parts, setParts] = useState<Parts | null>(null);

  useEffect(() => {
    const dl = new Date(deadline).getTime();
    if (Number.isNaN(dl)) {
      setParts(null);
      return;
    }
    setParts(diff(dl));
    const id = setInterval(() => setParts(diff(dl)), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (!parts) {
    return (
      <div className={`inline-flex items-center gap-2 text-slate-500 text-xs ${className}`}>
        <Clock className="w-4 h-4" />
        <span>—</span>
      </div>
    );
  }

  let tone = "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (parts.overdue || parts.totalMs < 60 * 60 * 1000) {
    tone = "bg-red-100 text-red-700 border-red-200";
  } else if (parts.totalMs < 24 * 60 * 60 * 1000) {
    tone = "bg-amber-100 text-amber-700 border-amber-200";
  }

  const label = parts.overdue
    ? "Sudah lewat deadline"
    : `${parts.days} hari ${parts.hours} jam ${parts.minutes} menit ${parts.seconds} detik`;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${tone} ${className}`}
      aria-label={label}
    >
      <Clock className="w-4 h-4" />
      <span>{label}</span>
    </div>
  );
}