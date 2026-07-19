"use client";

import { useEffect, useMemo, useState } from "react";
import type { ResearchBrief, ReportSectionBrief } from "@/lib/types/research-project";

interface NoveltyCandidate {
  id: string;
  title: string;
  gap: string;
  novelty: string;
  rationale: string;
  supportingReferenceIds: string[];
}

interface ReferenceItem {
  id: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  publisherUrl?: string | null;
  pdfUrl?: string | null;
  citationApa?: string;
}

interface StoredOutline {
  sections: ReportSectionBrief[];
  citationMap?: Record<string, string[]>;
}

interface ReportJob {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  stage: string;
  result?: string;
  source?: string;
  error?: string;
}

const makeId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export default function ReportDraftWorkbench({ brief }: { brief?: Partial<ResearchBrief> }) {
  const [outline, setOutline] = useState<StoredOutline>({ sections: [], citationMap: {} });
  const [novelty, setNovelty] = useState<NoveltyCandidate | null>(null);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectId = useMemo(() => {
    try {
      return localStorage.getItem("current_project_id") || "proj_local_1";
    } catch {
      return "proj_local_1";
    }
  }, []);

  const draftKey = `research_report_draft_${projectId}`;
  const outlineKey = `research_outline_${projectId}`;
  const noveltyKey = `research_novelty_${projectId}`;
  const referencesKey = "reference_search_results";

  const loadLocalState = () => {
    try {
      const outlineRaw = localStorage.getItem(outlineKey);
      if (outlineRaw) {
        const parsed = JSON.parse(outlineRaw);
        setOutline({
          sections: Array.isArray(parsed?.sections) ? parsed.sections : [],
          citationMap: parsed?.citationMap && typeof parsed.citationMap === "object" ? parsed.citationMap : {},
        });
      } else {
        setOutline({ sections: [], citationMap: {} });
      }

      const noveltyRaw = localStorage.getItem(noveltyKey);
      if (noveltyRaw) {
        const parsed = JSON.parse(noveltyRaw);
        const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
        const selected = candidates.find((item: NoveltyCandidate) => item.id === parsed?.selectedId) || candidates[0] || null;
        setNovelty(selected);
      } else {
        setNovelty(null);
      }

      const refsRaw = localStorage.getItem(referencesKey);
      if (refsRaw) {
        const parsed = JSON.parse(refsRaw);
        setReferences(Array.isArray(parsed) ? parsed : []);
      } else {
        setReferences([]);
      }

      const draftRaw = localStorage.getItem(draftKey);
      if (draftRaw) {
        const parsed = JSON.parse(draftRaw);
        setDraft(typeof parsed?.content === "string" ? parsed.content : "");
      } else {
        setDraft("");
      }
    } catch {
      // ignore corrupted local state
    }
  };

  useEffect(() => {
    loadLocalState();

    const refresh = () => loadLocalState();
    window.addEventListener("researchOutlineUpdated", refresh);
    window.addEventListener("researchNoveltyUpdated", refresh);
    window.addEventListener("referenceResultsUpdated", refresh);
    window.addEventListener("researchProjectChanged", refresh);

    return () => {
      window.removeEventListener("researchOutlineUpdated", refresh);
      window.removeEventListener("researchNoveltyUpdated", refresh);
      window.removeEventListener("referenceResultsUpdated", refresh);
      window.removeEventListener("researchProjectChanged", refresh);
    };
  }, [projectId]);

  const assembledProject = useMemo(() => {
    const title = brief?.title || brief?.topic || "";
    const topic = brief?.topic || brief?.problemStatement || title;
    const sourceBlocks = [
      brief?.problemStatement ? {
        id: makeId("src"),
        kind: "brief",
        title: brief?.title || "Brief proyek",
        content: [
          brief?.topic ? `Topik: ${brief.topic}` : "",
          brief?.problemStatement ? `Masalah: ${brief.problemStatement}` : "",
          Array.isArray(brief?.objectives) && brief.objectives.length ? `Tujuan: ${brief.objectives.join("; ")}` : "",
          brief?.methodologyHint ? `Metode: ${brief.methodologyHint}` : "",
          brief?.notes ? `Catatan: ${brief.notes}` : "",
        ].filter(Boolean).join("\n"),
      } : null,
      novelty ? {
        id: makeId("src"),
        kind: "note",
        title: novelty.title,
        content: `Research gap: ${novelty.gap}\nNovelty: ${novelty.novelty}\nRationale: ${novelty.rationale}`,
      } : null,
      ...references.slice(0, 8).map((ref) => ({
        id: makeId("ref"),
        kind: "reference",
        title: ref.title,
        content: [
          ref.authors?.length ? `Penulis: ${ref.authors.join(", ")}` : "",
          ref.year ? `Tahun: ${ref.year}` : "",
          ref.venue ? `Venue: ${ref.venue}` : "",
          ref.abstract ? `Abstrak: ${ref.abstract}` : "",
        ].filter(Boolean).join("\n"),
      })),
    ].filter(Boolean);

    return {
      projectType: "formal",
      title,
      topic,
      course: "Riset Akademik",
      formality: "akademik",
      citationStyle: "APA",
      sources: sourceBlocks,
      outline: outline.sections.map((section) => ({
        id: section.id,
        title: section.title,
        purpose: section.purpose,
        requiredDiagrams: [],
        status: section.status || "draft",
      })),
      diagrams: [],
      tables: [],
      references: references.slice(0, 8).map((ref) => ({
        id: ref.id,
        query: ref.title,
        purpose: ref.venue || "Referensi riset",
        status: "saved",
        citation: ref.citationApa || "",
        url: ref.publisherUrl,
        pdfUrl: ref.pdfUrl,
        abstract: ref.abstract,
      })),
    };
  }, [brief, novelty, outline.sections, references]);

  const canGenerate = assembledProject.sources.length > 0 && assembledProject.outline.length > 0 && !loading;

  const pollJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const resp = await fetch(`/api/report-jobs/status/${jobId}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || "Gagal membaca progres laporan.");
      }

      const nextJob = data.job as ReportJob;
      setJob(nextJob);

      if (nextJob.status === "done") {
        const nextDraft = nextJob.result || "";
        setDraft(nextDraft);
        try {
          localStorage.setItem(draftKey, JSON.stringify({ content: nextDraft, updatedAt: new Date().toISOString() }));
        } catch {
          // ignore local save failures
        }
        return;
      }

      if (nextJob.status === "failed") {
        throw new Error(nextJob.error || "Generate laporan gagal.");
      }
    }

    throw new Error("Generate masih berjalan terlalu lama. Coba cek lagi sebentar.");
  };

  const generateDraft = async () => {
    setLoading(true);
    setError(null);
    setJob({ id: "pending", status: "queued", progress: 2, stage: "Memulai job laporan" });

    try {
      const resp = await fetch("/api/report-jobs/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: assembledProject }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success || !data?.job?.id) {
        throw new Error(data?.error || "Gagal memulai job laporan.");
      }

      setJob(data.job as ReportJob);
      await pollJob(data.job.id);
    } catch (e: any) {
      setError(e?.message || "Gagal generate draft");
    } finally {
      setLoading(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setError("Draft berhasil disalin ke clipboard.");
      window.setTimeout(() => setError(null), 1800);
    } catch {
      setError("Gagal menyalin draft ke clipboard.");
    }
  };

  const resetLocalFlow = () => {
    try {
      localStorage.removeItem(outlineKey);
      localStorage.removeItem(noveltyKey);
      localStorage.removeItem(referencesKey);
      localStorage.removeItem(draftKey);
      window.dispatchEvent(new Event("referenceResultsUpdated"));
      window.dispatchEvent(new Event("researchProjectChanged"));
      setOutline({ sections: [], citationMap: {} });
      setNovelty(null);
      setReferences([]);
      setDraft("");
      setJob(null);
      setError(null);
    } catch {
      setError("Gagal mereset konteks lokal.");
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">Draft Workbench</div>
          <div className="text-xs text-slate-500">Satukan brief, novelty, outline, dan referensi jadi draft laporan dengan progres yang kelihatan.</div>
        </div>
        <div className="flex gap-2">
          <button onClick={resetLocalFlow} disabled={loading} className="px-3 py-2 rounded border text-xs font-semibold disabled:opacity-50">Reset Konteks</button>
          <button onClick={generateDraft} disabled={!canGenerate} className="px-3 py-2 rounded bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
            {loading ? "Menyusun Draft..." : "Generate Draft"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 mb-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Sumber aktif</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{assembledProject.sources.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Outline</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{assembledProject.outline.length}</div>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Referensi</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{assembledProject.references.length}</div>
        </div>
      </div>

      {job && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-900">
            <span>{job.stage || "Generate laporan berjalan"}</span>
            <span>{Math.max(0, Math.min(100, Math.round(job.progress || 0)))}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {job.status === "done" ? "Draft selesai dan disimpan lokal." : job.status === "failed" ? "Job berhenti karena error." : "AI sedang membaca konteks, menyusun struktur, lalu menulis draft secara bertahap."}
          </div>
        </div>
      )}

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {!canGenerate && !loading && (
        <div className="mb-3 text-sm text-amber-700">Butuh outline dan minimal satu sumber aktif dulu. Jalankan novelty + outline dan pastikan ada brief atau referensi.</div>
      )}

      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Hasil Draft</div>
            <div className="text-xs text-slate-500">Draft disimpan lokal per project, jadi bisa lanjut revisi nanti tanpa generate ulang dari nol.</div>
          </div>
          <button onClick={copyDraft} disabled={!draft} className="px-3 py-2 rounded border text-xs font-semibold disabled:opacity-50">Salin Draft</button>
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Draft laporan akan muncul di sini setelah generate selesai..." className="min-h-[320px] w-full rounded-lg border border-slate-200 p-3 text-sm leading-relaxed text-slate-700" />
      </div>
    </div>
  );
}
