"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, MessageSquareText, XCircle } from "lucide-react";
import Card from "@/components/ui/Card";
import {
  fetchMyCourseHistory,
  type MyTugasWithSubmission,
  type TugasSummary,
} from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

interface Props {
  courseId: string;
  token: string;
}

function formatTanggal(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Riwayat pengumpulan mahasiswa di satu mata kuliah:
 * sudah dikumpulkan (dengan catatan dosen kalau ada), terlewat, dan belum dikumpulkan.
 * Hanya tampil kalau sudah masuk.
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
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, user]);

  if (!user) return null;

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-slate-500">Memuat riwayat…</p>
      </Card>
    );
  }

  if (submitted.length === 0 && missed.length === 0 && pending.length === 0) {
    return null;
  }

  return (
    <Card>
      <h2 className="text-lg font-bold text-slate-900">Riwayat pengumpulan kamu</h2>

      {submitted.length > 0 && (
        <Section title={`Sudah dikumpulkan (${submitted.length})`}>
          {submitted.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="block rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 transition hover:border-emerald-300"
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{t.title}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    {t.mySubmission && (
                      <>
                        <span>Dikumpulkan {formatTanggal(t.mySubmission.submittedAt)}</span>
                        <span>· Urutan ke-{t.mySubmission.position}</span>
                        {t.mySubmission.updatedAt && (
                          <span>· Diubah {formatTanggal(t.mySubmission.updatedAt)}</span>
                        )}
                        {t.mySubmission.status === "LATE" && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                            Terlambat
                          </span>
                        )}
                      </>
                    )}
                  </p>
                  {t.mySubmission?.feedback && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-white p-2 text-xs text-slate-700">
                      <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
                      <span className="line-clamp-2">
                        <span className="font-bold text-blue-700">Catatan dosen: </span>
                        {t.mySubmission.feedback}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </Section>
      )}

      {missed.length > 0 && (
        <Section title={`Tidak dikumpulkan (${missed.length})`}>
          {missed.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50/50 p-3 transition hover:border-red-300"
            >
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-700">{t.title}</p>
                <p className="mt-0.5 text-xs text-red-600">
                  Batas waktu {formatTanggal(t.deadline)} sudah lewat
                </p>
              </div>
            </Link>
          ))}
        </Section>
      )}

      {pending.length > 0 && (
        <Section title={`Belum dikumpulkan (${pending.length})`}>
          {pending.map((t) => (
            <Link
              key={t.id}
              href={`/tugas/${token}/${t.id}`}
              className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-blue-200"
            >
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900">{t.title}</p>
                <p className="mt-0.5 text-xs text-slate-500">Batas waktu {formatTanggal(t.deadline)}</p>
              </div>
            </Link>
          ))}
        </Section>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-sm font-medium text-slate-600">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
