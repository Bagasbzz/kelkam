"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import KelasPicker from "@/components/tugas/KelasPicker";
import {
  createTugas,
  fetchCourseByToken,
  updateTugas,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

interface TugasFormPageProps {
  token: string;
  /** Kalau undefined = create mode. Kalau ada = edit mode. */
  initial?: TugasSummary;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:mm (local).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export default function TugasFormPage({ token, initial }: TugasFormPageProps) {
  const router = useRouter();
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const isEdit = Boolean(initial);

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(true);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [classId, setClassId] = useState<string | null>(initial?.classId ?? null);
  const [deadlineLocal, setDeadlineLocal] = useState<string>(
    initial ? toDatetimeLocal(initial.deadline) : "",
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCourse(true);
    fetchCourseByToken(token)
      .then((data) => {
        if (cancelled) return;
        setCourse(data.course);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat course.");
      })
      .finally(() => {
        if (!cancelled) setLoadingCourse(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (authLoading || loadingCourse) {
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
            <Button onClick={openLoginModal} variant="primary" size="md">
              Masuk
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Course tidak ditemukan</h1>
        </div>
      </div>
    );
  }

  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Akses ditolak</h1>
          <p className="text-sm text-slate-600">Kamu bukan admin untuk course ini.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Judul wajib diisi.");
      return;
    }
    if (!deadlineLocal) {
      setError("Deadline wajib diisi.");
      return;
    }
    const iso = fromDatetimeLocal(deadlineLocal);
    if (!iso) {
      setError("Format deadline tidak valid.");
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && initial) {
        await updateTugas(initial.id, {
          title: title.trim(),
          description,
          deadline: iso,
          classId,
        });
      } else {
        await createTugas({
          courseId: course!.id,
          classId,
          title: title.trim(),
          description,
          deadline: iso,
        });
      }
      router.push(`/tugas/${token}/admin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-2xl space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </button>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-8 text-white shadow-2xl md:px-10 md:py-10">
          <p className="text-xs font-bold uppercase tracking-widest text-blue-300">
            {course.name} ({course.code})
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
            {isEdit ? "Edit Tugas" : "Bikin Tugas Baru"}
          </h1>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <Input
              label="Judul"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tugas 1: Sorting Algorithm"
              maxLength={160}
            />

            <Textarea
              label="Deskripsi"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={8000}
              placeholder="Instruksi tugas, format file, dll..."
            />

            <div>
              <p className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Kelas (opsional — kosongkan untuk semua kelas)
              </p>
              <KelasPicker
                options={course.classes}
                value={classId}
                onChange={(id) => setClassId(id === classId ? null : id)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                Deadline
              </label>
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Disimpan UTC. Tampil di WIB (Asia/Jakarta) untuk mahasiswa.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={submitting}
                disabled={submitting}
              >
                {isEdit ? "Simpan Perubahan" : "Bikin Tugas"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}