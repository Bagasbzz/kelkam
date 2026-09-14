"use client";

import { useCallback, useEffect, useState } from "react";
import ReferenceCard, { ReferenceItem } from "./ReferenceCard";
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";

const STORAGE_KEY = "reference_search_results";

export default function ReferenceLibrary({ initialQuery }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const loadFromLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: ReferenceItem[] = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length) {
        setResults(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  const search = useCallback(async (requestedQuery = query) => {
    const normalizedQuery = requestedQuery.trim();
    if (!normalizedQuery) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await authenticatedFetch("/api/references/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalizedQuery, limit: 8, providers: ["semantic-scholar", "openalex"] }),
      });
      const data = await resp.json();
      if (data?.success && Array.isArray(data.data)) {
        setResults(data.data);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data.data));
        } catch {}
      } else {
        setError(data?.error || "Gagal mengambil referensi");
      }
    } catch (searchError: unknown) {
      setError(getErrorMessage(searchError, "Network error"));
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleSave = (paper: ReferenceItem) => {
    // simple local save into localStorage library for now
    try {
      const key = "reference_library_local";
      const raw = localStorage.getItem(key);
      const existing: ReferenceItem[] = raw ? JSON.parse(raw) : [];
      localStorage.setItem(key, JSON.stringify([paper, ...existing]));
      alert("Referensi disimpan ke library lokal");
    } catch {
      alert("Gagal menyimpan referensi lokal");
    }
  };

  const handleReject = (paperId: string) => {
    setResults((r) => r.filter((p) => p.id !== paperId));
  };

  const saveAllToSupabase = async () => {
    if (!results.length) {
      alert("Tidak ada hasil untuk disimpan.");
      return;
    }
    setSaving(true);
    setSaveStatus("Menyimpan ke Supabase...");
      try {
        // projectId from selector (fallback to default)
        const projectId = typeof window !== "undefined" ? localStorage.getItem("current_project_id") : null;
        if (!projectId) throw new Error("Pilih project terlebih dahulu.");
        const resp = await authenticatedFetch("/api/references/persist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, references: results }),
        });
      const data = await resp.json();
      if (data?.success) {
        setSaveStatus(`Sukses: ${data.inserted || 0} referensi disimpan`);
        // Optionally persist a flag locally
        try {
          localStorage.setItem(`${STORAGE_KEY}_last_saved_project`, projectId);
        } catch {}
      } else {
        setSaveStatus(`Gagal: ${data?.error || "Unknown error"}`);
      }
    } catch (saveError: unknown) {
      setSaveStatus(`Network error: ${getErrorMessage(saveError, "Gagal menyimpan referensi")}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // load from local aggregated search results if available
      loadFromLocal();

      // also try to load persisted references from Supabase for default project
      void (async () => {
        try {
          const projectId = typeof window !== "undefined" ? localStorage.getItem("current_project_id") : null;
          if (!projectId) return;
          const resp = await authenticatedFetch(`/api/references/list?projectId=${encodeURIComponent(projectId)}`);
          const j = await resp.json().catch(() => null);
          if (j?.success && Array.isArray(j.data) && j.data.length) {
            setResults(j.data);
          }
        } catch {
          // ignore, keep local results
        }
      })();
    }, 0);

    // listen for manual events to reload results after pipeline runs
    const handler = () => loadFromLocal();
    window.addEventListener("referenceResultsUpdated", handler);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("referenceResultsUpdated", handler);
    };
  }, [loadFromLocal]);

  useEffect(() => {
    if (initialQuery) {
      const timer = window.setTimeout(() => {
        setQuery(initialQuery);
        // automatically search small delay
        const searchTimer = window.setTimeout(() => void search(initialQuery), 400);
        window.setTimeout(() => window.clearTimeout(searchTimer), 401);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [initialQuery, search]);

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3">
        <div className="flex gap-2">
          <label htmlFor="reference-query" className="sr-only">Query referensi</label>
          <input id="reference-query" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 p-2 border rounded" placeholder='Query, mis: "student complaint system" AND (university OR campus)' />
          <button type="button" onClick={() => void search()} className="px-3 py-2 bg-blue-600 text-white rounded">Cari</button>
        </div>
        <div className="text-xs text-slate-400 mt-2">Atau jalankan Search Plan di Project Brief untuk mengisi daftar hasil secara otomatis.</div>
      </div>

      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-sm text-slate-600">
          {results.length} hasil
        </div>

        <div className="flex gap-2 items-center">
          <button onClick={saveAllToSupabase} disabled={saving || results.length === 0} className={`px-3 py-2 rounded text-white ${saving ? "bg-gray-400" : "bg-green-600"}`}>
            {saving ? "Menyimpan..." : "Simpan ke Supabase"}
          </button>
          <button onClick={() => { localStorage.removeItem(STORAGE_KEY); setResults([]); }} className="px-3 py-2 border rounded text-sm">
            Clear
          </button>
        </div>
      </div>

      {saveStatus && <div className="text-xs text-slate-500 mb-2">{saveStatus}</div>}
      {loading && <div className="text-sm text-slate-500">Mencari...</div>}
      {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

      <div className="grid grid-cols-1 gap-3">
        {results.map((paper) => (
          <ReferenceCard key={paper.id} paper={paper} onSave={handleSave} onReject={handleReject} />
        ))}
      </div>
    </div>
  );
}
