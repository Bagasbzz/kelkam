"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useAuth } from "@/components/AuthProvider";
import {
  createCourse,
  fetchMe,
  type ManagedCourse,
} from "@/lib/client/tugas-api";

/**
 * /tugas/admin — Index course yang di-manage + form bikin course baru.
 *
 * Auth: user harus login DAN role=ADMIN.
 */
export default function TugasAdminIndex() {
  const router = useRouter();
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [managedCourses, setManagedCourses] = useState<ManagedCourse[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);

  // Form bikin course
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [classesRaw, setClassesRaw] = useState("A, B, C");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // tampilkan prompt login di render
    let cancelled = false;
    setManagedLoading(true);
    fetchMe()
      .then((data) => {
        if (cancelled) return;
        setManagedCourses(data.managedCourses);
      })
      .catch(() => {
        if (cancelled) return;
        setManagedCourses([]);
      })
      .finally(() => {
        if (!cancelled) setManagedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) {
      openLoginModal();
      return;
    }
    if (user.role !== "ADMIN") {
      setError("Hanya admin yang boleh bikin course baru.");
      return;
    }
    if (!name.trim() || !code.trim()) {
      setError("Nama dan kode course wajib diisi.");
      return;
    }
    const classes = classesRaw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (classes.length === 0) {
      setError("Minimal satu kelas.");
      return;
    }
    setSubmitting(true);
    try {
      const { course } = await createCourse({
        name: name.trim(),
        code: code.trim(),
        description: description.trim() || undefined,
        classes,
      });
      router.push(`/tugas/${course.token}/admin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal bikin course.");
    } finally {
      setSubmitting(false);
    }
  }

  // Belum login
  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Login dulu</h1>
          <p className="text-sm text-slate-600">
            Halaman ini hanya untuk admin Tugas.
          </p>
          <div className="pt-2">
            <Button onClick={openLoginModal} variant="primary" size="md">
              Masuk
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Belum ADMIN
  if (!authLoading && user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="text-2xl font-black text-slate-900">Akses ditolak</h1>
          <p className="text-sm text-slate-600">
            Akun kamu belum punya role ADMIN. Hubungi creator course untuk invite.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ShieldCheck className="w-4 h-4" />
            Admin Tugas
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
            Kelola course kamu
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            Bikin course baru atau buka course yang sudah ada.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Form create */}
          <Card className="lg:col-span-2">
            <h2 className="text-lg font-black text-slate-900">Bikin Course Baru</h2>
            <p className="mt-1 text-sm text-slate-600">
              Token unik akan di-generate otomatis. Bagikan ke mahasiswa.
            </p>
            <form onSubmit={onCreate} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                    Nama
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Algoritma & Pemrograman"
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
                    maxLength={120}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                    Kode
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="IF-2010"
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
                    maxLength={40}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                  Deskripsi (opsional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
                  placeholder="Penjelasan singkat..."
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
                  Kelas (pisahkan dengan koma)
                </label>
                <input
                  type="text"
                  value={classesRaw}
                  onChange={(e) => setClassesRaw(e.target.value)}
                  placeholder="A, B, C"
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
                />
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  icon={Plus}
                  isLoading={submitting}
                  disabled={submitting}
                >
                  Bikin Course
                </Button>
              </div>
            </form>
          </Card>

          {/* Course list */}
          <Card>
            <h2 className="text-lg font-black text-slate-900">Course kamu</h2>
            <p className="mt-1 text-sm text-slate-600">
              {managedLoading ? "Memuat..." : `${managedCourses.length} course.`}
            </p>
            <div className="mt-5 space-y-2">
              {managedLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memuat...
                </div>
              ) : managedCourses.length === 0 ? (
                <p className="text-sm text-slate-500">Belum ada course.</p>
              ) : (
                managedCourses.map((c) => (
                  <Link
                    key={c.id}
                    href={`/tugas/${c.token}/admin`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {c.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {c.code} • {c.token}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0 text-slate-400" />
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}