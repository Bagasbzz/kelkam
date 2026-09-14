"use client";

import { useEffect, useState } from "react";
import type { ResearchBrief } from "@/lib/types/research-project";
import { authenticatedFetch } from "@/components/AuthProvider";
import type { ReferenceItem } from "./ReferenceCard";
import { getErrorMessage } from "@/lib/errors";

interface SearchPlanGroup {
  queries: string[];
  targetCount: number;
  yearFrom: number | null;
  yearTo: number | null;
  openAccessOnly: boolean;
}

function isSearchPlanGroup(value: unknown): value is SearchPlanGroup {
  if (!value || typeof value !== "object") return false;
  const group = value as Partial<SearchPlanGroup>;
  return Array.isArray(group.queries) && group.queries.every((query) => typeof query === "string");
}

const emptyBrief: Partial<ResearchBrief> = {
  title: "",
  topic: "",
  problemStatement: "",
  objectives: [],
  methodologyHint: "",
  preferredKeywords: [],
  notes: "",
};

export default function ProjectBrief({
  projectId,
  value,
  onChange,
}: {
  projectId?: string | null;
  value?: Partial<ResearchBrief>;
  onChange?: (brief: Partial<ResearchBrief>) => void;
}) {
  const storageKey = `research_brief_${projectId || "local"}`;
  const brief = value || emptyBrief;
  const [isRunningSearchPlan, setIsRunningSearchPlan] = useState(false);
  const [searchPlanStatus, setSearchPlanStatus] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          onChange?.({ ...emptyBrief, ...parsed });
        }
      } catch {
        // ignore
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [onChange, storageKey]);

  async function runSearchPlan() {
    try {
      setIsRunningSearchPlan(true);
      setSearchPlanStatus("Menghasilkan search plan...");
      const resp = await authenticatedFetch("/api/research/search-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await resp.json();
      if (!data?.success || !Array.isArray(data.data)) {
        throw new Error(data?.error || "Gagal membuat search plan");
      }
      const plan = data.data.filter(isSearchPlanGroup);

      setSearchPlanStatus("Menjalankan query provider...");
      const aggregated: ReferenceItem[] = [];
      const seen = new Set<string>();

      for (const group of plan) {
        const queries: string[] = Array.isArray(group.queries) ? group.queries.slice(0, 6) : [];
        const perQueryLimit = Math.max(1, Math.ceil((group.targetCount || 5) / Math.max(1, queries.length)));
        for (const q of queries) {
          setSearchPlanStatus(`Mencari: ${q}`);
          try {
            const r = await authenticatedFetch("/api/references/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query: q,
                limit: perQueryLimit,
                yearFrom: group.yearFrom || null,
                yearTo: group.yearTo || null,
                openAccessOnly: Boolean(group.openAccessOnly),
                providers: ["semantic-scholar", "openalex"],
              }),
            });
            const jr = await r.json();
            if (jr?.success && Array.isArray(jr.data)) {
              for (const p of jr.data) {
                const key = String(p.doi || p.id || (p.title || "").slice(0, 120)).toLowerCase();
                if (!seen.has(key)) {
                  seen.add(key);
                  aggregated.push(p);
                }
              }
            }
          } catch (e) {
            console.warn("Provider query failed:", e);
          }
          await new Promise((res) => setTimeout(res, 600));
        }
      }

      try {
        localStorage.setItem("reference_search_results", JSON.stringify(aggregated));
        window.dispatchEvent(new Event("referenceResultsUpdated"));
        setSearchPlanStatus(`Selesai: ${aggregated.length} hasil disimpan`);
      } catch {
        setSearchPlanStatus("Gagal menyimpan hasil ke localStorage");
      }
    } catch (searchError: unknown) {
      setSearchPlanStatus(getErrorMessage(searchError, "Gagal menjalankan search plan"));
    } finally {
      setIsRunningSearchPlan(false);
    }
  }

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(brief));
    } catch {
      // ignore
    }
  }, [brief, storageKey]);

  const update = (patch: Partial<ResearchBrief>) => {
    const next = { ...(brief || {}), ...patch };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // ignore
    }
    onChange?.(next);
  };

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3">
        <div className="text-sm font-bold">Project Brief</div>
        <div className="text-xs text-slate-500">Ringkasan kebutuhan proyek - disimpan lokal.</div>
      </div>

      <label className="block text-xs font-semibold mb-1">Judul sementara</label>
      <input value={brief.title || ""} onChange={(e) => update({ title: e.target.value })} className="w-full p-2 border rounded mb-3" placeholder="Contoh: Sistem Pengaduan Mahasiswa berbasis Web" />

      <label className="block text-xs font-semibold mb-1">Topik / Kata kunci</label>
      <input value={brief.topic || ""} onChange={(e) => update({ topic: e.target.value })} className="w-full p-2 border rounded mb-3" placeholder="Contoh: pengaduan, kampus, mahasiswa" />

      <label className="block text-xs font-semibold mb-1">Rumusan masalah singkat</label>
      <textarea value={brief.problemStatement || ""} onChange={(e) => update({ problemStatement: e.target.value })} className="w-full p-2 border rounded mb-3" placeholder="Tuliskan 1-2 kalimat masalah yang ingin dipecahkan" />

      <label className="block text-xs font-semibold mb-1">Metode yang diinginkan (opsional)</label>
      <input value={brief.methodologyHint || ""} onChange={(e) => update({ methodologyHint: e.target.value })} className="w-full p-2 border rounded mb-3" placeholder="Contoh: studi kasus, kuantitatif, design science" />

      <label className="block text-xs font-semibold mb-1">Preferensi keyword (comma separated)</label>
      <input
        value={(brief.preferredKeywords || []).join(", ")}
        onChange={(e) => update({ preferredKeywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        className="w-full p-2 border rounded mb-3"
        placeholder="keyword1, keyword2"
      />

      <label className="block text-xs font-semibold mb-1">Catatan tambahan</label>
      <textarea value={brief.notes || ""} onChange={(e) => update({ notes: e.target.value })} className="w-full p-2 border rounded mb-3" placeholder="Instruksi dosen, batasan, target SINTA, dsb." />

      <div className="flex gap-2 items-center">
        <button
          onClick={() => {
            update({ finalized: true, updatedAt: new Date().toISOString() });
            alert("Brief disimpan dan ditandai final (lokal).");
          }}
          className="px-3 py-1 bg-green-600 text-white rounded text-sm"
        >
          Tandai Final
        </button>

        <button
          onClick={() => {
            localStorage.removeItem(storageKey);
            onChange?.(emptyBrief);
          }}
          className="px-3 py-1 border rounded text-sm"
        >
          Reset Brief
        </button>

        <button
          onClick={() => runSearchPlan()}
          className={`px-3 py-1 bg-blue-600 text-white rounded text-sm ${isRunningSearchPlan ? "opacity-60 cursor-not-allowed" : ""}`}
          disabled={isRunningSearchPlan}
        >
          {isRunningSearchPlan ? "Menjalankan..." : "Jalankan Search Plan"}
        </button>

        <div className="ml-3 text-sm text-slate-600">
          {searchPlanStatus ? <span>{searchPlanStatus}</span> : <span className="text-xs text-slate-400">Status: belum dijalankan</span>}
        </div>
      </div>
    </div>
  );
}
