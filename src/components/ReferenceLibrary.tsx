"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import ReferenceCard, { ReferenceItem } from "./ReferenceCard";

export default function ReferenceLibrary({ initialQuery }: { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery || "");
  const [results, setResults] = useState<ReferenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const STORAGE_KEY = "reference_search_results";

  const loadFromLocal = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed: ReferenceItem[] = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed) && parsed.length) {
        setResults(parsed);
      }
    } catch {
      // ignore
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/references/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 8, providers: ["semantic-scholar", "openalex"] }),
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
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

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
        const projectId = (typeof window !== "undefined" ? localStorage.getItem("current_project_id") : null) || "proj_local_1";
        const resp = await fetch("/api/references/persist", {
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
    } catch (e: any) {
      setSaveStatus(`Network error: ${e?.message || String(e)}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus(null), 4000);
    }
  };

  useEffect(() => {
    // load from local aggregated search results if available
    loadFromLocal();

    // also try to load persisted references from Supabase for default project
    (async () => {
      try {
        const projectId = (typeof window !== "undefined" ? localStorage.getItem("current_project_id") : null) || "proj_local_1";
        const resp = await fetch(`/api/references/list?projectId=${encodeURIComponent(projectId)}`);
        const j = await resp.json().catch(() => null);
        if (j?.success && Array.isArray(j.data) && j.data.length) {
          setResults(j.data);
        }
      } catch {
        // ignore, keep local results
      }
    })();

    // listen for manual events to reload results after pipeline runs
    const handler = () => loadFromLocal();
    window.addEventListener("referenceResultsUpdated", handler);
    return () => window.removeEventListener("referenceResultsUpdated", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      // automatically search small delay
      setTimeout(() => search(), 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3">
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1 p-2 border rounded" placeholder='Query, mis: "student complaint system" AND (university OR campus)' />
          <button onClick={search} className="px-3 py-2 bg-blue-600 text-white rounded">Cari</button>
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