"use client";

import React, { useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export interface ReferenceItem {
  id: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
  doiVerified?: boolean;
  pdfStatus?: "verified" | "landing_page" | "closed" | "broken" | "unknown";
  citationCount?: number;
  isOpenAccess?: boolean;
  source?: string | null;
  sourceProviders?: string[];
  citationApa?: string | null;
}

export default function ReferenceCard({
  paper,
  onSave,
  onReject,
}: {
  paper: ReferenceItem;
  onSave?: (paper: ReferenceItem) => void;
  onReject?: (paperId: string) => void;
}) {
  const handleSave = () => {
    if (onSave) onSave(paper);
  };

  const handleReject = () => {
    if (onReject) onReject(paper.id);
  };

  const [extracting, setExtracting] = useState(false);
  const [extractStatus, setExtractStatus] = useState<string | null>(null);

  async function extractEvidence() {
    if (extracting) return;
    setExtracting(true);
    setExtractStatus("Menjalankan ekstraksi...");
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;
      const projectId = (typeof window !== "undefined" ? localStorage.getItem("current_project_id") : null) || "proj_local_1";

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const resp = await fetch("/api/references/evidence/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({
          projectId,
          referenceId: paper.doi || paper.id,
          title: paper.title,
          authors: paper.authors || [],
          year: paper.year || null,
          venue: paper.venue || null,
          abstract: paper.abstract || null,
          url: paper.url || null,
        }),
      });
      const j = await resp.json().catch(() => ({ success: false }));
      if (j?.success) {
        setExtractStatus("Ekstraksi selesai");
        window.dispatchEvent(new Event("referenceEvidenceUpdated"));
      } else {
        setExtractStatus("Gagal: " + (j?.error || "Unknown"));
      }
    } catch {
      setExtractStatus("Network error");
    } finally {
      setExtracting(false);
      setTimeout(() => setExtractStatus(null), 4000);
    }
  }

  const providerLabel = Array.isArray(paper.sourceProviders) && paper.sourceProviders.length
    ? paper.sourceProviders.join(", ")
    : paper.source || "";

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h3 className="text-sm font-bold mb-1">{paper.title}</h3>
          <div className="text-xs text-slate-500 mb-2">
            {(paper.authors || []).join(", ")} {paper.year ? `• ${paper.year}` : ""}
            {paper.venue ? ` • ${paper.venue}` : ""}
          </div>
        </div>
        <div className="text-right text-[11px] text-slate-400">
          <div>{providerLabel}</div>
          <div>{paper.citationCount ? `${paper.citationCount} sitasi` : "Sitasi n/a"}</div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold">
        {paper.doi && <span className={`rounded-full px-2 py-1 ${paper.doiVerified ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>{paper.doiVerified ? "DOI tervalidasi" : "DOI belum tervalidasi"}</span>}
        <span className={`rounded-full px-2 py-1 ${paper.pdfStatus === "verified" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>PDF {paper.pdfStatus || "unknown"}</span>
        {paper.isOpenAccess ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Open access</span> : <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">Akses belum pasti</span>}
      </div>

      <div className="text-xs text-slate-600 mb-3" style={{ maxHeight: 96, overflow: "hidden" }}>
        {paper.abstract ? String(paper.abstract).slice(0, 600) : "Abstrak tidak tersedia."}
        {paper.abstract && paper.abstract.length > 600 ? "..." : ""}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 items-center text-xs">
          {paper.pdfUrl ? (
            <a href={paper.pdfUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-1 border rounded text-xs">
              Buka PDF
            </a>
          ) : paper.url ? (
            <a href={paper.url} target="_blank" rel="noopener noreferrer" className="px-2 py-1 border rounded text-xs">
              Buka halaman
            </a>
          ) : (
            <span className="text-xs text-slate-400">Tidak ada link</span>
          )}
          {paper.doi && (
            <a href={paper.doi.startsWith("http") ? paper.doi : `https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-blue-600 underline">
              DOI
            </a>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <button onClick={handleReject} className="px-3 py-1 border rounded text-sm text-red-600">
            Tolak
          </button>

          <button onClick={handleSave} className="px-3 py-1 bg-green-600 text-white rounded text-sm">
            Simpan
          </button>

          <button
            onClick={() => extractEvidence()}
            disabled={extracting}
            className={`px-3 py-1 border rounded text-sm ${extracting ? "bg-gray-200 text-gray-600" : "bg-indigo-600 text-white"}`}
          >
            {extracting ? "Memproses..." : "Ekstrak Evidence"}
          </button>
        </div>
      </div>

      {extractStatus && (
        <div className="mt-2 text-xs text-slate-600">
          {extractStatus}
        </div>
      )}
    </div>
  );
}
