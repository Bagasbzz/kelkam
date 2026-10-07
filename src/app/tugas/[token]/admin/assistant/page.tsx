"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Loader2, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import AdminAssistantChat from "@/components/tugas/AdminAssistantChat";
import { useAuth } from "@/components/AuthProvider";
import { fetchCourseByToken, fetchMe, type CourseSummary } from "@/lib/client/tugas-api";

/**
 * /tugas/[token]/admin/assistant — Chatbot Admin AI untuk course.
 * Query ?q= mengisi prompt awal (dipakai tombol "Koreksi dengan AI").
 */
export default function CourseAssistantPage() {
  const params = useParams<{ token: string }>();
  const search = useSearchParams();
  const token = (params?.token || "").toUpperCase();
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    Promise.all([fetchCourseByToken(token), fetchMe()])
      .then(([data, me]) => {
        if (cancelled) return;
        setCourse(data.course);
        setIsManager(me.isAdmin || me.managedCourses.some((item) => item.id === data.course.id));
      })
      .catch(() => !cancelled && setCourse(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [token, user, authLoading]);

  if (authLoading || (user && loading)) {
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
  if (!course || !isManager) {
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
      <div className="mx-auto max-w-[1100px] space-y-6">
        <Link href={`/tugas/${token}/admin`} className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          {course.name}
        </Link>
        <div className="rounded-[2rem] bg-slate-950 px-7 py-8 text-white shadow-2xl md:px-10">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
            <Bot className="h-4 w-4" /> Asisten Dosen AI
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">{course.code} · {course.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-300">
            Koreksi pengumpulan (termasuk isi ZIP/PDF/DOCX), lihat yang belum kumpul per pertemuan, rekap nilai,
            deteksi kemiripan & indikasi AI. Asisten bertanya dulu bila rubrik belum jelas.
          </p>
        </div>
        <AdminAssistantChat courseId={course.id} initialPrompt={search?.get("q") ?? undefined} />
      </div>
    </div>
  );
}
