"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ClipboardList,
  Loader2,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import TugasCard from "@/components/tugas/TugasCard";
import { useAuth } from "@/components/AuthProvider";
import {
  deleteTugas,
  fetchAdminSubmissions,
  fetchCourseByToken,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/admin — Dashboard per-course.
 *
 * - List tugases (with admin controls: edit, delete, lihat submission).
 * - Akses ke API admin (lihat submissions per tugas).
 *
 * Auth: course admin.
 */
export default function CourseAdminDashboard() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  const router = useRouter();
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [tugases, setTugases] = useState<TugasSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCourseByToken(token);
      setCourse(data.course);
      setTugases(data.tugases);
      // Count submissions per tugas (best-effort, sequential).
      const next: Record<string, number> = {};
      for (const t of data.tugases) {
        try {
          const sub = await fetchAdminSubmissions(t.id);
          next[t.id] = sub.submissions.length;
        } catch {
          next[t.id] = 0;
        }
      }
      setCounts(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat course.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    void loadAll();
  }, [user, authLoading, loadAll]);

  async function onDelete(t: TugasSummary) {
    setDeleteError(null);
    try {
      await deleteTugas(t.id);
      await loadAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Gagal hapus tugas.");
    }
  }

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
          <p className="text-sm text-slate-600">Halaman admin course ini butuh login.</p>
          <div className="pt-2">
            <Button onClick={openLoginModal} variant="primary" size="md">
              Masuk
            </Button>
          </div>
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

  if (error || !course) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Course tidak ditemukan</h1>
          {error && <p className="text-sm text-slate-600">{error}</p>}
          <Link
            href="/tugas/admin"
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </Link>
        </div>
      </div>
    );
  }

  // Guard: hanya course admin yang boleh akses. user.role=ADMIN = super admin.
  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="text-2xl font-black text-slate-900">Akses ditolak</h1>
          <p className="text-sm text-slate-600">
            Kamu bukan admin untuk course ini.
          </p>
          <Link
            href={`/tugas/${token}`}
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            Lihat sebagai mahasiswa
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link
          href="/tugas/admin"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Admin
        </Link>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ShieldCheck className="w-4 h-4" />
            {course.code}
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
            {course.name}
          </h1>
          {course.description && (
            <p className="mt-3 max-w-2xl text-sm text-slate-300">{course.description}</p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white">
              Token: <span className="font-mono">{course.token}</span>
            </span>
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold text-slate-200">
              <Users className="w-4 h-4" />
              {course.classes.length} kelas
            </span>
          </div>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
                <ClipboardList className="w-5 h-5 text-blue-500" />
                Daftar Tugas
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {tugases.length} tugas. Edit, hapus, atau lihat submission.
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              icon={Plus}
              onClick={() => router.push(`/tugas/${token}/admin/tugas/new`)}
            >
              Bikin Tugas
            </Button>
          </div>

          {deleteError && (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <span className="font-bold">Gagal hapus tugas:</span>
              <span>{deleteError}</span>
              <button
                type="button"
                onClick={() => setDeleteError(null)}
                className="ml-auto text-xs font-bold text-red-700 hover:underline"
              >
                Tutup
              </button>
            </div>
          )}

          <div className="mt-5 space-y-3">
            {tugases.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                Belum ada tugas. Klik "Bikin Tugas" untuk mulai.
              </p>
            ) : (
              tugases.map((t) => (
                <TugasCard
                  key={t.id}
                  tugas={t}
                  href={`/tugas/${token}/${t.id}`}
                  isAdmin
                  editHref={`/tugas/${token}/admin/tugas/${t.id}/edit`}
                  submissionsHref={`/tugas/${token}/admin/tugas/${t.id}/submissions`}
                  onDelete={onDelete}
                  submissionsCount={counts[t.id]}
                />
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}