"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  ClipboardList,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import Card from "@/components/ui/Card";
import TugasCard from "@/components/tugas/TugasCard";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchCourseByToken,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token] — Public course view.
 *
 * Tampilkan info course + list tugases. Admin (kalau login & punya akses)
 * lihat tombol admin.
 */
export default function CoursePage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  const { user, loading: authLoading } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [tugases, setTugases] = useState<TugasSummary[]>([]);
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
        setTugases(data.tugases);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Gagal memuat course.";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">Course tidak ditemukan</h1>
          <p className="text-sm text-slate-600">{error}</p>
          <Link
            href="/tugas"
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke halaman Tugas
          </Link>
        </div>
      </div>
    );
  }

  if (!course) return null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link
          href="/tugas"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Tugas
        </Link>

        {/* Course header */}
        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ClipboardList className="w-4 h-4" />
            {course.code}
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
            {course.name}
          </h1>
          {course.description && (
            <p className="mt-3 max-w-2xl text-sm text-slate-300">{course.description}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
              <KeyRound className="w-4 h-4" />
              Token: <span className="font-mono">{course.token}</span>
            </span>
            {course.classes.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200"
              >
                Kelas {c.name}
              </span>
            ))}
          </div>
          {user?.role === "ADMIN" && (
            <div className="mt-5">
              <Link
                href={`/tugas/${course.token}/admin`}
                className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-900 hover:bg-blue-50"
              >
                <ShieldCheck className="w-4 h-4" />
                Kelola Course
              </Link>
            </div>
          )}
        </div>

        {/* Tugases list */}
        <Card>
          <h2 className="text-lg font-black text-slate-900">Daftar Tugas</h2>
          <p className="mt-1 text-sm text-slate-600">
            {tugases.length === 0
              ? "Belum ada tugas di course ini."
              : `${tugases.length} tugas, urut dari yang paling dekat deadline.`}
          </p>
          <div className="mt-5 space-y-3">
            {tugases.map((t) => (
              <TugasCard
                key={t.id}
                tugas={t}
                href={`/tugas/${course.token}/${t.id}`}
              />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}