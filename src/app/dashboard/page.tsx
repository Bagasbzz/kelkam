"use client";

/**
 * /dashboard — "Laporan": asisten chat untuk menyusun laporan/skripsi.
 * Alur: ngobrol (AI bertanya) → rencana + sumber terverifikasi → setujui →
 * eksekusi (job tahan lama) → revisi per bagian via chat → unduh DOCX.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CheckCircle2, ChevronUp, Download, ExternalLink, FileText, Loader2, MessageSquarePlus, PanelLeft, PanelRightClose,
  Paperclip, Play, Send, ShieldCheck, Trash2, Upload, ListChecks, BookOpen, Table2, Workflow, Image as ImageIcon, X,
} from "lucide-react";
import { authenticatedFetch, useAuth } from "@/components/AuthProvider";
import ReportJobProgress from "@/components/ReportJobProgress";
import AgentRunProgress from "@/components/ui/AgentRunProgress";
import SimpleMarkdown from "@/components/ui/SimpleMarkdown";
import Button from "@/components/ui/Button";
import { getErrorMessage as baseErrorMessage } from "@/lib/errors";
import { jobAction, peekJob, runJobUntilDone, type ReportJob } from "@/lib/client/report-job";
import { controlRun, fetchActiveRun, followRun, isRunLive, type AgentEvent, type AgentRunPublic } from "@/lib/client/agent-run";
import type { VerifiedSource } from "@/lib/references/find-sources";
import type { ReportBrief, ReportPlan } from "@/lib/server/laporan/assistant";
import { DOCX_PRESETS, exportMarkdownToDocx } from "@/utils/markdown-docx-exporter";

const getErrorMessage = (e: unknown) => baseErrorMessage(e, "Terjadi kesalahan.");

interface SessionSummary { id: string; title: string | null; stage: string; jobId: string | null; updatedAt: string }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; toolCalls?: { tools?: string[]; events?: string[] } | null }
interface MaterialSummary { id: string; kind: string; title: string; fileName?: string; chars: number }
interface FigureJob { id: string; status: "queued" | "running" | "done" | "failed"; title: string; prompt: string; fileId: string | null; url: string | null; error: string | null; createdAt: string }
interface SessionDetail {
  id: string; title: string | null; stage: string; brief: ReportBrief; plan: ReportPlan | null;
  sources: VerifiedSource[]; materials: MaterialSummary[]; jobId: string | null; draft: string | null;
}
type Tab = "rencana" | "sumber" | "bahan" | "gambar" | "draft";

const TABS: ReadonlyArray<[Tab, string, typeof ListChecks]> = [
  ["rencana", "Rencana", ListChecks], ["sumber", "Sumber", BookOpen], ["bahan", "Bahan", Upload], ["gambar", "Gambar", ImageIcon], ["draft", "Draft", FileText],
];

/** Breakpoint `lg` Tailwind — di bawah ini panel samping jadi bottom sheet. */
const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

const STAGE_LABEL: Record<string, string> = { intake: "Ngobrol", planned: "Rencana siap", executing: "Menulis", drafted: "Draft jadi" };
const PDF_LABEL: Record<string, string> = { verified: "PDF ✓", landing_page: "Halaman", closed: "Berbayar", broken: "Rusak", unknown: "?" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authenticatedFetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = (await res.json().catch(() => null)) as (T & { success?: boolean; error?: string }) | null;
  if (!res.ok || !data?.success) throw new Error(data?.error || `Permintaan gagal (${res.status}).`);
  return data;
}

/** Rasterisasi SVG (string) → PNG bytes via canvas, skala 2x agar tajam di DOCX. */
async function svgToPng(svg: string, scale = 2): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("SVG tidak bisa dimuat"));
      el.src = url;
    });
    const width = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 600) * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Gagal encode PNG");
    return new Uint8Array(await png.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function LaporanPage() {
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [figures, setFigures] = useState<FigureJob[]>([]);
  const [polling, setPolling] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [deep, setDeep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("rencana");
  const [panelOpen, setPanelOpen] = useState(false);   // desktop: panel kanan terbuka
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop: daftar sesi terbuka
  const [sheet, setSheet] = useState<"sesi" | "panel" | null>(null); // mobile: bottom sheet
  const [fresh, setFresh] = useState<Tab | null>(null); // tab yang baru terisi → penanda di chip
  const [preset, setPreset] = useState<keyof typeof DOCX_PRESETS>("kampus4433");
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Agent run (chat) yang sedang di-stream
  const [run, setRun] = useState<AgentRunPublic | null>(null);
  const [runEvents, setRunEvents] = useState<AgentEvent[]>([]);
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [lastBeatAt, setLastBeatAt] = useState(0);
  const [runBusy, setRunBusy] = useState(false);
  const runAbortRef = useRef<AbortController | null>(null);

  /** Dipanggil sistem (tool/job selesai): pilih tab, buka panel di desktop, tandai "baru" di mobile. */
  const focusTab = useCallback((key: Tab) => {
    setTab(key);
    setFresh(key);
    if (isDesktop()) setPanelOpen(true);
  }, []);

  /** Dipanggil user (klik chip/rail): toggle panel desktop atau buka sheet mobile. */
  const openTab = (key: Tab) => {
    setFresh((f) => (f === key ? null : f));
    if (isDesktop()) {
      if (panelOpen && tab === key) { setPanelOpen(false); return; }
      setTab(key); setPanelOpen(true);
    } else {
      setTab(key); setSheet("panel");
    }
  };

  // ---------------------------------------------------------------- loaders
  const loadSessions = useCallback(async () => {
    const data = await api<{ sessions: SessionSummary[] }>("/api/laporan/sessions", { cache: "no-store" });
    setSessions(data.sessions);
    return data.sessions;
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const data = await api<{ session: SessionDetail; job: ReportJob | null; messages: ChatMessage[]; figures?: FigureJob[] }>(`/api/laporan/sessions/${id}`, { cache: "no-store" });
    setDetail(data.session);
    setMessages(data.messages);
    setJob(data.job);
    setFigures(data.figures ?? []);
    return data;
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    loadSessions().then((list) => {
      if (list.length && !activeId) setActiveId(list[0].id);
    }).catch((e) => setError(getErrorMessage(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  useEffect(() => {
    if (!activeId) { setDetail(null); setMessages([]); setJob(null); return; }
    abortRef.current?.abort();
    runAbortRef.current?.abort();
    setRun(null); setRunEvents([]); setSending(false);
    setError(null);
    loadDetail(activeId).catch((e) => setError(getErrorMessage(e)));
    // Auto-attach ke run yang masih berjalan (mis. setelah refresh / sinyal putus).
    fetchActiveRun(`/api/laporan/sessions/${activeId}/run`).then((active) => {
      if (active && isRunLive(active.status)) attachRun(activeId, () => authenticatedFetch(`/api/laporan/sessions/${activeId}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: active.id, action: "continue" }) }), active);
    }).catch(() => { /* abaikan */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, loadDetail]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending, runEvents.length]);

  // --------------------------------------------------------- job polling
  const pollJob = useCallback(async (jobId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPolling(true);
    try {
      const final = await runJobUntilDone(jobId, { onUpdate: setJob, signal: controller.signal, intervalMs: 1500 });
      setJob(final);
      if (activeId) await loadDetail(activeId);
      if (final.status === "done") focusTab("draft");
    } catch (e) {
      if (!controller.signal.aborted) setError(getErrorMessage(e));
    } finally {
      if (abortRef.current === controller) setPolling(false);
    }
  }, [activeId, loadDetail, focusTab]);

  useEffect(() => {
    if (!detail?.jobId || !job) return;
    if ((job.status === "queued" || job.status === "running") && !polling) pollJob(detail.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.jobId, job?.id]);

  useEffect(() => () => { abortRef.current?.abort(); runAbortRef.current?.abort(); }, []);

  // Selama job jalan, muat ulang sesi tiap step selesai agar diagram UML hasil engine tampil progresif.
  const jobDoneSteps = job?.doneSteps ?? 0;
  useEffect(() => {
    if (!activeId || !job || (job.status !== "running" && job.status !== "queued") || jobDoneSteps === 0) return;
    loadDetail(activeId).catch(() => { /* abaikan */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobDoneSteps]);

  // ------------------------------------------------------ figure polling
  const figuresPending = figures.some((f) => f.status === "queued" || f.status === "running");
  useEffect(() => {
    if (!figuresPending) return;
    const timer = window.setInterval(async () => {
      const pending = figures.filter((f) => f.status === "queued" || f.status === "running");
      const updated = await Promise.all(pending.map((f) => api<{ job: FigureJob }>(`/api/ai/generate-image/${f.id}`, { cache: "no-store" }).then((d) => d.job).catch(() => f)));
      setFigures((prev) => prev.map((f) => updated.find((u) => u.id === f.id) ?? f));
    }, 8000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [figuresPending, figures.length]);

  // --------------------------------------------------------------- actions
  const createSession = async () => {
    try {
      const data = await api<{ session: SessionSummary }>("/api/laporan/sessions", { method: "POST", body: "{}" });
      await loadSessions();
      setActiveId(data.session.id);
      setMessages([{ id: "hello", role: "assistant", content: "Halo! Ceritakan tugas atau laporan yang mau kamu kerjakan: jenis dokumennya apa (skripsi, laporan praktikum, makalah…), topiknya, dan untuk mata kuliah/kampus mana. Nanti saya tanya hal-hal lain yang perlu." }]);
    } catch (e) { setError(getErrorMessage(e)); }
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm("Hapus sesi ini beserta percakapan, rencana, dan draftnya?")) return;
    try {
      await api(`/api/laporan/sessions/${id}`, { method: "DELETE" });
      const list = await loadSessions();
      if (activeId === id) setActiveId(list[0]?.id ?? null);
    } catch (e) { setError(getErrorMessage(e)); }
  };

  /**
   * Ikuti run sampai selesai: stream event live, sambung ulang otomatis saat
   * segmen server habis / koneksi putus, lalu muat ulang riwayat & detail.
   * `initial` diisi saat auto-attach ke run yang sudah ada (id sudah diketahui).
   */
  const attachRun = async (sessionId: string, first: () => Promise<Response>, initial?: AgentRunPublic) => {
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;
    let runId = initial?.id ?? "";
    setSending(true);
    setRun(initial ?? null);
    setRunEvents(initial?.events ?? []);
    setRunStartedAt(initial ? new Date(initial.createdAt).getTime() : Date.now());
    setLastBeatAt(Date.now());
    try {
      const final = await followRun({
        first,
        continueUrl: `/api/laporan/sessions/${sessionId}/run`,
        runId: () => runId,
        signal: controller.signal,
        observer: {
          onRun: (r) => { runId = r.id; setRun(r); setRunEvents(r.events); setLastBeatAt(Date.now()); },
          onEvent: (ev) => { setRunEvents((prev) => [...prev.slice(-80), ev]); setLastBeatAt(Date.now()); },
          onHeartbeat: () => setLastBeatAt(Date.now()),
        },
      });
      if (controller.signal.aborted) return;
      const fresh = await loadDetail(sessionId);
      await loadSessions();
      const tools = final?.toolsUsed ?? [];
      if (tools.includes("proposePlan") || tools.includes("findSources")) focusTab(tools.includes("findSources") ? "sumber" : "rencana");
      if (tools.includes("reviseSection")) focusTab("draft");
      if (tools.includes("generateFigure") || tools.includes("approveDiagram")) focusTab("gambar");
      if (fresh.session.jobId && fresh.job && (fresh.job.status === "queued" || fresh.job.status === "running")) pollJob(fresh.session.jobId);
      if (final?.status === "failed") setError(final.error || "Proses gagal. Ketik \"lanjut\" untuk mencoba meneruskan.");
    } catch (e) {
      if (!controller.signal.aborted) setError(getErrorMessage(e));
    } finally {
      if (runAbortRef.current === controller) { setSending(false); setRun(null); setRunEvents([]); }
    }
  };

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || !activeId || sending) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setError(null);
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: "user", content: message }]);
    const sessionId = activeId;
    await attachRun(sessionId, () => authenticatedFetch(`/api/laporan/sessions/${sessionId}/message`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, deep }),
    }));
  };

  const pauseRun = async () => {
    if (!run || !activeId) return;
    setRunBusy(true);
    try { await controlRun(`/api/laporan/sessions/${activeId}/run`, run.id, "pause"); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setRunBusy(false); }
  };
  const cancelRun = async () => {
    if (!run || !activeId) return;
    setRunBusy(true);
    try { await controlRun(`/api/laporan/sessions/${activeId}/run`, run.id, "cancel"); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setRunBusy(false); }
  };

  const execute = async (ignoreMinSources = false) => {
    if (!activeId || executing) return;
    setExecuting(true); setError(null);
    try {
      const data = await api<{ jobId: string }>(`/api/laporan/sessions/${activeId}/execute`, { method: "POST", body: JSON.stringify({ ignoreMinSources }) });
      await loadDetail(activeId);
      setJob(await peekJob(data.jobId));
      pollJob(data.jobId);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setExecuting(false); }
  };

  const uploadMaterial = async (file: File) => {
    if (!activeId) return;
    setUploading(true); setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await authenticatedFetch("/api/context/extract", { method: "POST", body: form });
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { title: string; fileName: string; kind: string; content: string } } | null;
      if (!res.ok || !data?.success || !data.data) throw new Error(data?.error || "Gagal membaca file.");
      await api(`/api/laporan/sessions/${activeId}/materials`, {
        method: "POST", body: JSON.stringify({ kind: data.data.kind, title: data.data.title || file.name, content: data.data.content, fileName: data.data.fileName || file.name }),
      });
      await loadDetail(activeId);
      focusTab("bahan");
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setUploading(false); }
  };

  const removeMaterial = async (id: string) => {
    if (!activeId) return;
    try {
      await api(`/api/laporan/sessions/${activeId}/materials`, { method: "DELETE", body: JSON.stringify({ id }) });
      await loadDetail(activeId);
    } catch (e) { setError(getErrorMessage(e)); }
  };

  const exportDocx = async () => {
    if (!detail?.draft) return;
    setExporting(true);
    try {
      // Sertakan gambar AI yang sudah jadi; key = judul lowercase (cocok dengan placeholder [Gambar: Judul - …]).
      const images: Record<string, Uint8Array> = {};
      await Promise.all(figures.filter((f) => f.status === "done" && f.url).map(async (f) => {
        try {
          const res = await authenticatedFetch(f.url!, { cache: "force-cache" });
          if (res.ok) images[f.title.trim().toLowerCase()] = new Uint8Array(await res.arrayBuffer());
        } catch { /* gambar dilewati, placeholder tetap tercetak */ }
      }));
      // Diagram UML dari engine (SVG) → PNG
      await Promise.all((detail.plan?.diagrams ?? []).filter((d) => d.svg).map(async (d) => {
        try { images[d.title.trim().toLowerCase()] = await svgToPng(d.svg!); } catch { /* placeholder tetap tercetak */ }
      }));
      const title = detail.title || detail.brief.title || "Laporan";
      const cover = {
        title,
        subtitle: detail.brief.documentType ? `${detail.brief.documentType}${detail.brief.course ? ` — ${detail.brief.course}` : ""}` : undefined,
        author: user?.name || undefined,
        institution: detail.brief.institution || undefined,
        year: String(new Date().getFullYear()),
      };
      await exportMarkdownToDocx(detail.draft, title, { profile: { ...DOCX_PRESETS[preset].profile, cover }, images });
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setExporting(false); }
  };

  /** Buka diagram hasil engine di UML Builder untuk diedit. */
  const openInUmlBuilder = (d: NonNullable<ReportPlan["diagrams"]>[number]) => {
    localStorage.setItem("uml-ai-prefill", JSON.stringify({
      prompt: `Buat ${d.type} berjudul "${d.title}". Tujuan: ${d.purpose}`,
      diagramType: d.type,
      title: d.title,
      reportDiagramId: d.id,
      reportSessionId: activeId,
      diagramData: d.diagramData ? { nodes: d.diagramData.nodes, edges: d.diagramData.edges, meta: { title: d.diagramData.meta?.title || d.title, lanes: d.diagramData.meta?.lanes || [] } } : undefined,
    }));
    window.open("/uml-builder", "_blank", "noopener");
  };

  const draftSections = useMemo(() => (detail?.draft ? detail.draft.split("\n").filter((l) => /^#{1,3}\s/.test(l)).map((l) => l.replace(/^#+\s*/, "")) : []), [detail?.draft]);

  // ---------------------------------------------------------------- gates
  if (authLoading) return <div className="flex min-h-screen items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Masuk dulu</h1>
          <p className="text-sm text-slate-500">Asisten Laporan menyimpan percakapan, rencana, sumber, dan draft di akunmu.</p>
          <Button onClick={openLoginModal} variant="primary" size="md">Masuk</Button>
        </div>
      </div>
    );
  }

  const canExecute = detail && (detail.stage === "planned" || (detail.stage === "drafted")) && (detail.plan?.outline.length ?? 0) > 0;
  const jobActive = job && (job.status === "queued" || job.status === "running");

  const tabCount: Record<Tab, number | null> = {
    rencana: detail?.plan ? detail.plan.outline.length : null,
    sumber: detail?.sources.length ?? null,
    bahan: detail?.materials.length ?? null,
    gambar: detail ? (detail.plan?.diagrams.length ?? 0) + figures.length : null,
    draft: detail?.draft ? draftSections.length : null,
  };

  // ------------------------------------------------- blok yang dipakai ulang
  const sessionList = (
    <>
      <Button onClick={() => { createSession(); setSheet(null); }} variant="primary" size="md" className="w-full"><MessageSquarePlus className="h-4 w-4" /> Laporan baru</Button>
      <div className="mt-3 space-y-1">
        {sessions.map((s) => (
          <div key={s.id} className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 text-[15px] ${s.id === activeId ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>
            <button type="button" onClick={() => { setActiveId(s.id); setSheet(null); }} className="min-w-0 flex-1 text-left">
              <div className="truncate font-semibold">{s.title || "Tanpa judul"}</div>
              <div className={`text-xs ${s.id === activeId ? "text-slate-300" : "text-slate-500"}`}>{STAGE_LABEL[s.stage] || s.stage}</div>
            </button>
            <button type="button" onClick={() => deleteSession(s.id)} className="opacity-60 group-hover:opacity-100 lg:opacity-0" title="Hapus"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        {!sessions.length && <p className="px-2 py-4 text-sm text-slate-500">Belum ada sesi. Mulai dari “Laporan baru”.</p>}
      </div>
    </>
  );

  const jobCard = detail?.jobId && job ? (
    <ReportJobProgress
      job={job}
      polling={polling}
      compact
      onResume={() => detail.jobId && pollJob(detail.jobId)}
      onRetry={(redo) => detail.jobId && jobAction(detail.jobId, "retry", redo).then((j) => { setJob(j); pollJob(j.id); }).catch((e) => setError(getErrorMessage(e)))}
      onCancel={() => detail.jobId && jobAction(detail.jobId, "cancel").then(setJob).catch((e) => setError(getErrorMessage(e)))}
    />
  ) : null;

  /** Deretan chip pembuka panel: jelas bisa diklik (border, ikon, jumlah, chevron). */
  const tabChips = (
    <div className="flex gap-2 overflow-x-auto px-3 py-2.5 [scrollbar-width:none] lg:hidden">
      <button type="button" onClick={() => setSheet("sesi")} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 shadow-sm active:scale-95">
        <PanelLeft className="h-4 w-4" /> Sesi <span className="rounded-full bg-slate-100 px-1.5 text-xs">{sessions.length}</span><ChevronUp className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {TABS.map(([key, label, Icon]) => {
        const n = tabCount[key];
        const isFresh = fresh === key;
        return (
          <button key={key} type="button" onClick={() => openTab(key)} disabled={!detail}
            className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-bold shadow-sm transition active:scale-95 disabled:opacity-40 ${isFresh ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-700"}`}>
            <Icon className="h-4 w-4" /> {label}
            {n != null && <span className={`rounded-full px-1.5 text-xs ${isFresh ? "bg-blue-600 text-white" : "bg-slate-100"}`}>{n}</span>}
            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
            {isFresh && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />}
          </button>
        );
      })}
    </div>
  );

  const panelBody = (
    <>
              {!detail && <p className="text-xs text-slate-500">Belum ada sesi aktif.</p>}

              {detail && tab === "rencana" && (
                <div className="space-y-3">
                  <BriefView brief={detail.brief} />
                  {detail.plan ? (
                    <>
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700"><ListChecks className="h-3.5 w-3.5" /> Outline ({detail.plan.outline.length})</div>
                        <ol className="space-y-1">
                          {detail.plan.outline.map((s, i) => (
                            <li key={s.id} className="rounded-lg bg-slate-50 px-2 py-1.5">
                              <div className="font-semibold text-slate-900">{i + 1}. {s.title}</div>
                              {s.purpose && <div className="text-sm text-slate-600">{s.purpose}</div>}
                            </li>
                          ))}
                        </ol>
                      </div>
                      {detail.plan.diagrams.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700"><Workflow className="h-3.5 w-3.5" /> Diagram ({detail.plan.diagrams.length})</div>
                          <ul className="space-y-1 text-xs">{detail.plan.diagrams.map((d) => <li key={d.id} className="rounded-lg bg-slate-50 px-2 py-1"><b>{d.title}</b> <span className="text-slate-500">({d.type}{d.svg ? " · sudah dibuat" : ""})</span> — {d.purpose}</li>)}</ul>
                        </div>
                      )}
                      {detail.plan.tables.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700"><Table2 className="h-3.5 w-3.5" /> Tabel ({detail.plan.tables.length})</div>
                          <ul className="space-y-1 text-xs">{detail.plan.tables.map((t) => <li key={t.id} className="rounded-lg bg-slate-50 px-2 py-1"><b>{t.title}</b> — {t.purpose}{t.columns.length ? ` [${t.columns.join(", ")}]` : ""}</li>)}</ul>
                        </div>
                      )}
                      <p className="text-sm text-slate-500">Mau ubah? Bilang saja di chat, mis. “ganti BAB 3 jadi metode Waterfall” atau “tambah diagram sequence login”.</p>
                    </>
                  ) : <p className="text-xs text-slate-500">Rencana muncul setelah asisten cukup paham kebutuhanmu.</p>}
                </div>
              )}

              {detail && tab === "sumber" && (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-sm text-amber-800"><ShieldCheck className="mr-1 inline h-3 w-3" />Semua DOI diverifikasi ke Crossref. Peringkat SINTA/Scopus <b>tidak</b> dipastikan otomatis — cek lewat tautan di tiap sumber. Sistem hanya membaca abstrak.</p>
                  {!detail.sources.length && <p className="text-xs text-slate-500">Belum ada sumber. Asisten akan mencari setelah rencana dibuat.</p>}
                  {detail.sources.map((s) => (
                    <div key={s.id} className="rounded-xl border border-slate-100 p-2">
                      <div className="text-xs leading-snug text-slate-900">{s.citationApa}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.qualitySignals.map((q) => <span key={q} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{q}</span>)}
                        {s.pdfStatus && <span className={`rounded px-1.5 py-0.5 text-xs ${s.pdfStatus === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{PDF_LABEL[s.pdfStatus]}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2 text-sm font-semibold">
                        {s.doiUrl && <a href={s.doiUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"><ExternalLink className="h-3 w-3" />DOI</a>}
                        {s.pdfUrl && <a href={s.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"><Download className="h-3 w-3" />PDF</a>}
                        {s.checkLinks.map((c) => <a key={c.url} href={c.url} target="_blank" rel="noreferrer" className="text-slate-500 hover:underline">{c.label}</a>)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "bahan" && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">Unggah ZIP kode, PDF panduan, DOCX contoh, atau data mentah lewat tombol “Unggah bahan”. Isinya dipakai sebagai konteks penulisan.</p>
                  {!detail.materials.length && <p className="text-xs text-slate-500">Belum ada bahan.</p>}
                  {detail.materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2 py-1.5 text-xs">
                      <FileText className="h-3.5 w-3.5 text-slate-400" />
                      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{m.title}</div><div className="text-xs text-slate-500">{m.kind} · {m.chars.toLocaleString("id-ID")} karakter</div></div>
                      <button type="button" onClick={() => removeMaterial(m.id)} title="Hapus"><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-600" /></button>
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "gambar" && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">Diagram (UML & konsep/arsitektur) dan ilustrasi dari rencana dibuat otomatis saat eksekusi dan masuk DOCX lewat placeholder <code>[Gambar: Judul - keterangan]</code>. Ilustrasi tambahan bisa diminta di chat, mis. “buatkan ilustrasi proses X untuk BAB III”.</p>
                  {(detail.plan?.diagrams ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-xs font-bold text-slate-700"><Workflow className="h-3.5 w-3.5" /> Diagram ({detail.plan!.diagrams.length})</div>
                      {detail.plan!.diagrams.map((d) => (
                        <div key={d.id} className="rounded-xl border border-slate-100 p-2 text-xs">
                          <div className="flex items-center gap-2">
                            {d.svg ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : d.status === "failed" ? <span className="h-3.5 w-3.5 rounded-full bg-red-500" /> : <span className="h-3.5 w-3.5 rounded-full bg-slate-300" />}
                            <div className="min-w-0 flex-1 truncate font-semibold">{d.title} <span className="font-normal text-slate-500">({d.type})</span></div>
                            <span className="text-xs text-slate-500">{d.svg ? "selesai" : d.status === "failed" ? "gagal" : jobActive ? "dibuat…" : "belum dibuat"}</span>
                          </div>
                          {d.svg && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`} alt={d.title} className="mt-2 w-full rounded-lg border border-slate-100 bg-white" />
                          )}
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-xs text-slate-500">Placeholder: <code>[Gambar: {d.title} - keterangan]</code></span>
                            {((d.diagramData?.nodes?.length ?? 0) > 0 || (!jobActive && !d.svg)) && (
                              <button type="button" onClick={() => openInUmlBuilder(d)} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"><ExternalLink className="h-3 w-3" /> Buka di UML Builder</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!figures.length && !(detail.plan?.diagrams ?? []).length && <p className="text-xs text-slate-500">Belum ada gambar.</p>}
                  {figures.length > 0 && <div className="flex items-center gap-1 text-xs font-bold text-slate-700"><ImageIcon className="h-3.5 w-3.5" /> Ilustrasi AI ({figures.length})</div>}
                  {figures.map((f) => (
                    <div key={f.id} className="rounded-xl border border-slate-100 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        {f.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : f.status === "failed" ? <span className="h-3.5 w-3.5 rounded-full bg-red-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <div className="min-w-0 flex-1 truncate font-semibold">{f.title || "Gambar"}</div>
                        <span className="text-xs text-slate-500">{f.status === "queued" ? "antre" : f.status === "running" ? "diproses" : f.status === "done" ? "selesai" : "gagal"}</span>
                      </div>
                      {f.status === "failed" && f.error && <div className="mt-1 text-sm text-red-600">{f.error}</div>}
                      {f.status === "done" && f.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.title} className="mt-2 w-full rounded-lg border border-slate-100" /></a>
                      )}
                      {f.status === "done" && <div className="mt-1 text-xs text-slate-500">Placeholder: <code>[Gambar: {f.title} - keterangan]</code></div>}
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "draft" && (
                <div className="space-y-2">
                  {!detail.draft && <p className="text-xs text-slate-500">{jobActive ? "Sedang ditulis… pantau progres di atas." : "Draft muncul setelah eksekusi selesai."}</p>}
                  {detail.draft && (
                    <>
                      <div className="flex items-center gap-2">
                        <select value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof DOCX_PRESETS)} className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-xs">
                          {Object.entries(DOCX_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <Button onClick={exportDocx} variant="primary" size="sm" disabled={exporting}>{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} DOCX</Button>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {detail.draft.split(/\s+/).length.toLocaleString("id-ID")} kata · {draftSections.length} bagian</div>
                      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-2 text-sm leading-relaxed text-slate-800">{detail.draft}</pre>
                      <p className="text-sm text-slate-500">Untuk revisi: ketik di chat “Revisi bagian ‘{draftSections[1] || "BAB II"}’: …”.</p>
                    </>
                  )}
                </div>
              )}
    </>
  );

  const panelTabsBar = (
    <div className="flex border-b border-slate-100 text-sm font-bold">
      {TABS.map(([key, label, Icon]) => (
        <button key={key} type="button" onClick={() => { setTab(key); setFresh((f) => (f === key ? null : f)); }} className={`flex flex-1 items-center justify-center gap-1.5 px-1 py-3 ${tab === key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"}`}>
          <Icon className="h-4 w-4" />{label}{tabCount[key] != null ? <span className="text-xs text-slate-400">{tabCount[key]}</span> : null}
        </button>
      ))}
    </div>
  );

  const stageBadge = detail && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{STAGE_LABEL[detail.stage] || detail.stage}</span>;

  return (
    <div className="flex h-[100dvh] flex-col bg-slate-50 pt-[64px] md:pt-[72px]">
      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------ desktop: daftar sesi (bisa dilipat) */}
        <aside className={`hidden shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-[width] lg:block ${sidebarOpen ? "w-[300px]" : "w-0 !p-0 border-0"}`}>
          {sidebarOpen && sessionList}
        </aside>

        {/* ------------------------------------------------------------- chat */}
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3 md:px-5">
            <button type="button" onClick={() => setSidebarOpen((v) => !v)} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:inline-flex" title={sidebarOpen ? "Sembunyikan daftar sesi" : "Tampilkan daftar sesi"}><PanelLeft className="h-5 w-5" /></button>
            <div className="flex min-w-0 flex-1 items-center gap-2 text-base font-bold text-slate-900">
              <Bot className="h-5 w-5 shrink-0 text-blue-600" />
              <span className="truncate">{detail?.title || detail?.brief.title || "Asisten Laporan"}</span>
            </div>
            {stageBadge}
            {/* desktop: rail chip panel kanan */}
            <div className="ml-1 hidden items-center gap-1.5 lg:flex">
              {TABS.map(([key, label, Icon]) => {
                const n = tabCount[key]; const isFresh = fresh === key; const activeTab = panelOpen && tab === key;
                return (
                  <button key={key} type="button" onClick={() => openTab(key)} disabled={!detail} title={label}
                    className={`relative inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-bold transition disabled:opacity-40 ${activeTab ? "border-slate-900 bg-slate-900 text-white" : isFresh ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                    <Icon className="h-4 w-4" /> {label}{n != null ? <span className={`rounded-md px-1.5 text-xs ${activeTab ? "bg-white/20" : "bg-slate-100"}`}>{n}</span> : null}
                    {isFresh && !activeTab && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />}
                  </button>
                );
              })}
            </div>
          </header>

          {/* mobile: chip pembuka panel */}
          <div className="border-b border-slate-200 bg-white lg:hidden">{tabChips}</div>

          {/* progres job ringkas (selalu terlihat di atas chat saat ada job) */}
          {jobCard && jobActive && <div className="border-b border-slate-200 bg-white px-3 py-2 md:px-4"><div className="mx-auto max-w-3xl">{jobCard}</div></div>}

          <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
            <div className="mx-auto max-w-3xl space-y-4">
              {!activeId && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                  Pilih sesi atau buat “Laporan baru”. Asisten akan bertanya tentang jenis dokumen, topik, syarat jurnal (SINTA/Scopus), format kampus, lalu menyusun rencana dan sumber yang bisa kamu cek sendiri (DOI/PDF).
                  <div className="mt-3 flex justify-center gap-2">
                    <Button onClick={createSession} variant="primary" size="sm"><MessageSquarePlus className="h-4 w-4" /> Laporan baru</Button>
                    {sessions.length > 0 && <Button onClick={() => setSheet("sesi")} variant="outline" size="sm" className="lg:hidden">Pilih sesi</Button>}
                  </div>
                </div>
              )}
              {messages.map((m) => (
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-sm text-white">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"><Bot className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1 text-sm leading-relaxed text-slate-900">
                      <SimpleMarkdown text={m.content} />
                      {m.toolCalls?.tools?.length ? <div className="mt-1 text-xs text-slate-400">⚙ {m.toolCalls.tools.join(", ")}</div> : null}
                    </div>
                  </div>
                )
              ))}
              {sending && <AgentRunProgress run={run} events={runEvents} startedAt={runStartedAt} lastBeatAt={lastBeatAt} onPause={pauseRun} onCancel={cancelRun} busy={runBusy} />}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* ------------------------------------------------- komposer */}
          <div className="border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
            <div className="mx-auto max-w-3xl">
              {error && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}
              {detail && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {detail.stage === "intake" && <Chip onClick={() => send("Menurutmu info sudah cukup? Kalau iya, buatkan rencananya dan carikan sumbernya.")}>Buat rencana</Chip>}
                  {detail.stage === "planned" && <Chip onClick={() => send("Cari sumber tambahan yang lebih relevan dengan topik ini.")}>Cari sumber lagi</Chip>}
                  {canExecute && !jobActive && <Chip onClick={() => execute(false)} tone="primary" disabled={executing}><Play className="h-3 w-3" /> {detail.stage === "drafted" ? "Tulis ulang semua" : "Setujui & eksekusi"}</Chip>}
                  {detail.stage === "drafted" && draftSections[1] && <Chip onClick={() => setInput(`Revisi bagian "${draftSections[1]}": `)}>Revisi bagian…</Chip>}
                  {detail.draft && <Chip onClick={() => send("Kirim file DOCX laporan terbaru.")}>Kirim file DOCX</Chip>}
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Unggah bahan
                    <input type="file" className="hidden" accept=".pdf,.docx,.zip,.txt,.md" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMaterial(f); e.target.value = ""; }} />
                  </label>
                  <label className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Model teliti</label>
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-500">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={activeId ? "Tulis pesan… (Enter kirim, Shift+Enter baris baru)" : "Buat sesi dulu"}
                  disabled={!activeId || sending}
                  rows={1}
                  className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
                  onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
                />
                <Button type="submit" variant="primary" size="sm" disabled={!activeId || sending || !input.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
              </form>
            </div>
          </div>
        </section>

        {/* ------------------------------------ desktop: panel kanan (drawer) */}
        <aside className={`hidden shrink-0 flex-col border-l border-slate-200 bg-white transition-[width] lg:flex ${panelOpen ? "w-[420px] xl:w-[480px]" : "w-0 border-0"}`}>
          {panelOpen && (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Panel laporan</span>
                <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" title="Tutup panel"><PanelRightClose className="h-4 w-4" /></button>
              </div>
              {panelTabsBar}
              <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
                {jobCard && !jobActive && <div className="mb-3">{jobCard}</div>}
                {panelBody}
              </div>
            </>
          )}
        </aside>
      </div>

      {/* ---------------------------------------------- mobile: bottom sheet */}
      {sheet && (
        <div className="fixed inset-0 z-[150] lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Tutup" onClick={() => setSheet(null)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col rounded-t-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <span className="mx-auto h-1.5 w-10 rounded-full bg-slate-300" />
            </div>
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="text-sm font-black text-slate-900">{sheet === "sesi" ? "Sesi laporan" : "Panel laporan"}</span>
              <button type="button" onClick={() => setSheet(null)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Tutup"><X className="h-5 w-5" /></button>
            </div>
            {sheet === "panel" && panelTabsBar}
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[15px]">
              {sheet === "sesi" ? sessionList : (<>{jobCard && !jobActive && <div className="mb-3">{jobCard}</div>}{panelBody}</>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone?: "primary"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${tone === "primary" ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
      {children}
    </button>
  );
}

function BriefView({ brief }: { brief: ReportBrief }) {
  const rows: Array<[string, string | undefined]> = [
    ["Jenis", brief.documentType], ["Judul", brief.title], ["Topik", brief.topic], ["Mata kuliah", brief.course], ["Kampus", brief.institution],
    ["Sitasi", brief.citationStyle], ["Syarat jurnal", brief.journalRequirement ? `${brief.journalRequirement}${brief.minSources ? ` · min ${brief.minSources}` : ""}${brief.yearFrom ? ` · ≥${brief.yearFrom}` : ""}` : undefined],
    ["Format", brief.formatRules], ["Target", brief.targetLength],
  ];
  const filled = rows.filter(([, v]) => v);
  if (!filled.length) return <p className="text-xs text-slate-500">Brief masih kosong — ceritakan tugasmu di chat.</p>;
  return (
    <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-1 text-xs">
      {filled.map(([k, v]) => <FragmentRow key={k} k={k} v={v!} />)}
      {brief.notes?.length ? <FragmentRow k="Catatan" v={brief.notes.join("; ")} /> : null}
    </dl>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (<><dt className="font-bold text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></>);
}
