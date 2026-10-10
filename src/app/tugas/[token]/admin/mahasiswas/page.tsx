"use client";

import { getErrorMessage } from "@/lib/errors";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import MahasiswaBulkImport from "@/components/tugas/MahasiswaBulkImport";
import MahasiswaTable from "@/components/tugas/MahasiswaTable";
import { useAuth } from "@/components/AuthProvider";
import { fetchCourseByToken, type CourseSummary } from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/admin/mahasiswas — Roster management.
 *
 * Auth: course admin (User.role=ADMIN atau co-admin). Page-level guard via
 * user.role=ADMIN; backend endpoint enforces CourseAdmin lebih ketat.
 */
export default function MahasiswaPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoading(true);
    fetchCourseByToken(token)
      .then((d) => {
        if (cancelled) return;
        setCourse(d.course);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err, "Gagal memuat mata kuliah."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, user, authLoading]);

  if (authLoading) {
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
          <h1 className="text-2xl font-black text-slate-900">Masuk dulu</h1>
          <Button onClick={openLoginModal} variant="primary" size="md">
            Masuk
          </Button>
        </div>
      </div>
    );
  }

  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="text-2xl font-black text-slate-900">Tidak punya akses</h1>
          <p className="text-sm text-slate-600">
            Kamu bukan pengelola mata kuliah ini.
          </p>
          <Link
            href={`/tugas/${token}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            Lihat sebagai mahasiswa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link
          href={`/tugas/${token}/admin`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Pengelola mata kuliah
        </Link>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-8 text-white shadow-2xl md:px-12 md:py-10">
          <div className="text-sm font-medium text-violet-300">
            Roster
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
            {course?.name || "..."}
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Daftar mahasiswa per mata kuliah. Import banyak sekaligus pakai paste
            text atau AI parse dari Excel/Word.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat mata kuliah…
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : course ? (
          <div className="space-y-6">
            <MahasiswaBulkImport
              courseId={course.id}
              classes={course.classes}
              onImported={() => setRefreshKey((k) => k + 1)}
            />
            <MahasiswaTable
              courseId={course.id}
              refreshKey={refreshKey}
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}