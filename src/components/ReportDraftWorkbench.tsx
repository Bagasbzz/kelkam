"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ResearchBrief, ReportSectionBrief } from "@/lib/types/research-project";
import { exportMarkdownToDocx } from "@/utils/markdown-docx-exporter";
import { authenticatedFetch } from "@/components/AuthProvider";
import { useCurrentProjectId } from "@/lib/client/use-current-project";

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

interface SectionActionDetail {
  action: "expand" | "citation" | "table";
  section: {
    id: string;
    title: string;
    purpose?: string;
    targetWords?: number;
    referenceIds?: string[];
  };
}

interface ApprovedDiagram {
  id: string;
  title: string;
  type: string;
  purpose?: string;
  caption?: string;
  status?: string;
  approvedAt?: string;
  diagramData?: {
    nodes?: Array<{ text?: string }>;
    edges?: unknown[];
    meta?: Record<string, unknown>;
  };
}

type RevisionMode = "format" | "expand" | "citation" | "table" | "bibliography" | "diagram" | "custom";

const REPORT_BUILDER_KEY = "report_builder_project_v1";
const makeId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

const revisionModeOptions: { value: RevisionMode; label: string; helper: string }[] = [
  { value: "format", label: "Rapikan format", helper: "Heading, numbering, bahasa, dan konsistensi." },
  { value: "expand", label: "Tambah isi", helper: "Perpanjang bagian yang masih tipis atau terlalu umum." },
  { value: "citation", label: "Tambah sitasi", helper: "Pakai referensi yang sudah tersimpan dulu." },
  { value: "table", label: "Tambah tabel", helper: "Masukkan tabel markdown yang relevan." },
  { value: "bibliography", label: "Rapikan pustaka", helper: "Benahi daftar pustaka sesuai gaya sitasi." },
  { value: "diagram", label: "Masukkan diagram", helper: "Sisipkan placeholder gambar dan caption yang pas." },
  { value: "custom", label: "Instruksi bebas", helper: "Kasih arahan spesifik sesuai kebutuhan user." },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDiagramData(value: unknown): ApprovedDiagram["diagramData"] | undefined {
  if (!isRecord(value)) return undefined;

  const nodes = Array.isArray(value.nodes)
    ? value.nodes
        .filter(isRecord)
        .map((node) => ({ text: typeof node.text === "string" ? node.text : undefined }))
    : undefined;

  return {
    nodes,
    edges: Array.isArray(value.edges) ? value.edges : undefined,
    meta: isRecord(value.meta) ? value.meta : undefined,
  };
}

function normalizeApprovedDiagrams(rawProject: unknown): ApprovedDiagram[] {
  const diagrams = isRecord(rawProject) && Array.isArray(rawProject.diagrams) ? rawProject.diagrams : [];
  return diagrams
    .filter((diagram): diagram is Record<string, unknown> => isRecord(diagram) && diagram.status === "approved" && Boolean(diagram.diagramData))
    .map((diagram) => ({
      id: String(diagram.id || makeId("diagram")),
      title: String(diagram.title || "Diagram"),
      type: String(diagram.type || "diagram"),
      purpose: diagram.purpose ? String(diagram.purpose) : undefined,
      caption: diagram.caption ? String(diagram.caption) : undefined,
      status: String(diagram.status || "approved"),
      approvedAt: diagram.approvedAt ? String(diagram.approvedAt) : undefined,
      diagramData: normalizeDiagramData(diagram.diagramData),
    }));
}

function inferSectionDiagramIds(section: ReportSectionBrief, diagrams: ApprovedDiagram[]) {
  const title = String(section.title || "").toLowerCase();
  if (/pendahuluan|kesimpulan|penutup|daftar pustaka/.test(title)) return [];
  if (/analisis|perancangan|metode|implementasi|hasil|pembahasan/.test(title)) {
    return diagrams.slice(0, 6).map((diagram) => diagram.id);
  }
  return diagrams.slice(0, 3).map((diagram) => diagram.id);
}

export default function ReportDraftWorkbench({ brief }: { brief?: Partial<ResearchBrief> }) {
  const [outline, setOutline] = useState<StoredOutline>({ sections: [], citationMap: {} });
  const [novelty, setNovelty] = useState<NoveltyCandidate | null>(null);
  const [references, setReferences] = useState<ReferenceItem[]>([]);
  const [approvedDiagrams, setApprovedDiagrams] = useState<ApprovedDiagram[]>([]);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisionMode, setRevisionMode] = useState<RevisionMode>("format");
  const [revisionTarget, setRevisionTarget] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [revisionProgress, setRevisionProgress] = useState(0);
  const [revisionStage, setRevisionStage] = useState("Menunggu instruksi revisi");
  const [activeSectionRefs, setActiveSectionRefs] = useState<ReferenceItem[]>([]);

  const projectId = useCurrentProjectId();

  const draftKey = `research_report_draft_${projectId || "unselected"}`;
  const outlineKey = `research_outline_${projectId || "unselected"}`;
  const noveltyKey = `research_novelty_${projectId || "unselected"}`;
  const referencesKey = "reference_search_results";

  const buildSectionReferences = useCallback((referenceIds: string[] = [], refsOverride?: ReferenceItem[]) => {
    const pool = refsOverride || references;
    const seen = new Set(referenceIds);
    return pool.filter((ref) => seen.has(ref.id)).slice(0, 6);
  }, [references]);

  const loadLocalState = useCallback(() => {
    try {
      const nextOutlineRaw = localStorage.getItem(outlineKey);
      const nextNoveltyRaw = localStorage.getItem(noveltyKey);
      const nextRefsRaw = localStorage.getItem(referencesKey);
      const nextDraftRaw = localStorage.getItem(draftKey);
      const nextReportBuilderRaw = localStorage.getItem(REPORT_BUILDER_KEY);

      const nextRefs = nextRefsRaw ? JSON.parse(nextRefsRaw) : [];
      const normalizedRefs = Array.isArray(nextRefs) ? nextRefs : [];
      setReferences(normalizedRefs);

      const nextDiagrams = nextReportBuilderRaw ? normalizeApprovedDiagrams(JSON.parse(nextReportBuilderRaw)) : [];
      setApprovedDiagrams(nextDiagrams);

      if (nextOutlineRaw) {
        const parsed = JSON.parse(nextOutlineRaw);
        const nextOutline = {
          sections: Array.isArray(parsed?.sections) ? parsed.sections : [],
          citationMap: parsed?.citationMap && typeof parsed.citationMap === "object" ? parsed.citationMap : {},
        };
        setOutline(nextOutline);

        if (revisionTarget) {
          const matchedSection = nextOutline.sections.find((section: ReportSectionBrief) => section.title === revisionTarget);
          if (matchedSection) {
            const referenceIds = nextOutline.citationMap?.[matchedSection.id] || matchedSection.allowedReferenceIds || [];
            setActiveSectionRefs(buildSectionReferences(referenceIds as string[], normalizedRefs));
          }
        }
      } else {
        setOutline({ sections: [], citationMap: {} });
      }

      if (nextNoveltyRaw) {
        const parsed = JSON.parse(nextNoveltyRaw);
        const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
        const selected = candidates.find((item: NoveltyCandidate) => item.id === parsed?.selectedId) || candidates[0] || null;
        setNovelty(selected);
      } else {
        setNovelty(null);
      }

      if (nextDraftRaw) {
        const parsed = JSON.parse(nextDraftRaw);
        setDraft(typeof parsed?.content === "string" ? parsed.content : "");
      } else {
        setDraft("");
      }
    } catch {
      // ignore corrupted local state
    }
  }, [buildSectionReferences, draftKey, noveltyKey, outlineKey, referencesKey, revisionTarget]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => loadLocalState(), 0);

    const refresh = () => loadLocalState();
    const handleSectionAction = (event: Event) => {
      const detail = (event as CustomEvent<SectionActionDetail>).detail;
      if (!detail?.section?.title) return;

      const modeMap: Record<SectionActionDetail["action"], RevisionMode> = {
        expand: "expand",
        citation: "citation",
        table: "table",
      };
      setRevisionMode(modeMap[detail.action]);
      setRevisionTarget(detail.section.title);

      const refs = buildSectionReferences(detail.section.referenceIds || []);
      setActiveSectionRefs(refs);

      const referenceHint = refs.length > 0
        ? `Gunakan referensi ini bila relevan: ${refs.map((ref) => ref.title).join("; ")}.`
        : "Jika belum cukup referensi, beri placeholder kebutuhan sitasi yang jelas.";

      const baseInstruction = detail.action === "expand"
        ? `Perpanjang bagian ${detail.section.title} agar lebih detail, tetap konsisten dengan tujuan section, dan jaga alur antar paragraf. ${referenceHint}`
        : detail.action === "citation"
          ? `Tambahkan sitasi yang cocok pada bagian ${detail.section.title}. Jangan mengarang sumber baru. ${referenceHint}`
          : `Tambahkan tabel markdown yang paling relevan untuk bagian ${detail.section.title}, lengkap dengan judul tabel yang jelas. ${referenceHint}`;

      setRevisionInstruction(baseInstruction);
      setFeedback(`Target revisi diatur ke ${detail.section.title}. Tinggal klik "Revisi Draft".`);
    };

    window.addEventListener("researchOutlineUpdated", refresh);
    window.addEventListener("researchNoveltyUpdated", refresh);
    window.addEventListener("referenceResultsUpdated", refresh);
    window.addEventListener("researchProjectChanged", refresh);
    window.addEventListener("researchSectionActionRequested", handleSectionAction as EventListener);
    window.addEventListener("storage", refresh);

    return () => {
      window.clearTimeout(loadTimer);
      window.removeEventListener("researchOutlineUpdated", refresh);
      window.removeEventListener("researchNoveltyUpdated", refresh);
      window.removeEventListener("referenceResultsUpdated", refresh);
      window.removeEventListener("researchProjectChanged", refresh);
      window.removeEventListener("researchSectionActionRequested", handleSectionAction as EventListener);
      window.removeEventListener("storage", refresh);
    };
  }, [buildSectionReferences, loadLocalState]);

  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ content: draft, updatedAt: new Date().toISOString() }));
    } catch {
      // ignore local save failures
    }
  }, [draft, draftKey]);

  useEffect(() => {
    if (!isRevising) return;

    const initTimer = window.setTimeout(() => {
      setRevisionProgress(12);
      setRevisionStage("Membaca draft dan konteks aktif");
    }, 0);

    const labels = [
      "Membaca draft dan konteks aktif",
      "Mengecek target bagian yang dipilih",
      "Merapikan isi sesuai instruksi",
      "Menjaga sitasi, tabel, dan struktur tetap stabil",
      "Menyusun hasil revisi akhir",
    ];

    const timer = window.setInterval(() => {
      setRevisionProgress((prev) => {
        const next = Math.min(prev + Math.max(4, Math.round((94 - prev) / 6)), 94);
        const labelIndex = Math.min(Math.floor(next / 20), labels.length - 1);
        setRevisionStage(labels[labelIndex]);
        return next;
      });
    }, 900);

    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(timer);
    };
  }, [isRevising]);

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
      ...approvedDiagrams.slice(0, 6).map((diagram) => ({
        id: makeId("diagram-src"),
        kind: "note",
        title: diagram.title,
        content: `Diagram ${diagram.type}. Caption: ${diagram.caption || diagram.purpose || "Belum ada caption"}. Elemen utama: ${(diagram.diagramData?.nodes || []).slice(0, 8).map((node) => node?.text).filter(Boolean).join("; ") || "Belum ada elemen"}`,
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
        requiredDiagrams: inferSectionDiagramIds(section, approvedDiagrams),
        status: section.status || "draft",
      })),
      diagrams: approvedDiagrams.map((diagram) => ({
        id: diagram.id,
        title: diagram.title,
        type: diagram.type,
        purpose: diagram.purpose,
        status: diagram.status || "approved",
        caption: diagram.caption,
        diagramData: diagram.diagramData,
      })),
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
  }, [brief, novelty, outline.sections, references, approvedDiagrams]);

  const canGenerate = assembledProject.sources.length > 0 && assembledProject.outline.length > 0 && !loading && !isRevising;
  const canRevise = draft.trim().length > 80 && !loading && !isRevising;

  const pollJob = async (jobId: string) => {
    for (let attempt = 0; attempt < 1800; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const resp = await authenticatedFetch(`/api/report-jobs/status/${jobId}`, { cache: "no-store" });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || "Gagal membaca progres laporan.");
      }

      const nextJob = data.job as ReportJob;
      setJob(nextJob);

      if (nextJob.status === "done") {
        const nextDraft = nextJob.result || "";
        setDraft(nextDraft);
        setFeedback("Draft selesai dibuat dan disimpan lokal.");
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
    setFeedback(null);
    setJob({ id: "pending", status: "queued", progress: 2, stage: "Memulai job laporan" });

    try {
      const resp = await authenticatedFetch("/api/report-jobs/start", {
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
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Gagal generate draft");
    } finally {
      setLoading(false);
    }
  };

  const reviseDraft = async () => {
    if (!canRevise) return;

    setIsRevising(true);
    setError(null);
    setFeedback(null);

    try {
      const resp = await authenticatedFetch("/api/ai/revise-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: assembledProject,
          draft,
          revisionMode,
          targetSection: revisionTarget,
          instruction: revisionInstruction,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || "Gagal merevisi draft.");
      }

      const nextDraft = String(data.data || "").trim();
      if (!nextDraft) {
        throw new Error("Respons revisi kosong.");
      }

      setDraft(nextDraft);
      setRevisionProgress(100);
      setRevisionStage("Revisi selesai dirapikan");
      setFeedback(revisionTarget ? `Bagian ${revisionTarget} berhasil direvisi.` : "Draft berhasil direvisi.");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Gagal merevisi draft.");
    } finally {
      window.setTimeout(() => setIsRevising(false), 400);
    }
  };

  const exportDocx = async () => {
    if (!draft.trim()) return;
    setIsExporting(true);
    setError(null);
    setFeedback(null);
    try {
      await exportMarkdownToDocx(draft, assembledProject.title || assembledProject.topic || "laporan-riset");
      setFeedback("DOCX berhasil diexport.");
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : "Gagal export DOCX.");
    } finally {
      setIsExporting(false);
    }
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setFeedback("Draft berhasil disalin ke clipboard.");
      window.setTimeout(() => setFeedback(null), 1800);
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
      setApprovedDiagrams([]);
      setDraft("");
      setJob(null);
      setError(null);
      setFeedback(null);
      setRevisionInstruction("");
      setRevisionTarget("");
      setRevisionProgress(0);
      setRevisionStage("Menunggu instruksi revisi");
      setActiveSectionRefs([]);
    } catch {
      setError("Gagal mereset konteks lokal.");
    }
  };

  return (
    <div className="p-4 border rounded-lg bg-white">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold">Draft Workbench</div>
          <div className="text-xs text-slate-500">Satukan brief, novelty, outline, referensi, dan diagram approved jadi draft laporan yang siap diexport.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={resetLocalFlow} disabled={loading || isRevising || isExporting} className="px-3 py-2 rounded border text-xs font-semibold disabled:opacity-50">Reset Konteks</button>
          <button onClick={generateDraft} disabled={!canGenerate} className="px-3 py-2 rounded bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
            {loading ? "Menyusun Draft..." : "Generate Draft"}
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4 mb-4">
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
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Diagram Approved</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{approvedDiagrams.length}</div>
        </div>
      </div>

      {approvedDiagrams.length > 0 && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-4">
          <div className="text-sm font-bold text-slate-900">Diagram Aktif dari UML Builder</div>
          <div className="mt-1 text-xs text-slate-500">Diagram approved ini otomatis dibawa ke generate laporan dan dipakai sebagai placeholder/caption pada section yang paling relevan.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {approvedDiagrams.map((diagram) => (
              <div key={diagram.id} className="rounded-full bg-white px-3 py-2 text-xs font-semibold text-slate-700 border border-violet-200">
                {diagram.title}
              </div>
            ))}
          </div>
        </div>
      )}

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
            {job.status === "done" ? "Draft selesai dan disimpan lokal." : job.status === "failed" ? "Job berhenti karena error." : "AI sedang membaca konteks, menyusun struktur, diagram, lalu menulis draft secara bertahap."}
          </div>
        </div>
      )}

      {isRevising && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-3 text-sm font-semibold text-slate-900">
            <span>{revisionStage}</span>
            <span>{Math.max(0, Math.min(100, Math.round(revisionProgress)))}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
            <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.max(0, Math.min(100, revisionProgress))}%` }} />
          </div>
          <div className="mt-2 text-xs text-slate-500">Revisi hanya mengubah draft yang sudah ada, jadi jauh lebih hemat token dibanding generate ulang penuh.</div>
        </div>
      )}

      {feedback && <div className="mb-3 text-sm text-emerald-700">{feedback}</div>}
      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}
      {!canGenerate && !loading && (
        <div className="mb-3 text-sm text-amber-700">Butuh outline dan minimal satu sumber aktif dulu. Jalankan novelty + outline dan pastikan ada brief atau referensi.</div>
      )}

      <div className="mb-4 rounded-lg border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Revisi Cepat</div>
            <div className="text-xs text-slate-500">Pilih jenis revisi, arahkan ke bagian tertentu, lalu minta AI merapikan tanpa mengulang seluruh proses.</div>
          </div>
          <button onClick={reviseDraft} disabled={!canRevise} className="px-3 py-2 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">
            {isRevising ? "Merevisi..." : "Revisi Draft"}
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {revisionModeOptions.map((option) => {
            const active = revisionMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setRevisionMode(option.value)}
                className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-emerald-600 bg-emerald-50" : "border-slate-200 hover:border-slate-400"}`}
              >
                <div className="text-sm font-bold text-slate-900">{option.label}</div>
                <div className="mt-1 text-xs text-slate-500">{option.helper}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Target Bagian</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setRevisionTarget("");
                  setActiveSectionRefs([]);
                }}
                className={`rounded-full px-3 py-2 text-xs font-semibold ${revisionTarget === "" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              >
                Seluruh draft
              </button>
              {outline.sections.map((section) => {
                const active = revisionTarget === section.title;
                const referenceIds = (outline.citationMap?.[section.id] || section.allowedReferenceIds || []) as string[];
                const refs = buildSectionReferences(referenceIds);
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => {
                      setRevisionTarget(section.title);
                      setActiveSectionRefs(refs);
                    }}
                    className={`rounded-full px-3 py-2 text-xs font-semibold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
                  >
                    {section.title}
                  </button>
                );
              })}
            </div>

            {revisionTarget && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Referensi untuk bagian ini</div>
                <div className="mt-2 space-y-2">
                  {activeSectionRefs.length > 0 ? activeSectionRefs.map((ref) => (
                    <div key={ref.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">{ref.title}</div>
                      <div className="mt-1 text-slate-500">{[ref.authors?.[0], ref.year, ref.venue].filter(Boolean).join(" | ") || ref.id}</div>
                    </div>
                  )) : <div className="text-xs text-slate-400">Belum ada mapping referensi spesifik untuk bagian ini.</div>}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400">Instruksi Tambahan</label>
            <textarea
              value={revisionInstruction}
              onChange={(e) => setRevisionInstruction(e.target.value)}
              placeholder="Contoh: perpanjang pendahuluan 2 paragraf, tambahkan sitasi dari referensi aktif, masukkan diagram approved yang relevan, atau buat tabel ringkasan metode."
              className="mt-2 min-h-28 w-full rounded-lg border border-slate-200 p-3 text-sm text-slate-700"
            />
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-bold">Hasil Draft</div>
            <div className="text-xs text-slate-500">Draft disimpan lokal per project, bisa disalin, direvisi, atau langsung diexport ke DOCX.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copyDraft} disabled={!draft} className="px-3 py-2 rounded border text-xs font-semibold disabled:opacity-50">Salin Draft</button>
            <button onClick={exportDocx} disabled={!draft || isExporting} className="px-3 py-2 rounded bg-violet-600 text-white text-xs font-semibold disabled:opacity-50">
              {isExporting ? "Exporting..." : "Export DOCX"}
            </button>
          </div>
        </div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Draft laporan akan muncul di sini setelah generate selesai..." className="min-h-[320px] w-full rounded-lg border border-slate-200 p-3 text-sm leading-relaxed text-slate-700" />
      </div>
    </div>
  );
}
