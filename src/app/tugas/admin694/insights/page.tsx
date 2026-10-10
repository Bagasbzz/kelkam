"use client";

import { getErrorMessage } from "@/lib/errors";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";
import { generateAdminInsights } from "@/lib/client/tugas-api";

interface CourseInsight {
  id: string;
  token: string;
  name: string;
  code: string;
  tugasesCount: number;
  totalSubmissions: number;
  lateSubmissions: number;
  lateRate: number;
  rosterCount: number;
}

/**
 * /tugas/admin/insights — Global AI insights untuk super admin.
 *
 * Auth: User.role === 'ADMIN'.
 */
export default function AdminInsightsPage() {
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [courses, setCourses] = useState<CourseInsight[]>([]);
  const [globalInsight, setGlobalInsight] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await generateAdminInsights();
      setCourses(r.courses);
      setGlobalInsight(r.globalInsight);
    } catch (err) {
      setError(getErrorMessage(err, "Gagal generate."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authLoading || !user) return;
    if (user.role === "ADMIN") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, authLoading]);

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
          <Button onClick={openLoginModal} variant="primary" size="md">Masuk</Button>
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
          <p className="text-sm text-slate-600">Halaman ini hanya untuk super admin.</p>
        </div>
      </div>
    );
  }

  const totals = courses.reduce(
    (acc, c) => ({
      submissions: acc.submissions + c.totalSubmissions,
      late: acc.late + c.lateSubmissions,
      roster: acc.roster + c.rosterCount,
      tugases: acc.tugases + c.tugasesCount,
    }),
    { submissions: 0, late: 0, roster: 0, tugases: 0 },
  );

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link
          href="/tugas/admin694"
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          ← Admin index
        </Link>

        <div className="rounded-[2rem] bg-gradient-to-br from-violet-950 to-indigo-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex items-center gap-2 text-sm font-medium text-violet-300">
            <BarChart3 className="h-4 w-4" />
            Global AI Insights
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
            Snapshot platform Tugas
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300">
            Monitoring semua mata kuliah: pengumpulan rate, late rate, roster size, dan
            rekomendasi prioritas intervensi.
          </p>
          <div className="mt-5">
            <Button
              variant="primary"
              size="md"
              icon={RefreshCw}
              onClick={() => void load()}
              isLoading={loading}
              disabled={loading}
            >
              Regenerate
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Mata kuliah aktif" value={courses.length} />
          <Stat label="Total tugas" value={totals.tugases} />
          <Stat label="Pengumpulan" value={totals.submissions} />
          <Stat label="Mahasiswa" value={totals.roster} />
        </div>

        {globalInsight && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-violet-600">
              <BarChart3 className="h-3 w-3" />
              Insight Platform
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {globalInsight}
            </div>
          </div>
        )}

        {courses.length > 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-6 py-4">
              <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">
                Per-Mata kuliah
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-medium text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Mata kuliah</th>
                    <th className="px-4 py-3 text-right">Tugas</th>
                    <th className="px-4 py-3 text-right">Submit</th>
                    <th className="px-4 py-3 text-right">Late</th>
                    <th className="px-4 py-3 text-right">Late rate</th>
                    <th className="px-4 py-3 text-right">Roster</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{c.name}</p>
                        <p className="font-mono text-xs text-slate-500">
                          {c.code} · {c.token}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{c.tugasesCount}</td>
                      <td className="px-4 py-3 text-right font-mono">{c.totalSubmissions}</td>
                      <td className="px-4 py-3 text-right font-mono">
                        {c.lateSubmissions > 0 ? (
                          <span className="text-amber-700">{c.lateSubmissions}</span>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {(c.lateRate * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{c.rosterCount}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/tugas/${c.token}/admin`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline"
                        >
                          Buka <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
    </div>
  );
}