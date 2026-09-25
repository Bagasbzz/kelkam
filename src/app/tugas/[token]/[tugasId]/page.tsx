"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  Loader2,
  Tag,
} from "lucide-react";
import Card from "@/components/ui/Card";
import CountdownTimer from "@/components/tugas/CountdownTimer";
import SubmissionForm from "@/components/tugas/SubmissionForm";
import {
  fetchCourseByToken,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/[tugasId] — Detail tugas + form submit.
 *
 * - Public: lihat detail (title, description, deadline, countdown).
 * - Login: form submit + lihat status sendiri.
 */
export default function TugasDetailPage() {
  const params = useParams<{ token: string; tugasId: string }>();
  const token = (params?.token || "").toUpperCase();
  const tugasId = params?.tugasId || "";

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [tugas, setTugas] = useState<TugasSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCourseByToken(token)
      .then((data) => {
        if (cancelled) return;
        setCourse(data.course);
        const t = data.tugases.find((x) => x.id === tugasId) ?? null;
        setTugas(t);
        if (!t) setError("Tugas tidak ditemukan di course ini.");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat tugas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, tugasId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !course || !tugas) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Tugas tidak ditemukan</h1>
          {error && <p className="text-sm text-slate-600">{error}</p>}
          <Link
            href={`/tugas/${token}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke course
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href={`/tugas/${token}`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          {course.name}
        </Link>

        {/* Hero detail */}
        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-10 md:py-12">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ClipboardList className="w-4 h-4" />
            {course.code}
            {tugas.class && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-bold text-slate-200">
                <Tag className="w-3 h-3" />
                Kelas {tugas.class.name}
              </span>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight md:text-4xl">
            {tugas.title}
          </h1>
          {tugas.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300 md:text-base">
              {tugas.description}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
              <CalendarClock className="w-4 h-4" />
              {new Date(tugas.deadline).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <CountdownTimer deadline={tugas.deadline} />
          </div>
        </div>

        {/* Submission form / status */}
        <SubmissionForm
          tugasId={tugas.id}
          classes={course.classes}
          lockedClassId={tugas.classId}
        />
      </div>
    </div>
  );
}