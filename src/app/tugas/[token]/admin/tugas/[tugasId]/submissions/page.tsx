"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Bot, CalendarClock, Loader2 } from "lucide-react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import AdminSubmissionList from "@/components/tugas/AdminSubmissionList";
import MissingSubmittersCard from "@/components/tugas/MissingSubmittersCard";
import CountdownTimer from "@/components/tugas/CountdownTimer";
import { useAuth } from "@/components/AuthProvider";
import {
  ApiClientError,
  fetchAdminSubmissions,
  fetchCourseByToken,
  type CourseSummary,
  type SubmissionRow,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * Daftar pengumpulan satu tugas (admin/asisten). Hak akses diputuskan oleh API,
 * supaya co-admin mata kuliah juga bisa masuk, bukan hanya admin global.
 */
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
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setForbidden(false);
    Promise.all([fetchCourseByToken(token), fetchAdminSubmissions(tugasId)])
      .then(([courseData, subData]) => {
        if (cancelled) return;
        setCourse(courseData.course);
        setTugas(courseData.tugases.find((x) => x.id === tugasId) ?? null);
        setSubmissions(subData.submissions);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setError(err instanceof Error ? err.message : "Gagal memuat pengumpulan.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, token, tugasId]);

  function replaceRow(updated: SubmissionRow) {
    setSubmissions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  async function refreshSubmissions() {
    const result = await fetchAdminSubmissions(tugasId);
    setSubmissions(result.submissions);
  }

  if (authLoading || (user && loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Masuk dulu</h1>
          <p className="text-sm text-slate-600">Halaman ini hanya untuk pengelola mata kuliah.</p>
          <Button onClick={openLoginModal} variant="primary" size="md">
            Masuk
          </Button>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Tidak punya akses</h1>
          <p className="text-sm text-slate-600">
            Hanya pengelola mata kuliah ini yang bisa melihat daftar pengumpulan.
          </p>
        </div>
      </div>
    );
  }

  if (error || !course || !tugas) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-bold text-slate-900">{error ?? "Tugas tidak ditemukan"}</h1>
          <Link
            href={`/tugas/${token}/admin`}
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Kembali ke mata kuliah
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
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          {course.name}
        </Link>

        <Card>
          <p className="text-sm text-slate-500">{course.code}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">{tugas.title}</h1>
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
            <CountdownTimer deadline={tugas.deadline} />
            {tugas.pertemuan != null && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                Pertemuan {tugas.pertemuan}
              </span>
            )}
          </div>
          <div className="mt-4">
            <Link
              href={`/tugas/${token}/admin/assistant?q=${encodeURIComponent(
                `Koreksi semua pengumpulan tugas "${tugas.title}" yang belum dinilai. Tanya saya dulu kalau butuh rubrik.`,
              )}`}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700"
            >
              <Bot className="h-3.5 w-3.5" />
              Koreksi dengan Asisten AI
            </Link>
          </div>
        </Card>

        <MissingSubmittersCard tugasId={tugasId} />

        <Card>
          <h2 className="text-lg font-bold text-slate-900">Daftar pengumpulan</h2>
          <p className="mt-1 text-sm text-slate-600">
            Urut dari yang pertama mengumpulkan. Kamu bisa memberi catatan ke tiap mahasiswa.
          </p>
          <div className="mt-5">
            <AdminSubmissionList submissions={submissions} onChanged={replaceRow} onDeleted={refreshSubmissions} />
          </div>
        </Card>
      </div>
    </div>
  );
}
