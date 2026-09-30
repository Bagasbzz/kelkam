"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CalendarClock, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import CountdownTimer from "@/components/tugas/CountdownTimer";
import SubmissionForm from "@/components/tugas/SubmissionForm";
import {
  fetchCourseByToken,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/[tugasId] — detail satu tugas + form kumpulkan / ubah.
 * Riwayat seluruh mata kuliah ada di halaman mata kuliah, bukan di sini.
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
        if (!t) setError("Tugas ini tidak ada di mata kuliah tersebut.");
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
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !course || !tugas) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Tugas tidak ditemukan</h1>
          {error && <p className="text-sm text-slate-600">{error}</p>}
          <Link
            href={`/tugas/${token}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke mata kuliah
          </Link>
        </div>
      </div>
    );
  }

  const deadlinePassed = new Date(tugas.deadline).getTime() < Date.now();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href={`/tugas/${token}`}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {course.name}
        </Link>

        <Card>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{course.code}</span>
            {tugas.class && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                Kelas {tugas.class.name}
              </span>
            )}
          </div>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">{tugas.title}</h1>
          {tugas.description && (
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700 md:text-base">
              {tugas.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-700">
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-slate-500" />
              Batas waktu{" "}
              {new Date(tugas.deadline).toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {deadlinePassed ? (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Sudah lewat
              </span>
            ) : (
              <CountdownTimer deadline={tugas.deadline} />
            )}
          </div>
        </Card>

        <SubmissionForm
          tugasId={tugas.id}
          deadline={tugas.deadline}
          classes={course.classes}
          lockedClassId={tugas.classId}
        />
      </div>
    </div>
  );
}
