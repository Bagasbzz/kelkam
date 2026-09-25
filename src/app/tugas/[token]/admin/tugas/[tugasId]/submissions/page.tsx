"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  ClipboardList,
  Loader2,
} from "lucide-react";
import Card from "@/components/ui/Card";
import AdminSubmissionList from "@/components/tugas/AdminSubmissionList";
import CountdownTimer from "@/components/tugas/CountdownTimer";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchAdminSubmissions,
  fetchCourseByToken,
  type CourseSummary,
  type SubmissionRow,
  type TugasSummary,
} from "@/lib/client/tugas-api";

export default function AdminSubmissionsPage() {
  const params = useParams<{ token: string; tugasId: string }>();
  const token = (params?.token || "").toUpperCase();
  const tugasId = params?.tugasId || "";
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [tugas, setTugas] = useState<TugasSummary | null>(null);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== "ADMIN") return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCourseByToken(token), fetchAdminSubmissions(tugasId)])
      .then(([courseData, subData]) => {
        if (cancelled) return;
        setCourse(courseData.course);
        const t = courseData.tugases.find((x) => x.id === tugasId) ?? null;
        setTugas(t);
        setSubmissions(subData.submissions);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat submission.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, token, tugasId]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Login dulu</h1>
          <div className="pt-2">
            <button
              onClick={openLoginModal}
              className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-bold text-white"
            >
              Masuk
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Akses ditolak</h1>
          <p className="text-sm text-slate-600">Hanya admin yang boleh lihat submission.</p>
        </div>
      </div>
    );
  }

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
          <h1 className="text-2xl font-black text-slate-900">{error ?? "Tugas tidak ditemukan"}</h1>
          <Link
            href={`/tugas/${token}/admin`}
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
          href={`/tugas/${token}/admin`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          {course.name}
        </Link>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-10 md:py-12">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ClipboardList className="w-4 h-4" />
            Submission • {course.code}
          </div>
          <h1 className="mt-3 text-2xl font-black tracking-tight md:text-4xl">
            {tugas.title}
          </h1>
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

        <Card>
          <h2 className="text-lg font-black text-slate-900">Daftar Submission</h2>
          <p className="mt-1 text-sm text-slate-600">
            {submissions.length} submission, urut dari yang pertama kali ngumpul.
          </p>
          <div className="mt-5">
            <AdminSubmissionList submissions={submissions} />
          </div>
        </Card>
      </div>
    </div>
  );
}