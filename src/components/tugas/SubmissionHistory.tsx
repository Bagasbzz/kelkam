"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  XCircle,
} from "lucide-react";
import {
  fetchMyCourseHistory,
  type MyTugasWithSubmission,
  type TugasSummary,
} from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

interface Props {
  courseId: string;
  /** Token course untuk link ke detail tugas. */
  token: string;
}

/**
 * Sidebar ringkas: history submit + tugases yang belum/telat dikumpulkan.
 *
 * Auth-aware: cuma render kalau user login.
 */
export default function SubmissionHistory({ courseId, token }: Props) {
  const { user } = useAuth();
  const [submitted, setSubmitted] = useState<MyTugasWithSubmission[]>([]);
  const [missed, setMissed] = useState<TugasSummary[]>([]);
  const [pending, setPending] = useState<TugasSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    fetchMyCourseHistory(courseId)
      .then((d) => {
        if (cancelled) return;
        setSubmitted(d.submitted);
        setMissed(d.missed);
        setPending(d.pending);
      })
      .catch(() => !cancelled && null)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [courseId, user]);

  if (!user) return null;

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Memuat history…
      </div>
    );
  }

  if (submitted.length === 0 && missed.length === 0 && pending.length === 0) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-sm font-black uppercase tracking-widest text-slate-500">
        History course ini
      </h3>

      {submitted.length > 0 && (
        <Section title={`Sudah dikumpulkan (${submitted.length})`}>
          {submitted.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="flex items-start gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 transition hover:border-emerald-300"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t.mySubmission && new Date(t.mySubmission.submittedAt).toLocaleDateString("id-ID")}
                  {t.mySubmission?.status === "LATE" && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-700">
                      Telat
                    </span>
                  )}
                </p>
              </div>
            </Link>
          ))}
        </Section>
      )}

      {missed.length > 0 && (
        <Section title={`Terlewat (${missed.length})`}>
          {missed.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/50 p-3 transition hover:border-red-300"
            >
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-700 line-through">
                  {t.title}
                </p>
                <p className="mt-0.5 text-xs text-red-600">
                  Lewat {new Date(t.deadline).toLocaleDateString("id-ID")}
                </p>
              </div>
            </Link>
          ))}
        </Section>
      )}

      {pending.length > 0 && (
        <Section title={`Akan datang (${pending.length})`}>
          {pending.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-200"
            >
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tenggat {new Date(t.deadline).toLocaleDateString("id-ID")}
                </p>
              </div>
            </Link>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}