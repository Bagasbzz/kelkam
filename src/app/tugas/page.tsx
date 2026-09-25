"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardList,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import {
  fetchMe,
  type ManagedCourse,
} from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

/**
 * /tugas — Landing page.
 *
 * - Anonymous: input token untuk masuk ke course.
 * - Logged-in: token input + daftar course yang di-manage (admin/co-admin).
 */
export default function TugasLanding() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [managedCourses, setManagedCourses] = useState<ManagedCourse[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setManagedCourses([]);
      return;
    }
    let cancelled = false;
    setManagedLoading(true);
    fetchMe()
      .then((data) => {
        if (cancelled) return;
        setIsAdmin(data.isAdmin);
        setManagedCourses(data.managedCourses);
      })
      .catch(() => {
        if (cancelled) return;
        setIsAdmin(false);
        setManagedCourses([]);
      })
      .finally(() => {
        if (!cancelled) setManagedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleaned = token.trim().toUpperCase();
    if (!cleaned) {
      setError("Isi token course dulu.");
      return;
    }
    setSubmitting(true);
    router.push(`/tugas/${encodeURIComponent(cleaned)}`);
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        {/* Hero */}
        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-14">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-300">
            <ClipboardList className="w-4 h-4" />
            Fitur Tugas
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">
            Kumpulkan tugas
            <br />
            pakai token mata kuliah.
          </h1>
          <p className="mt-3 max-w-xl text-sm text-slate-300 md:text-base">
            Mahasiswa akses course lewat token. Lihat tugas, submit file + catatan,
            lihat posisi antrian kamu. Asdos kelola course + tugas + lihat full
            submission list.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Token input */}
          <Card className="lg:col-span-2">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              <KeyRound className="w-4 h-4" />
              Masuk course
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-900">
              Punya token mata kuliah?
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Token biasanya 8 karakter, share dari asdos kamu.
            </p>

            <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-3 sm:flex-row">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value.toUpperCase())}
                placeholder="ABCD2345"
                maxLength={20}
                autoComplete="off"
                className="font-mono uppercase tracking-widest"
              />
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={ArrowRight}
                isLoading={submitting}
                disabled={submitting}
              >
                Buka Course
              </Button>
            </form>
            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          </Card>

          {/* Admin entry */}
          <Card>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              <ShieldCheck className="w-4 h-4" />
              Untuk Asdos
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-900">
              Kelola course
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Bikin course baru, atur kelas, tambah co-admin.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              {loading || managedLoading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Memuat...
                </div>
              ) : !user ? (
                <p className="text-xs text-slate-500">
                  Masuk dulu sebagai ADMIN untuk akses.
                </p>
              ) : !isAdmin ? (
                <p className="text-xs text-slate-500">
                  Akun kamu belum jadi admin. Hubungi creator course.
                </p>
              ) : (
                <Link href="/tugas/admin">
                  <Button variant="primary" size="md" icon={Plus}>
                    Bikin Course Baru
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        </div>

        {/* Managed courses (logged-in users) */}
        {user && (
          <Card>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500">
              <Users className="w-4 h-4" />
              Course yang kamu kelola
            </div>
            {managedLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Memuat course...
              </div>
            ) : managedCourses.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                Belum ada course yang kamu kelola.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {managedCourses.map((c) => (
                  <Link
                    key={c.id}
                    href={`/tugas/${c.token}/admin`}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:bg-blue-50/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">
                        {c.name}{" "}
                        <span className="font-mono text-xs text-slate-500">
                          ({c.code})
                        </span>
                      </p>
                      <p className="mt-1 font-mono text-xs text-slate-500">
                        Token: {c.token}
                        {c.isCreator ? " • Pembuat" : " • Co-admin"}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 shrink-0 text-slate-400" />
                  </Link>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}