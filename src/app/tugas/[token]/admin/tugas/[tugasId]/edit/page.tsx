"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import TugasFormPage from "@/components/tugas/TugasFormPage";
import {
  fetchCourseByToken,
  type TugasSummary,
} from "@/lib/client/tugas-api";

export default function EditTugasPage() {
  const params = useParams<{ token: string; tugasId: string }>();
  const token = (params?.token || "").toUpperCase();
  const tugasId = params?.tugasId || "";

  const [initial, setInitial] = useState<TugasSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCourseByToken(token)
      .then((data) => {
        if (cancelled) return;
        const t = data.tugases.find((x) => x.id === tugasId) ?? null;
        if (!t) {
          setError("Tugas tidak ditemukan.");
        } else {
          setInitial(t);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Gagal memuat tugas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, tugasId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !initial) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">{error ?? "Tugas tidak ditemukan"}</h1>
        </div>
      </div>
    );
  }

  return <TugasFormPage token={token} initial={initial} />;
}