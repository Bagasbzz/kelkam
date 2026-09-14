"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth, authenticatedFetch } from "@/components/AuthProvider";
import type { ResearchBrief } from "@/lib/types/research-project";
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

export default function NoveltyWorkbench({ brief }: { brief?: Partial<ResearchBrief> }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<NoveltyCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);

  const projectId = useCurrentProjectId();
  const { user } = useAuth();

  const storageKey = `research_novelty_${projectId || "unselected"}`;

  const loadStoredNovelty = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const nextCandidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
      const nextSelectedId = typeof parsed?.selectedId === "string" ? parsed.selectedId : nextCandidates[0]?.id || null;
      setCandidates(nextCandidates);
      setSelectedId(nextSelectedId);
      setSource(typeof parsed?.source === "string" ? parsed.source : null);
    } catch {
      // ignore cache parse errors
    }
  }, [storageKey]);

  const dispatchNoveltyUpdate = useCallback((nextCandidates: NoveltyCandidate[], nextSelectedId: string | null, nextSource: string | null) => {
    const selectedCandidate = nextCandidates.find((item) => item.id === nextSelectedId) || null;

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        candidates: nextCandidates,
        selectedId: nextSelectedId,
        source: nextSource,
        updatedAt: new Date().toISOString(),
      }));
    } catch {
      // ignore local cache failures
    }

    window.dispatchEvent(new CustomEvent("researchNoveltyUpdated", {
      detail: {
        projectId,
        candidates: nextCandidates,
        selectedId: nextSelectedId,
        selectedCandidate,
        source: nextSource,
      },
    }));
  }, [projectId, storageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadStoredNovelty();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadStoredNovelty]);

  useEffect(() => {
    if (candidates.length === 0) return;
    dispatchNoveltyUpdate(candidates, selectedId || candidates[0]?.id || null, source);
  }, [candidates, dispatchNoveltyUpdate, selectedId, source]);

  const generateCandidates = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!projectId) throw new Error("Pilih project terlebih dahulu.");
      if (!user) throw new Error("Login dulu untuk membuat kandidat novelty.");

      const resp = await authenticatedFetch("/api/research/novelty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, brief: brief || {} }),
      });
      const data = await resp.json().catch(() => null);
      if (!data?.success) {
        throw new Error(data?.error || "Gagal membuat novelty candidates");
      }
      const nextCandidates = Array.isArray(data.data) ? data.data : [];
      const nextSelectedId = nextCandidates[0]?.id || null;
      setCandidates(nextCandidates);
      setSource(data.source || null);
      setSelectedId(nextSelectedId);
      dispatchNoveltyUpdate(nextCandidates, nextSelectedId, data.source || null);
    } catch (generationError: unknown) {
      setError(getErrorMessage(generationError, "Gagal membuat novelty candidates"));
    } finally {
      setLoading(false);
    }
  };

  const selected = candidates.find((item) => item.id === selectedId) || null;

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">Novelty Workbench</div>
          <div className="text-xs text-slate-500">Buat kandidat research gap dan novelty dari evidence yang sudah disimpan.</div>
        </div>
        <button onClick={generateCandidates} disabled={loading} className="px-3 py-2 rounded bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
          {loading ? "Menganalisis..." : "Generate Kandidat"}
        </button>
      </div>

      {source && <div className="mb-3 text-xs text-slate-400">Sumber analisis: {source}</div>}
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {!loading && !error && candidates.length === 0 && <div className="text-sm text-slate-400">Belum ada kandidat. Generate setelah evidence tersedia.</div>}

      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const active = candidate.id === selectedId;
            return (
              <button
                key={candidate.id}
                type="button"
                onClick={() => {
                  setSelectedId(candidate.id);
                  dispatchNoveltyUpdate(candidates, candidate.id, source);
                }}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-400"}`}
              >
                <div className="text-sm font-bold text-slate-900">{candidate.title}</div>
                <div className="mt-1 text-xs text-slate-500 line-clamp-3">{candidate.gap}</div>
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          {selected ? (
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Judul Kandidat</div>
                <div className="mt-1 text-base font-bold text-slate-900">{selected.title}</div>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Research Gap</div>
                <p className="mt-1 text-sm text-slate-700 leading-relaxed">{selected.gap}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Novelty</div>
                <p className="mt-1 text-sm text-slate-700 leading-relaxed">{selected.novelty}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Alasan</div>
                <p className="mt-1 text-sm text-slate-700 leading-relaxed">{selected.rationale}</p>
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Referensi Pendukung</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.supportingReferenceIds.map((refId) => (
                    <span key={refId} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{refId}</span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-400">Pilih kandidat di sebelah kiri untuk melihat detail novelty.</div>
          )}
        </div>
      </div>
    </div>
  );
}
