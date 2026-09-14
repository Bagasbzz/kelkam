"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, authenticatedFetch } from "@/components/AuthProvider";
import type { ResearchBrief, ReportSectionBrief } from "@/lib/types/research-project";
import { useCurrentProjectId } from "@/lib/client/use-current-project";
import { getErrorMessage } from "@/lib/errors";

interface NoveltyCandidate {
  id: string;
  title: string;
  gap: string;
  novelty: string;
  rationale: string;
  supportingReferenceIds: string[];
}

interface OutlineResponse {
  sections: ReportSectionBrief[];
  citationMap?: Record<string, string[]>;
}

export default function OutlineWorkbench({ brief }: { brief?: Partial<ResearchBrief> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<ReportSectionBrief[]>([]);
  const [citationMap, setCitationMap] = useState<Record<string, string[]>>({});
  const [source, setSource] = useState<string | null>(null);
  const [novelty, setNovelty] = useState<NoveltyCandidate | null>(null);

  const projectId = useCurrentProjectId();
  const { user } = useAuth();

  const storageKey = `research_outline_${projectId || "unselected"}`;

  const loadStoredOutline = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setSections(Array.isArray(parsed?.sections) ? parsed.sections : []);
      setCitationMap(parsed?.citationMap && typeof parsed.citationMap === "object" ? parsed.citationMap : {});
      setSource(typeof parsed?.source === "string" ? parsed.source : null);
    } catch {
      // ignore cache parse errors
    }
  }, [storageKey]);

  const loadStoredNovelty = useCallback(() => {
    try {
      const noveltyRaw = localStorage.getItem(`research_novelty_${projectId}`);
      if (!noveltyRaw) return;
      const parsed = JSON.parse(noveltyRaw);
      const nextCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
      const selectedCandidate = nextCandidates.find((item: NoveltyCandidate) => item.id === parsed?.selectedId) || nextCandidates[0] || null;
      setNovelty(selectedCandidate);
    } catch {
      // ignore novelty cache parse errors
    }
  }, [projectId]);

  useEffect(() => {
    const handleNovelty = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setNovelty(detail?.selectedCandidate || null);
    };

    window.addEventListener("researchNoveltyUpdated", handleNovelty);
    const outlineTimer = window.setTimeout(() => loadStoredOutline(), 0);
    const noveltyTimer = window.setTimeout(() => loadStoredNovelty(), 0);

    return () => {
      window.clearTimeout(outlineTimer);
      window.clearTimeout(noveltyTimer);
      window.removeEventListener("researchNoveltyUpdated", handleNovelty);
    };
  }, [loadStoredNovelty, loadStoredOutline, projectId]);

  const persistOutline = (nextSections: ReportSectionBrief[], nextCitationMap: Record<string, string[]>, nextSource: string | null) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        sections: nextSections,
        citationMap: nextCitationMap,
        source: nextSource,
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      // ignore local cache failures
    }

    window.dispatchEvent(new CustomEvent("researchOutlineUpdated", {
      detail: {
        projectId,
        sections: nextSections,
        citationMap: nextCitationMap,
        source: nextSource,
      },
    }));
  };

  const dispatchSectionAction = (section: ReportSectionBrief, action: "expand" | "citation" | "table") => {
    const sectionRefs = citationMap[section.id] || section.allowedReferenceIds || [];
    window.dispatchEvent(new CustomEvent("researchSectionActionRequested", {
      detail: {
        projectId,
        action,
        section: {
          id: section.id,
          title: section.title,
          purpose: section.purpose,
          targetWords: section.targetWords,
          referenceIds: sectionRefs,
        },
      },
    }));
  };

  const generateOutline = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!projectId) throw new Error("Pilih project terlebih dahulu.");
      if (!user) throw new Error("Login dulu untuk membuat outline otomatis.");

      const resp = await authenticatedFetch("/api/research/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, brief: brief || {}, novelty }),
      });
      const data = await resp.json().catch(() => null);
      if (!data?.success) {
        throw new Error(data?.error || "Gagal membuat outline");
      }

      const payload = data.data as OutlineResponse;
      const nextSections = Array.isArray(payload?.sections) ? payload.sections : [];
      const nextCitationMap = payload?.citationMap && typeof payload.citationMap === "object" ? payload.citationMap : {};

      setSections(nextSections);
      setCitationMap(nextCitationMap);
      setSource(data.source || null);
      persistOutline(nextSections, nextCitationMap, data.source || null);
    } catch (generationError: unknown) {
      setError(getErrorMessage(generationError, "Gagal membuat outline"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">Outline Workbench</div>
          <div className="text-xs text-slate-500">Susun kerangka laporan dan peta sitasi dari brief, evidence, dan novelty terpilih.</div>
        </div>
        <button onClick={generateOutline} disabled={loading} className="px-3 py-2 rounded bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
          {loading ? "Menyusun..." : "Generate Outline"}
        </button>
      </div>

      {novelty && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-bold">Novelty aktif</div>
          <div className="mt-1">{novelty.title}</div>
        </div>
      )}

      {source && <div className="mb-3 text-xs text-slate-400">Sumber outline: {source}</div>}
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {!loading && !error && sections.length === 0 && <div className="text-sm text-slate-400">Belum ada outline. Jalankan dulu setelah evidence dan novelty siap.</div>}

      <div className="space-y-3">
        {sections.map((section, index) => {
          const sectionRefs = citationMap[section.id] || section.allowedReferenceIds || [];
          return (
            <div key={section.id} className="rounded-lg border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Bagian {index + 1}</div>
                  <div className="mt-1 text-base font-bold text-slate-900">{section.title}</div>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {section.targetWords || 0} kata
                </div>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-slate-700">{section.purpose || "Belum ada deskripsi tujuan section."}</p>

              <div className="mt-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Referensi yang disarankan</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sectionRefs.length > 0 ? sectionRefs.map((refId) => (
                    <span key={`${section.id}-${refId}`} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{refId}</span>
                  )) : <span className="text-xs text-slate-400">Belum ada mapping referensi.</span>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => dispatchSectionAction(section, "expand")} className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white">Kembangkan bagian ini</button>
                <button onClick={() => dispatchSectionAction(section, "citation")} className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Tambah sitasi bagian ini</button>
                <button onClick={() => dispatchSectionAction(section, "table")} className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Tambah tabel terkait</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
