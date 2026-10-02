"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileText, KeyRound, Loader2, Settings } from "lucide-react";
import Card from "@/components/ui/Card";
import TugasCard from "@/components/tugas/TugasCard";
import SubmissionHistory from "@/components/tugas/SubmissionHistory";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchCourseByToken,
  fetchCourseMaterials,
  type CourseMaterial,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token] — halaman mata kuliah untuk mahasiswa.
 * Tugas aktif dan yang sudah lewat batas waktu ditampilkan terpisah; keduanya tetap
 * bisa dibuka supaya mahasiswa bisa melihat riwayat pengumpulannya.
 */
export default function CoursePage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  const { user, loading: authLoading } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [tugases, setTugases] = useState<TugasSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCourseByToken(token)
      .then(async (data) => {
        if (cancelled) return;
        const materialData = await fetchCourseMaterials(data.course.id, token).catch(() => ({ materials: [] }));
        if (cancelled) return;
        setCourse(data.course);
        setTugases(data.tugases);
        setMaterials(materialData.materials);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat mata kuliah.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const { active, past } = useMemo(() => {
    const now = Date.now();
    const active: TugasSummary[] = [];
    const past: TugasSummary[] = [];
    for (const t of tugases) {
      (new Date(t.deadline).getTime() < now ? past : active).push(t);
    }
    // Aktif: paling dekat dulu. Lewat: paling baru lewat dulu.
    active.sort((a, b) => +new Date(a.deadline) - +new Date(b.deadline));
    past.sort((a, b) => +new Date(b.deadline) - +new Date(a.deadline));
    return { active, past };
  }, [tugases]);

  if (loading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-600">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Mata kuliah tidak ditemukan</h1>
          <p className="text-sm text-slate-600">Periksa lagi token yang kamu masukkan.</p>
          <Link
            href="/tugas"
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Masukkan token lagi
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
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Ganti mata kuliah
        </Link>

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-slate-500">{course.code}</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 md:text-3xl">{course.name}</h1>
              {course.description && (
                <p className="mt-2 max-w-2xl text-sm text-slate-600">{course.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                  <KeyRound className="h-4 w-4" />
                  Token <span className="font-mono font-medium">{course.token}</span>
                </span>
                {course.classes.map((c) => (
                  <span key={c.id} className="rounded-full bg-slate-100 px-3 py-1">
                    Kelas {c.name}
                  </span>
                ))}
              </div>
            </div>
            {user?.role === "ADMIN" && (
              <Link
                href={`/tugas/${course.token}/admin`}
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Settings className="h-4 w-4" />
                Kelola
              </Link>
            )}
          </div>
        </Card>

        {materials.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-slate-900">Materi pertemuan</h2>
            <div className="mt-4 divide-y divide-slate-100">
              {materials.map((material) => (
                <div key={material.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-5 w-5 shrink-0 text-blue-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{material.originalName}</p>
                      <p className="text-xs text-slate-500">{(material.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                  </div>
                  <a
                    href={`/api/tugas/courses/${course.id}/materials/${material.id}/download?token=${encodeURIComponent(course.token)}`}
                    className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 hover:underline"
                  >
                    <Download className="h-4 w-4" />
                    Unduh
                  </a>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h2 className="text-lg font-bold text-slate-900">Tugas aktif</h2>
          <p className="mt-1 text-sm text-slate-600">
            {active.length === 0
              ? "Tidak ada tugas yang sedang berjalan."
              : `${active.length} tugas, urut dari batas waktu terdekat.`}
          </p>
          {active.length > 0 && (
            <div className="mt-5 space-y-3">
              {active.map((t) => (
                <TugasCard key={t.id} tugas={t} href={`/tugas/${course.token}/${t.id}`} />
              ))}
            </div>
          )}
        </Card>

        {past.length > 0 && (
          <Card>
            <h2 className="text-lg font-bold text-slate-900">Sudah lewat batas waktu</h2>
            <p className="mt-1 text-sm text-slate-600">
              Masih bisa dibuka untuk melihat detail dan riwayat pengumpulan kamu.
            </p>
            <div className="mt-5 space-y-3">
              {past.map((t) => (
                <TugasCard key={t.id} tugas={t} href={`/tugas/${course.token}/${t.id}`} />
              ))}
            </div>
          </Card>
        )}

        <SubmissionHistory courseId={course.id} token={course.token} />
      </div>
    </div>
  );
}
