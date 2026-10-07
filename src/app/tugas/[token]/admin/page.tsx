"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  ClipboardList,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import TugasCard from "@/components/tugas/TugasCard";
import CourseMaterialsManager from "@/components/tugas/CourseMaterialsManager";
import { useAuth } from "@/components/AuthProvider";
import {
  deleteTugas,
  fetchAdminSubmissions,
  fetchCourseByToken,
  fetchMe,
  updateCourse,
  updateCourseClass,
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
  const [isManager, setIsManager] = useState(false);
  const [tugases, setTugases] = useState<TugasSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, me] = await Promise.all([fetchCourseByToken(token), fetchMe()]);
      setIsManager(me.isAdmin || me.managedCourses.some((item) => item.id === data.course.id));
      setCourse(data.course);
      setTugases(data.tugases);
      // Fetch submission counts in parallel (best-effort) — sequential would
      // be N round-trips, jadi pakai Promise.allSettled untuk toleransi error.
      const results = await Promise.allSettled(
        data.tugases.map((t) => fetchAdminSubmissions(t.id)),
      );
      const next: Record<string, number> = {};
      results.forEach((r, i) => {
        const id = data.tugases[i].id;
        next[id] = r.status === "fulfilled" ? r.value.submissions.length : 0;
      });
      setCounts(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat mata kuliah.");
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

  async function saveCourse() {
    if (!course) return;
    setSaving(true);
    setEditError(null);
    try {
      const result = await updateCourse(course.id, { name: draftName, description: draftDescription });
      setCourse(result.course);
      setEditingCourse(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Gagal menyimpan mata kuliah.");
    } finally {
      setSaving(false);
    }
  }

  async function saveClass() {
    if (!course || !editingClassId) return;
    setSaving(true);
    setEditError(null);
    try {
      const result = await updateCourseClass(course.id, editingClassId, draftName);
      setCourse({ ...course, classes: course.classes.map((item) => item.id === editingClassId ? result.class : item) });
      setEditingClassId(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Gagal menyimpan kelas.");
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-black text-slate-900">Masuk dulu</h1>
          <p className="text-sm text-slate-600">Halaman pengelola mata kuliah ini perlu masuk dulu.</p>
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
          <h1 className="text-2xl font-black text-slate-900">Mata kuliah tidak ditemukan</h1>
          {error && <p className="text-sm text-slate-600">{error}</p>}
          <Link
            href="/tugas/admin694"
            className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali
          </Link>
        </div>
      </div>
    );
  }

  if (!isManager) {
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
          href="/tugas/admin694"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Admin
        </Link>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
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
            <Link
              href={`/tugas/${token}/admin/mahasiswas`}
              className="inline-flex items-center gap-2 rounded-full bg-violet-500/20 px-3 py-1.5 text-xs font-bold text-violet-100 transition hover:bg-violet-500/40"
            >
              <UserPlus className="w-3 h-3" />
              Roster Mahasiswa
            </Link>
            <Link
              href={`/tugas/${token}/admin/insights`}
              className="inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1.5 text-xs font-bold text-blue-100 transition hover:bg-blue-500/40"
            >
              <BarChart3 className="w-3 h-3" />
              AI Insights
            </Link>
            <Link
              href={`/tugas/${token}/admin/assistant`}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-100 transition hover:bg-emerald-500/40"
            >
              <Bot className="w-3 h-3" />
              Asisten AI
            </Link>
          </div>
        </div>

        <Card>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">Detail mata kuliah</h2>
            {!editingCourse && <Button type="button" variant="outline" size="sm" icon={Pencil} onClick={() => {
              setEditingClassId(null);
              setDraftName(course.name);
              setDraftDescription(course.description ?? "");
              setEditError(null);
              setEditingCourse(true);
            }}>Ubah</Button>}
          </div>
          {editingCourse ? (
            <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); void saveCourse(); }}>
              <label className="block text-sm font-medium text-slate-700">Nama mata kuliah
                <input className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={160} required disabled={saving} />
              </label>
              <label className="block text-sm font-medium text-slate-700">Deskripsi
                <textarea className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-slate-900" value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} maxLength={8000} rows={3} disabled={saving} />
              </label>
              {editError && <p role="alert" className="text-sm text-red-600">{editError}</p>}
              <div className="flex gap-2"><Button type="submit" disabled={saving}>Simpan</Button><Button type="button" variant="outline" disabled={saving} onClick={() => setEditingCourse(false)}>Batal</Button></div>
            </form>
          ) : <p className="mt-2 text-sm text-slate-600">{course.name}{course.description ? ` · ${course.description}` : ""}</p>}

          <h3 className="mt-6 text-sm font-bold text-slate-900">Kelas</h3>
          <div className="mt-2 space-y-2">
            {course.classes.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 py-2">
              {editingClassId === item.id ? (
                <form className="flex flex-1 flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void saveClass(); }}>
                  <input aria-label="Nama kelas" className="min-w-0 flex-1 rounded-lg border border-slate-300 p-2 text-slate-900" value={draftName} onChange={(event) => setDraftName(event.target.value)} maxLength={40} required disabled={saving} />
                  <Button type="submit" size="sm" disabled={saving}>Simpan</Button>
                  <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => setEditingClassId(null)}>Batal</Button>
                  {editError && <p role="alert" className="w-full text-sm text-red-600">{editError}</p>}
                </form>
              ) : <><span className="flex-1 text-sm text-slate-700">{item.name}</span><Button type="button" variant="outline" size="sm" icon={Pencil} onClick={() => {
                setEditingCourse(false);
                setEditingClassId(item.id);
                setDraftName(item.name);
                setEditError(null);
              }}>Ubah</Button></>}
            </div>)}
          </div>
        </Card>

        <Card>
          <CourseMaterialsManager courseId={course.id} token={course.token} />
        </Card>

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
              Buat tugas
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
                Belum ada tugas. Klik tombol &ldquo;Buat tugas&rdquo; untuk mulai.
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