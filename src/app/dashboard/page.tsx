"use client";

/**
 * /dashboard, "Laporan": asisten chat untuk menyusun laporan/skripsi.
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
import JournalCheck from "@/components/JournalCheck";
import type { JournalVerification } from "@/lib/references/journal-check";
import { getErrorMessage as baseErrorMessage, toPublicAssistantMessage } from "@/lib/errors";
import { jobAction, peekJob, runJobUntilDone, type ReportJob } from "@/lib/client/report-job";
import { controlRun, fetchActiveRun, followRun, isRunLive, type AgentEvent, type AgentRunPublic } from "@/lib/client/agent-run";
import type { VerifiedSource } from "@/lib/references/find-sources";
import type { ReportBrief, ReportPlan } from "@/lib/server/laporan/assistant";
import { DOCX_PRESETS } from "@/utils/markdown-docx-exporter";
import { attachmentError, clipboardFiles, MAX_CHAT_ATTACHMENTS } from "@/lib/client/report-attachments";
import { isDiagramType } from "@/lib/types/diagram";

/** Format bahan Laporan: dokumen, spreadsheet, arsip, teks/kode, dan gambar (dibaca AI vision). */
const MATERIAL_ACCEPT = [
  ".pdf", ".docx", ".pptx", ".xlsx", ".zip", ".txt", ".md", ".csv", ".json",
  ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".java", ".kt", ".php", ".c", ".cpp", ".cs", ".go", ".rb", ".dart",
  ".sql", ".prisma", ".html", ".css", ".scss", ".vue", ".svelte", ".xml", ".yml", ".yaml",
  ".png", ".jpg", ".jpeg", ".webp", ".gif",
  "image/png", "image/jpeg", "image/webp", "image/gif",
].join(",");

const getErrorMessage = (e: unknown) => baseErrorMessage(e, "Terjadi kesalahan.");

interface SessionSummary { id: string; title: string | null; stage: string; jobId: string | null; updatedAt: string }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; toolCalls?: { tools?: string[]; events?: string[] } | null }
interface MaterialSummary { id: string; kind: string; title: string; fileName?: string; chars: number }
interface PendingAttachment { id: string; file: File; preview: string | null }
interface FigureJob { id: string; status: "queued" | "running" | "done" | "failed"; title: string; prompt: string; fileId: string | null; url: string | null; error: string | null; createdAt: string }
interface SessionDetail {
  id: string; title: string | null; stage: string; brief: ReportBrief; plan: ReportPlan | null;
  sources: VerifiedSource[]; materials: MaterialSummary[]; jobId: string | null; draft: string | null;
}
type Tab = "rencana" | "sumber" | "bahan" | "gambar" | "draft";

const TABS: ReadonlyArray<[Tab, string, typeof ListChecks]> = [
  ["rencana", "Rencana", ListChecks], ["sumber", "Sumber", BookOpen], ["bahan", "Bahan", Upload], ["gambar", "Gambar", ImageIcon], ["draft", "Draft", FileText],
];

/** Breakpoint `lg` Tailwind, di bawah ini panel samping jadi bottom sheet. */
const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;

const STAGE_LABEL: Record<string, string> = { intake: "Ngobrol", planned: "Rencana siap", executing: "Menulis", drafted: "Draft jadi" };
const PDF_LABEL: Record<string, string> = { verified: "PDF terbuka", landing_page: "Halaman penerbit", closed: "Berbayar", broken: "Tautan rusak", unknown: "PDF ?" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authenticatedFetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = (await res.json().catch(() => null)) as (T & { success?: boolean; error?: string }) | null;
  if (!res.ok || !data?.success) throw new Error(data?.error || `Permintaan gagal (${res.status}).`);
  return data;
}

export default function LaporanPage() {
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [job, setJob] = useState<ReportJob | null>(null);
  const [figures, setFigures] = useState<FigureJob[]>([]);
  const [downloadingSources, setDownloadingSources] = useState(false);
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
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingRef = useRef<PendingAttachment[]>([]);
  const sendLockRef = useRef(false);
  const uploadAbortRef = useRef<AbortController | null>(null);
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

  const removePendingAttachment = (id: string) => {
    const item = pendingRef.current.find((attachment) => attachment.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    pendingRef.current = pendingRef.current.filter((attachment) => attachment.id !== id);
    setPendingAttachments(pendingRef.current);
  };

  const stageAttachments = (files: File[]) => {
    if (!activeId || sending || sendLockRef.current) return;
    if (pendingRef.current.length + files.length > MAX_CHAT_ATTACHMENTS) { setError(`Maksimal ${MAX_CHAT_ATTACHMENTS} lampiran per pesan.`); return; }
    for (const file of files) {
      const invalid = attachmentError(file, user?.role === "ADMIN");
      if (invalid) { setError(invalid); return; }
    }
    const added = files.map((file) => ({ id: crypto.randomUUID(), file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }));
    pendingRef.current = [...pendingRef.current, ...added];
    setPendingAttachments(pendingRef.current);
    setError(null);
    inputRef.current?.focus();
  };

  useEffect(() => () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    sendLockRef.current = false;
    pendingRef.current.forEach((item) => { if (item.preview) URL.revokeObjectURL(item.preview); });
    pendingRef.current = [];
  }, [activeId]);

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
    if (activeIdRef.current !== id) return data;
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
    setPendingAttachments([]);
    if (!activeId) { setDetail(null); setMessages([]); setJob(null); return; }
    abortRef.current?.abort();
    runAbortRef.current?.abort();
    setRun(null); setRunEvents([]); setSending(false); setUploading(false);
    setError(null);
    loadDetail(activeId).catch((e) => setError(getErrorMessage(e)));
    // Auto-attach ke run yang masih berjalan (mis. setelah refresh / sinyal putus).
    fetchActiveRun(`/api/laporan/sessions/${activeId}/run`).then((active) => {
      if (activeIdRef.current !== activeId) return;
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
      if (final?.status === "failed") setError(getErrorMessage(final.error));
    } catch (e) {
      if (!controller.signal.aborted) setError(getErrorMessage(e));
    } finally {
      if (runAbortRef.current === controller) { setSending(false); setRun(null); setRunEvents([]); }
    }
  };

  const send = async (text?: string) => {
    const attachments = [...pendingRef.current];
    const message = (text ?? input).trim() || (attachments.length ? "Tolong baca dan analisis bahan yang saya lampirkan." : "");
    if (!message || !activeId || sending || sendLockRef.current) return;
    const sessionId = activeId;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    sendLockRef.current = true;
    setSending(true); setError(null);
    try {
      if (attachments.length) {
        setUploading(true);
        // Session materials use read-modify-write storage, so save attachments serially.
        for (const attachment of attachments) {
          await uploadMaterial(attachment.file, sessionId, controller.signal);
          if (controller.signal.aborted) return;
          removePendingAttachment(attachment.id);
        }
      }
      if (controller.signal.aborted) return;
      setUploading(false);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: "user", content: message }]);
      await attachRun(sessionId, () => authenticatedFetch(`/api/laporan/sessions/${sessionId}/message`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, deep }),
      }));
    } catch (e) {
      if (!controller.signal.aborted) { setError(getErrorMessage(e)); setInput((current) => current || message); }
    } finally {
      if (uploadAbortRef.current === controller) {
        sendLockRef.current = false;
        setUploading(false); setSending(false);
      }
    }
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

  const uploadMaterial = async (file: File, sessionId: string, signal: AbortSignal) => {
    const invalid = attachmentError(file, user?.role === "ADMIN");
    if (invalid) throw new Error(invalid);
    const form = new FormData();
    form.append("file", file);
    const res = await authenticatedFetch("/api/context/extract", { method: "POST", body: form, signal });
    const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; data?: { title: string; fileName: string; kind: string; content: string; fileId?: string } } | null;
    if (!res.ok || !data?.success || !data.data) throw new Error(data?.error || "Gagal membaca file.");
    await api(`/api/laporan/sessions/${sessionId}/materials`, {
      // fileId: file asli disimpan agar AI bisa membuka ulang isi ZIP/PDF/gambar secara utuh.
      method: "POST", signal, body: JSON.stringify({ kind: data.data.kind, title: data.data.title || file.name, content: data.data.content, fileName: data.data.fileName || file.name, fileId: data.data.fileId }),
    });
  };

  const removeMaterial = async (id: string) => {
    if (!activeId) return;
    try {
      await api(`/api/laporan/sessions/${activeId}/materials`, { method: "DELETE", body: JSON.stringify({ id }) });
      await loadDetail(activeId);
    } catch (e) { setError(getErrorMessage(e)); }
  };

  /** Centang/lepas centang sumber (optimistic, lalu simpan ke server). */
  const toggleSources = async (ids: string[], selected: boolean) => {
    if (!activeId || !ids.length) return;
    const set = new Set(ids);
    setDetail((prev) => prev ? { ...prev, sources: prev.sources.map((s) => (set.has(s.id) ? { ...s, selected } : s)) } : prev);
    try {
      await api(`/api/laporan/sessions/${activeId}`, { method: "PATCH", body: JSON.stringify({ sources: ids.map((id) => ({ id, selected })) }) });
    } catch (e) {
      setError(getErrorMessage(e));
      await loadDetail(activeId).catch(() => { /* abaikan */ });
    }
  };

  const exportDocx = async () => {
    if (!detail?.draft) return;
    setExporting(true);
    try {
      const res = await authenticatedFetch(`/api/laporan/sessions/${detail.id}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: detail.draft, preset }),
      });
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string; url?: string; name?: string; missingImageTitles?: string[]; pendingFigureTitles?: string[] } | null;
      if (!res.ok || !data?.success || !data.url) throw new Error(data?.error || "Gagal membuat DOCX.");
      const link = document.createElement("a");
      link.href = data.url;
      link.download = data.name || "laporan.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      const notes = [
        data.missingImageTitles?.length ? `${data.missingImageTitles.length} gambar belum tersedia: ${data.missingImageTitles.slice(0, 3).join(", ")}` : "",
        data.pendingFigureTitles?.length ? `${data.pendingFigureTitles.length} ilustrasi masih diproses` : "",
      ].filter(Boolean);
      if (notes.length) setError(`DOCX dibuat, tetapi ${notes.join("; ")}.`);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setExporting(false); }
  };

  const saveJournalVerification = async (id: string, journalVerification: JournalVerification | null) => {
    if (!activeId) return;
    const sessionId = activeId;
    try {
      await api(`/api/laporan/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ sources: [{ id, journalVerification }] }) });
      await loadDetail(sessionId);
    } catch (e) { setError(getErrorMessage(e)); }
  };

  const downloadSources = async (ids: string[], zip: boolean) => {
    if (!activeId || !ids.length || downloadingSources) return;
    setDownloadingSources(true);
    try {
      const res = await authenticatedFetch(`/api/laporan/sessions/${activeId}/sources/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, zip }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(data?.error || "PDF tidak bisa diunduh.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || (zip ? "referensi-laporan.zip" : "referensi.pdf");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      const skipped = Number(res.headers.get("x-skipped-count") || 0);
      if (skipped) setError(`${skipped} PDF tidak dapat diunduh. Rinciannya ada di daftar-sumber.json dalam ZIP; gunakan Buka PDF sebagai alternatif.`);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setDownloadingSources(false); }
  };

  /** Buka diagram hasil engine di UML Builder untuk diedit. */
  const openInUmlBuilder = (d: NonNullable<ReportPlan["diagrams"]>[number]) => {
    localStorage.setItem("uml-ai-prefill", JSON.stringify({
      prompt: `Buat ${d.type} berjudul "${d.title}". Tujuan: ${d.purpose}`,
      diagramType: d.type,
      title: d.title,
      reportDiagramId: d.id,
      reportSessionId: activeId,
      diagramData: d.diagramData ? { nodes: d.diagramData.nodes, edges: d.diagramData.edges, meta: { title: d.diagramData.meta?.title || d.title, lanes: d.diagramData.meta?.lanes || [], laneWidth: d.diagramData.meta?.laneWidth } } : undefined,
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
    sumber: detail ? detail.sources.filter((s) => s.selected !== false).length : null,
    bahan: detail?.materials.length ?? null,
    gambar: detail ? (detail.plan?.diagrams.length ?? 0) + figures.length + (detail.plan?.figures ?? []).filter((f) => f.fileId).length : null,
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
              {!detail && <p className="text-sm text-slate-500">Belum ada sesi aktif.</p>}

              {detail && tab === "rencana" && (
                <div className="space-y-3">
                  <BriefView brief={detail.brief} />
                  {detail.plan ? (
                    <>
                      <div>
                        <div className="mb-1 flex items-center gap-1 text-sm font-bold text-slate-700"><ListChecks className="h-4 w-4" /> Outline ({detail.plan.outline.length})</div>
                        <ol className="space-y-1">
                          {detail.plan.outline.map((s, i) => (
                            <li key={s.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                              <div className="font-semibold text-slate-900">{i + 1}. {s.title}</div>
                              {s.purpose && <div className="text-[15px] text-slate-600">{s.purpose}</div>}
                            </li>
                          ))}
                        </ol>
                      </div>
                      {detail.plan.diagrams.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-sm font-bold text-slate-700"><Workflow className="h-4 w-4" /> Diagram ({detail.plan.diagrams.length})</div>
                          <ul className="space-y-1 text-sm">{detail.plan.diagrams.map((d) => <li key={d.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5"><b>{d.title}</b> <span className="text-slate-500">({d.type}{d.svg ? " · sudah dibuat" : ""})</span>, {d.purpose}</li>)}</ul>
                        </div>
                      )}
                      {detail.plan.tables.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-sm font-bold text-slate-700"><Table2 className="h-4 w-4" /> Tabel ({detail.plan.tables.length})</div>
                          <ul className="space-y-1 text-sm">{detail.plan.tables.map((t) => <li key={t.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5"><b>{t.title}</b>, {t.purpose}{t.columns.length ? ` [${t.columns.join(", ")}]` : ""}</li>)}</ul>
                        </div>
                      )}
                      <p className="text-sm text-slate-500">Mau ubah? Bilang saja di chat, mis. “ganti BAB 3 jadi metode Waterfall” atau “tambah diagram sequence login”.</p>
                    </>
                  ) : <p className="text-sm text-slate-500">Rencana muncul setelah asisten cukup paham kebutuhanmu.</p>}
                </div>
              )}

              {detail && tab === "sumber" && (() => {
                const selectedCount = detail.sources.filter((s) => s.selected !== false).length;
                const fullCount = detail.sources.filter((s) => s.readLevel === "fulltext").length;
                const downloadable = detail.sources.filter((s) => s.selected !== false && s.pdfStatus === "verified");
                return (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 px-2.5 py-2 text-sm text-amber-800"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />DOI valid bukan berarti jurnal terakreditasi SINTA atau terindeks Scopus. Cek <b>nama jurnal dan semua ISSN</b> di bawah, lalu simpan hasil beserta tautan bukti resminya. Jika pencarian resmi kosong, gunakan pencarian alternatif berdasarkan nama. Label teks penuh hanya muncul bila PDF berhasil dibaca.</p>
                 {detail.sources.length > 0 && (
                     <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                        <span><b>{selectedCount}</b> dari {detail.sources.length} dipakai, <b>{fullCount}</b> dibaca penuh</span>
                       <span><b>{detail.sources.filter((s) => s.journalVerification).length}</b> hasil cek jurnal tersimpan</span>
                       <button type="button" onClick={() => toggleSources(detail.sources.map((s) => s.id), true)} className="font-semibold text-blue-600 hover:underline">Pilih semua</button>
                       <button type="button" onClick={() => toggleSources(detail.sources.map((s) => s.id), false)} className="font-semibold text-slate-500 hover:underline">Hapus pilihan</button>
                       {downloadable.length > 0 && <button type="button" disabled={downloadingSources || downloadable.length > 10} onClick={() => void downloadSources(downloadable.map((s) => s.id), true)} className="font-semibold text-emerald-700 hover:underline disabled:opacity-50">{downloadingSources ? "Menyiapkan ZIP..." : `Unduh ${downloadable.length} PDF terpilih (ZIP, maks. 10)`}</button>}
                     </div>
                   )}
                  {!detail.sources.length && <p className="text-sm text-slate-500">Belum ada sumber. Asisten akan mencari setelah rencana dibuat.</p>}
                  {detail.sources.map((s) => {
                    const on = s.selected !== false;
                    return (
                    <div key={s.id} className={`flex gap-2 rounded-xl border p-2.5 ${on ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-70"}`}>
                      <input type="checkbox" checked={on} onChange={(e) => toggleSources([s.id], e.target.checked)} className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-blue-600" aria-label="Pakai sumber ini" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm leading-snug text-slate-900">{s.citationApa}</div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.readLevel === "fulltext"
                            ? <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[13px] font-semibold text-blue-700">Teks penuh dibaca{s.fullTextChars ? ` (${Math.round(s.fullTextChars / 1000)}k karakter)` : ""}</span>
                            : <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-600">Hanya abstrak</span>}
                          {typeof s.relevance === "number" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-600">Relevansi {s.relevance}</span>}
                          {s.qualitySignals.filter((q) => q !== "Teks penuh dibaca AI").map((q) => <span key={q} className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px] text-slate-600">{q}</span>)}
                          {s.pdfStatus && <span className={`rounded px-1.5 py-0.5 text-[13px] ${s.pdfStatus === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{PDF_LABEL[s.pdfStatus]}</span>}
                        </div>
                         <JournalCheck key={`${detail.id}:${s.id}`} source={s} verification={s.journalVerification} onVerificationChange={(value) => void saveJournalVerification(s.id, value)} onDownload={() => void downloadSources([s.id], false)} downloading={downloadingSources} />
                      </div>
                    </div>
                    );
                  })}
                </div>
                );
              })()}

              {detail && tab === "bahan" && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">Unggah ZIP kode, PDF panduan, DOCX contoh, atau data mentah lewat tombol “Unggah bahan”. Isinya dipakai sebagai konteks penulisan.</p>
                  {!detail.materials.length && <p className="text-sm text-slate-500">Belum ada bahan.</p>}
                  {detail.materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2.5 py-2 text-sm">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{m.title}</div><div className="text-[13px] text-slate-500">{m.kind} · {m.chars.toLocaleString("id-ID")} karakter</div></div>
                      <button type="button" onClick={() => removeMaterial(m.id)} title="Hapus"><Trash2 className="h-4 w-4 text-slate-400 hover:text-red-600" /></button>
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "gambar" && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">Diagram (UML & konsep/arsitektur) dan ilustrasi dari rencana dibuat otomatis saat eksekusi dan masuk DOCX lewat placeholder <code>[Gambar: Judul - keterangan]</code>. Ilustrasi tambahan bisa diminta di chat, mis. “buatkan ilustrasi proses X untuk BAB III”.</p>
                  {(detail.plan?.diagrams ?? []).length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-sm font-bold text-slate-700"><Workflow className="h-4 w-4" /> Diagram ({detail.plan!.diagrams.length})</div>
                      {detail.plan!.diagrams.map((d) => (
                        <div key={d.id} className="rounded-xl border border-slate-100 p-2.5 text-sm">
                          <div className="flex items-center gap-2">
                            {d.svg ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : d.status === "failed" ? <span className="h-3.5 w-3.5 rounded-full bg-red-500" /> : <span className="h-3.5 w-3.5 rounded-full bg-slate-300" />}
                            <div className="min-w-0 flex-1 truncate font-semibold">{d.title} <span className="font-normal text-slate-500">({d.type})</span></div>
                            <span className="text-[13px] text-slate-500">{d.svg ? "selesai" : d.status === "failed" ? "gagal" : jobActive ? "dibuat…" : "belum dibuat"}</span>
                          </div>
                          {d.svg && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`} alt={d.title} className="mt-2 w-full rounded-lg border border-slate-100 bg-white" />
                          )}
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="text-[13px] text-slate-500">Placeholder: <code>[Gambar: {d.title} - keterangan]</code></span>
                            {isDiagramType(d.type) && ((d.diagramData?.nodes?.length ?? 0) > 0 || (!jobActive && !d.svg)) && (
                              <button type="button" onClick={() => openInUmlBuilder(d)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:underline"><ExternalLink className="h-3.5 w-3.5" /> Buka di UML Builder</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {(detail.plan?.figures ?? []).filter((f) => f.fileId).map((f) => (
                    <div key={f.id} className="rounded-xl border border-emerald-100 p-2.5 text-sm">
                      <div className="font-semibold">{f.title} <span className="font-normal text-emerald-700">Gambar bahan</span></div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files/${f.fileId}`} alt={f.caption || f.title} className="mt-2 w-full rounded-lg border border-slate-100" />
                      <p className="mt-1 text-slate-500">{f.caption}. Disertakan otomatis saat ekspor DOCX.</p>
                    </div>
                  ))}
                  {!figures.length && !(detail.plan?.diagrams ?? []).length && !(detail.plan?.figures ?? []).some((f) => f.fileId) && <p className="text-sm text-slate-500">Belum ada gambar.</p>}
                  {figures.length > 0 && <div className="flex items-center gap-1 text-sm font-bold text-slate-700"><ImageIcon className="h-4 w-4" /> Ilustrasi AI ({figures.length})</div>}
                  {figures.map((f) => (
                    <div key={f.id} className="rounded-xl border border-slate-100 p-2.5 text-sm">
                      <div className="flex items-center gap-2">
                        {f.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : f.status === "failed" ? <span className="h-3.5 w-3.5 rounded-full bg-red-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <div className="min-w-0 flex-1 truncate font-semibold">{f.title || "Gambar"}</div>
                        <span className="text-[13px] text-slate-500">{f.status === "queued" ? "antre" : f.status === "running" ? "diproses" : f.status === "done" ? "selesai" : "gagal"}</span>
                      </div>
                      {f.status === "failed" && f.error && <div className="mt-1 text-sm text-red-600">{getErrorMessage(f.error)}</div>}
                      {f.status === "done" && f.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.title} className="mt-2 w-full rounded-lg border border-slate-100" /></a>
                      )}
                      {f.status === "done" && <div className="mt-1 text-[13px] text-slate-500">Placeholder: <code>[Gambar: {f.title} - keterangan]</code></div>}
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "draft" && (
                <div className="space-y-2">
                  {!detail.draft && <p className="text-sm text-slate-500">{jobActive ? "Sedang ditulis… pantau progres di atas." : "Draft muncul setelah eksekusi selesai."}</p>}
                  {detail.draft && (
                    <>
                      <div className="flex items-center gap-2">
                        <select value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof DOCX_PRESETS)} className="flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
                          {Object.entries(DOCX_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        <Button onClick={exportDocx} variant="primary" size="sm" disabled={exporting}>{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} DOCX</Button>
                      </div>
                      <div className="flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {detail.draft.split(/\s+/).length.toLocaleString("id-ID")} kata · {draftSections.length} bagian</div>
                      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-[15px] leading-relaxed text-slate-800">{detail.draft}</pre>
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
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-[15px] text-white">{m.content}</div>
                  </div>
                ) : (
                  <div key={m.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"><Bot className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-slate-900">
                      <SimpleMarkdown text={toPublicAssistantMessage(m.content)} />
                      {m.toolCalls?.tools?.length ? <div className="mt-1 text-[13px] text-slate-400">⚙ {m.toolCalls.tools.join(", ")}</div> : null}
                    </div>
                  </div>
                )
              ))}
              {sending && (uploading ? <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Membaca lampiran...</div> : <AgentRunProgress run={run} events={runEvents} startedAt={runStartedAt} lastBeatAt={lastBeatAt} onPause={pauseRun} onCancel={cancelRun} busy={runBusy} />)}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* ------------------------------------------------- komposer */}
          <div className="border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
            <div className="mx-auto max-w-3xl">
              {error && <div role="alert" className="mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{getErrorMessage(error)}</div>}
              {detail && (
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {detail.stage === "intake" && <Chip onClick={() => send("Menurutmu info sudah cukup? Kalau iya, buatkan rencananya dan carikan sumbernya.")}>Buat rencana</Chip>}
                  {detail.stage === "planned" && <Chip onClick={() => send("Cari sumber tambahan yang lebih relevan dengan topik ini.")}>Cari sumber lagi</Chip>}
                  {canExecute && !jobActive && <Chip onClick={() => execute(false)} tone="primary" disabled={executing}><Play className="h-3 w-3" /> {detail.stage === "drafted" ? "Tulis ulang semua" : "Setujui & eksekusi"}</Chip>}
                  {detail.stage === "drafted" && draftSections[1] && <Chip onClick={() => setInput(`Revisi bagian "${draftSections[1]}": `)}>Revisi bagian…</Chip>}
                  {detail.draft && <Chip onClick={() => send("Kirim file DOCX laporan terbaru.")}>Kirim file DOCX</Chip>}
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Lampirkan bahan
                    <input type="file" className="hidden" accept={MATERIAL_ACCEPT} multiple disabled={sending} onChange={(e) => { stageAttachments(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                  </label>
                  <label className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Model teliti</label>
                </div>
              )}
              <form onSubmit={(e) => { e.preventDefault(); send(); }} onPaste={(e) => { const files = clipboardFiles(e.clipboardData); if (files.length) { e.preventDefault(); stageAttachments(files); } }} className="rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-500">
                {pendingAttachments.length > 0 && <div className="mb-2 border-b border-slate-100 pb-2">
                  <div className="flex max-h-44 gap-2 overflow-x-auto p-1" aria-label="Lampiran belum dikirim">
                    {pendingAttachments.map((attachment) => <div key={attachment.id} className="relative w-28 shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-2">
                      {attachment.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={attachment.preview} alt={`Pratinjau ${attachment.file.name}`} className="h-16 w-full rounded-md object-contain" />
                      ) : <FileText className="mx-auto h-16 w-8 text-slate-400" />}
                      <span className="mt-1 block truncate text-xs text-slate-600" title={attachment.file.name}>{attachment.file.name}</span>
                      <button type="button" disabled={sending} onClick={() => removePendingAttachment(attachment.id)} aria-label={`Hapus lampiran ${attachment.file.name}`} className="absolute -right-1 -top-1 rounded-full border border-slate-200 bg-white p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
                    </div>)}
                  </div>
                  <p className="px-2 pt-1 text-xs text-slate-500">Belum diunggah. Lampiran dikirim saat kamu menekan Kirim.</p>
                </div>}
                <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={activeId ? "Tulis pesan… (Enter kirim, Shift+Enter baris baru)" : "Buat sesi dulu"}
                  disabled={!activeId || sending}
                  rows={1}
                  className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
                  onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
                />
                <Button type="submit" aria-label="Kirim pesan" variant="primary" size="sm" disabled={!activeId || sending || (!input.trim() && !pendingAttachments.length)}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
                </div>
              </form>
            </div>
          </div>
        </section>

        {/* ------------------------------------ desktop: panel kanan (drawer) */}
        <aside className={`hidden shrink-0 flex-col border-l border-slate-200 bg-white transition-[width] lg:flex ${panelOpen ? "w-[460px] xl:w-[520px]" : "w-0 border-0"}`}>
          {panelOpen && (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span className="text-xs font-black uppercase tracking-wide text-slate-500">Panel laporan</span>
                <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" title="Tutup panel"><PanelRightClose className="h-4 w-4" /></button>
              </div>
              {panelTabsBar}
              <div className="min-h-0 flex-1 overflow-y-auto p-3 text-[15px]">
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
    ["Penyusun", [brief.studentName, brief.studentId && `NIM ${brief.studentId}`].filter(Boolean).join(" · ") || undefined],
    ["Dosen", brief.lecturer], ["Prodi", [brief.program, brief.faculty].filter(Boolean).join(" · ") || undefined],
    ["Sitasi", brief.citationStyle], ["Syarat jurnal", brief.journalRequirement ? `${brief.journalRequirement}${brief.minSources ? ` · min ${brief.minSources}` : ""}${brief.yearFrom ? ` · ≥${brief.yearFrom}` : ""}` : undefined],
    ["Format", brief.formatRules], ["Target", brief.targetLength],
  ];
  const filled = rows.filter(([, v]) => v);
  if (!filled.length) return <p className="text-sm text-slate-500">Brief masih kosong, ceritakan tugasmu di chat.</p>;
  return (
    <dl className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1.5 text-sm">
      {filled.map(([k, v]) => <FragmentRow key={k} k={k} v={v!} />)}
      {brief.notes?.length ? <FragmentRow k="Catatan" v={brief.notes.join("; ")} /> : null}
    </dl>
  );
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (<><dt className="font-bold text-slate-500">{k}</dt><dd className="text-slate-900">{v}</dd></>);
}
