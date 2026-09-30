"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { fetchMe, type ManagedCourse } from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

/**
 * /tugas — halaman masuk mata kuliah.
 * Hanya kolom token. Pengelola mata kuliah melihat satu tautan kecil ke halaman kelolanya.
 */
export default function TugasLanding() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isAdmin, setIsAdmin] = useState(false);
  const [managedCourses, setManagedCourses] = useState<ManagedCourse[]>([]);

  useEffect(() => {
    if (loading || !user) {
      setIsAdmin(false);
      setManagedCourses([]);
      return;
    }
    let cancelled = false;
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
      setError("Masukkan token dulu.");
      return;
    }
    setSubmitting(true);
    router.push(`/tugas/${encodeURIComponent(cleaned)}`);
  }

  const showManage = isAdmin || managedCourses.length > 0;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-xl">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Masuk ke mata kuliah</h1>
          <p className="mt-2 text-sm text-slate-600">
            Masukkan token 8 huruf yang dibagikan dosen atau asisten.
          </p>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value.toUpperCase())}
              placeholder="Contoh: ABCD2345"
              maxLength={20}
              autoComplete="off"
              autoFocus
              aria-label="Token mata kuliah"
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
              Buka
            </Button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>

        {showManage && (
          <div className="mt-4 text-center text-sm text-slate-600">
            {isAdmin ? (
              <Link href="/tugas/admin694" className="font-medium text-blue-600 hover:underline">
                Kelola mata kuliah
              </Link>
            ) : (
              <span>
                Mata kuliah yang kamu kelola:{" "}
                {managedCourses.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <Link
                      href={`/tugas/${c.token}/admin`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {c.name}
                    </Link>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
