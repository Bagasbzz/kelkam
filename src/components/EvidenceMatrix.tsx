"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, authenticatedFetch } from "@/components/AuthProvider";
import { useCurrentProjectId } from "@/lib/client/use-current-project";
import { getErrorMessage } from "@/lib/errors";

interface EvidenceRow {
  id: string;
  reference_id: string;
  summary?: string | null;
  methods?: string | null;
  results?: string | null;
  limitations?: string | null;
  citation_sentence?: string | null;
  created_at?: string;
}

export default function EvidenceMatrix() {
  const projectId = useCurrentProjectId();
  const { user } = useAuth();
  const [rows, setRows] = useState<EvidenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEvidence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!user) {
        setRows([]);
        setError("Login dulu untuk melihat evidence yang tersimpan.");
        return;
      }

      if (!projectId) {
        setRows([]);
        setError("Pilih project terlebih dahulu.");
        return;
      }
      const resp = await authenticatedFetch(`/api/references/evidence?projectId=${encodeURIComponent(projectId)}`);
      const data = await resp.json().catch(() => null);
      if (!data?.success) {
        throw new Error(data?.error || "Gagal memuat evidence");
      }
      setRows(Array.isArray(data.data) ? data.data : []);
    } catch (loadError: unknown) {
      setError(getErrorMessage(loadError, "Gagal memuat evidence"));
    } finally {
      setLoading(false);
    }
  }, [projectId, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEvidence();
    }, 0);
    window.addEventListener("referenceEvidenceUpdated", loadEvidence);
    window.addEventListener("researchProjectChanged", loadEvidence);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("referenceEvidenceUpdated", loadEvidence);
      window.removeEventListener("researchProjectChanged", loadEvidence);
    };
  }, [loadEvidence]);

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">Evidence Matrix</div>
          <div className="text-xs text-slate-500">Ringkasan jurnal yang sudah diekstrak dan siap dipakai untuk kajian pustaka.</div>
        </div>
        <button onClick={loadEvidence} className="px-3 py-2 border rounded text-xs font-semibold">Refresh</button>
      </div>

      {loading && <div className="text-sm text-slate-500">Memuat evidence...</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="text-sm text-slate-400">Belum ada evidence. Ekstrak dari kartu referensi dulu.</div>}

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id} className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 text-xs font-bold text-slate-400">{row.reference_id}</div>
            {row.summary && <p className="text-sm text-slate-700 mb-2">{row.summary}</p>}
            <div className="grid gap-2 md:grid-cols-3 text-xs text-slate-600">
              <div><span className="font-bold text-slate-800">Metode:</span> {row.methods || "-"}</div>
              <div><span className="font-bold text-slate-800">Hasil:</span> {row.results || "-"}</div>
              <div><span className="font-bold text-slate-800">Keterbatasan:</span> {row.limitations || "-"}</div>
            </div>
            {row.citation_sentence && <div className="mt-2 rounded bg-slate-50 p-2 text-xs italic text-slate-700">{row.citation_sentence}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
