"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  Clock,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchCourseByToken,
  fetchMe,
  generateCourseInsights,
  type CourseSummary,
} from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/admin/insights — AI summary untuk course.
 *
 * Auth: course admin.
 */
export default function CourseInsightsPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token || "").toUpperCase();
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);

  const [metrics, setMetrics] = useState<{
    totalSubmissions: number;
    totalLate: number;
    lateRate: number;
    rosterCount: number;
    perClass: Record<string, number>;
    tugasesCount: number;
  } | null>(null);
  const [aiInsights, setAiInsights] = useState<string | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCourseByToken(token), fetchMe()])
      .then(([data, me]) => {
        if (cancelled) return;
        setCourse(data.course);
        setIsManager(me.isAdmin || me.managedCourses.some((item) => item.id === data.course.id));
      })
      .catch(() => !cancelled && setCourse(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, user, authLoading]);

  async function loadInsights() {
    if (!course) return;
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const r = await generateCourseInsights(course.id);
      setMetrics(r.metrics);
      setAiInsights(r.aiInsights);
    } catch (err) {
      setInsightsError(err instanceof Error ? err.message : "Gagal generate.");
    } finally {
      setInsightsLoading(false);
    }
  }

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
  if (!loading && !isManager) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="text-2xl font-black text-slate-900">Tidak punya akses</h1>
          <Link href={`/tugas/${token}`} className="text-sm font-bold text-blue-600 hover:underline">
            Lihat sebagai mahasiswa
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-[1000px] space-y-6">
        <Link
          href={`/tugas/${token}/admin`}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Pengelola mata kuliah
        </Link>

        <div className="rounded-[2rem] bg-gradient-to-br from-blue-950 to-indigo-950 px-7 py-10 text-white shadow-2xl md:px-12 md:py-12">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
            <BarChart3 className="h-4 w-4" />
            AI Insights
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">
            {course?.name || "..."}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-300">
            AI merangkum pola pengumpulan, keterlambatan, dan sebaran per kelas
            di mata kuliah ini. Klik tombol di bawah untuk membuat ringkasan.
          </p>
          <div className="mt-5">
            <Button
              variant="primary"
              size="md"
              icon={RefreshCw}
              onClick={() => void loadInsights()}
              isLoading={insightsLoading}
              disabled={insightsLoading}
            >
              {metrics ? "Regenerate" : "Generate Insight"}
            </Button>
          </div>
        </div>

        {insightsError && (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {insightsError}
          </p>
        )}

        {metrics && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Pengumpulan" value={metrics.totalSubmissions} icon={Users} />
            <MetricCard label="Telat" value={metrics.totalLate} tone={metrics.totalLate > 0 ? "warn" : "ok"} />
            <MetricCard
              label="Late rate"
              value={`${(metrics.lateRate * 100).toFixed(0)}%`}
              tone={metrics.lateRate > 0.3 ? "warn" : "ok"}
            />
            <MetricCard label="Roster" value={metrics.rosterCount} icon={Users} />
          </div>
        )}

        {aiInsights && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-600">
              <BarChart3 className="h-3 w-3" />
              Insight AI
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {aiInsights}
            </div>
          </div>
        )}

        {!metrics && !insightsLoading && (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            <Clock className="mx-auto mb-3 h-6 w-6 text-slate-300" />
            Belum ada insight. Klik &ldquo;Generate Insight&rdquo; di atas.
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "ok" | "warn";
}) {
  const color =
    tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-white text-slate-900";
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${color}`}>
      <div className="flex items-center gap-1 text-xs font-medium text-slate-500">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-black">{value}</div>
    </div>
  );
}