"use client";

/**
 * /dashboard — "Laporan": asisten chat untuk menyusun laporan/skripsi.
 * Alur: ngobrol (AI bertanya) → rencana + sumber terverifikasi → setujui →
 * eksekusi (job tahan lama) → revisi per bagian via chat → unduh DOCX.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, CheckCircle2, Download, ExternalLink, FileText, Loader2, MessageSquarePlus,
  Paperclip, Play, Send, ShieldCheck, Trash2, User as UserIcon, Upload, ListChecks, BookOpen, Table2, Workflow, Image as ImageIcon,
} from "lucide-react";
import { authenticatedFetch, useAuth } from "@/components/AuthProvider";
import ReportJobProgress from "@/components/ReportJobProgress";
import Button from "@/components/ui/Button";
import { getErrorMessage as baseErrorMessage } from "@/lib/errors";
import { jobAction, peekJob, runJobUntilDone, type ReportJob } from "@/lib/client/report-job";
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

const STAGE_LABEL: Record<string, string> = { intake: "Ngobrol", planned: "Rencana siap", executing: "Menulis", drafted: "Draft jadi" };
const PDF_LABEL: Record<string, string> = { verified: "PDF ✓", landing_page: "Halaman", closed: "Berbayar", broken: "Rusak", unknown: "?" };

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
  const [preset, setPreset] = useState<keyof typeof DOCX_PRESETS>("kampus4433");
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setError(null);
    loadDetail(activeId).catch((e) => setError(getErrorMessage(e)));
  }, [activeId, loadDetail]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, sending]);

  // --------------------------------------------------------- job polling
  const pollJob = useCallback(async (jobId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPolling(true);
    try {
      const final = await runJobUntilDone(jobId, { onUpdate: setJob, signal: controller.signal, intervalMs: 700 });
      setJob(final);
      if (activeId) await loadDetail(activeId);
      if (final.status === "done") setTab("draft");
    } catch (e) {
      if (!controller.signal.aborted) setError(getErrorMessage(e));
    } finally {
      if (abortRef.current === controller) setPolling(false);
    }
  }, [activeId, loadDetail]);

  useEffect(() => {
    if (!detail?.jobId || !job) return;
    if ((job.status === "queued" || job.status === "running") && !polling) pollJob(detail.jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.jobId, job?.id]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || !activeId || sending) return;
    setInput("");
    setSending(true);
    setError(null);
    setMessages((prev) => [...prev, { id: `u${Date.now()}`, role: "user", content: message }]);
    try {
      const data = await api<{ reply: string; toolsUsed: string[]; jobId: string | null; stage: string }>(`/api/laporan/sessions/${activeId}/message`, {
        method: "POST", body: JSON.stringify({ message, deep }),
      });
      setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: "assistant", content: data.reply, toolCalls: { tools: data.toolsUsed } }]);
      const fresh = await loadDetail(activeId);
      await loadSessions();
      if (data.toolsUsed.includes("proposePlan") || data.toolsUsed.includes("findSources")) setTab(data.toolsUsed.includes("findSources") ? "sumber" : "rencana");
      if (data.toolsUsed.includes("reviseSection")) setTab("draft");
      if (data.toolsUsed.includes("generateFigure")) setTab("gambar");
      if (data.jobId && fresh.job && (fresh.job.status === "queued" || fresh.job.status === "running")) pollJob(data.jobId);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally { setSending(false); }
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
      setTab("bahan");
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
      await exportMarkdownToDocx(detail.draft, detail.title || detail.brief.title || "Laporan", { profile: DOCX_PRESETS[preset].profile, images });
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setExporting(false); }
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

  return (
    <div className="min-h-screen bg-slate-50 px-3 pb-6 pt-20 md:px-6 md:pt-24">
      <div className="mx-auto grid max-w-[1500px] gap-4 lg:grid-cols-[240px_minmax(0,1fr)_400px]">
        {/* ------------------------------------------------ sidebar sesi */}
        <aside className="rounded-2xl border border-slate-200 bg-white p-3">
          <Button onClick={createSession} variant="primary" size="sm" className="w-full"><MessageSquarePlus className="h-4 w-4" /> Laporan baru</Button>
          <div className="mt-3 space-y-1">
            {sessions.map((s) => (
              <div key={s.id} className={`group flex items-center gap-2 rounded-xl px-2 py-2 text-sm ${s.id === activeId ? "bg-slate-900 text-white" : "hover:bg-slate-100"}`}>
                <button type="button" onClick={() => setActiveId(s.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate font-semibold">{s.title || "Tanpa judul"}</div>
                  <div className={`text-[11px] ${s.id === activeId ? "text-slate-300" : "text-slate-500"}`}>{STAGE_LABEL[s.stage] || s.stage}</div>
                </button>
                <button type="button" onClick={() => deleteSession(s.id)} className="opacity-0 group-hover:opacity-100" title="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {!sessions.length && <p className="px-2 py-4 text-xs text-slate-500">Belum ada sesi. Mulai dari “Laporan baru”.</p>}
          </div>
        </aside>

        {/* ------------------------------------------------------ chat */}
        <section className="flex min-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><Bot className="h-4 w-4 text-blue-600" /> Asisten Laporan</div>
            {detail && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{STAGE_LABEL[detail.stage] || detail.stage}</span>}
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {!activeId && <p className="text-sm text-slate-500">Pilih sesi atau buat “Laporan baru”. Asisten akan bertanya tentang jenis dokumen, topik, syarat jurnal (SINTA/Scopus), format kampus, lalu menyusun rencana dan sumber yang bisa kamu cek sendiri (DOI/PDF).</p>}
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                {m.role === "assistant" && <Bot className="mt-1 h-4 w-4 shrink-0 text-blue-600" />}
                <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                  {m.content}
                  {m.toolCalls?.tools?.length ? <div className="mt-1 text-[10px] text-slate-500">⚙ {m.toolCalls.tools.join(", ")}</div> : null}
                </div>
                {m.role === "user" && <UserIcon className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
              </div>
            ))}
            {sending && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Asisten sedang berpikir / mencari sumber…</div>}
            <div ref={bottomRef} />
          </div>

          {error && <div className="mx-4 mb-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {detail && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2">
              {detail.stage === "intake" && <Chip onClick={() => send("Menurutmu info sudah cukup? Kalau iya, buatkan rencananya dan carikan sumbernya.")}>Buat rencana</Chip>}
              {detail.stage === "planned" && <Chip onClick={() => send("Cari sumber tambahan yang lebih relevan dengan topik ini.")}>Cari sumber lagi</Chip>}
              {canExecute && !jobActive && <Chip onClick={() => execute(false)} tone="primary" disabled={executing}><Play className="h-3 w-3" /> {detail.stage === "drafted" ? "Tulis ulang semua" : "Setujui & eksekusi"}</Chip>}
              {detail.stage === "drafted" && draftSections[1] && <Chip onClick={() => setInput(`Revisi bagian "${draftSections[1]}": `)}>Revisi bagian…</Chip>}
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />} Unggah bahan
                <input type="file" className="hidden" accept=".pdf,.docx,.zip,.txt,.md" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadMaterial(f); e.target.value = ""; }} />
              </label>
              <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Model teliti (lebih lambat)</label>
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2 border-t border-slate-100 px-4 py-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={activeId ? "Tulis pesan… (Enter kirim, Shift+Enter baris baru)" : "Buat sesi dulu"}
              disabled={!activeId || sending}
              rows={2}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
            <Button type="submit" variant="primary" size="sm" disabled={!activeId || sending || !input.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
          </form>
        </section>

        {/* ------------------------------------------------- panel kanan */}
        <aside className="space-y-3">
          {detail?.jobId && job && (
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <ReportJobProgress
                job={job}
                polling={polling}
                compact
                onResume={() => detail.jobId && pollJob(detail.jobId)}
                onRetry={(redo) => detail.jobId && jobAction(detail.jobId, "retry", redo).then((j) => { setJob(j); pollJob(j.id); }).catch((e) => setError(getErrorMessage(e)))}
                onCancel={() => detail.jobId && jobAction(detail.jobId, "cancel").then(setJob).catch((e) => setError(getErrorMessage(e)))}
              />
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex border-b border-slate-100 text-xs font-bold">
              {([["rencana", "Rencana", ListChecks], ["sumber", `Sumber (${detail?.sources.length ?? 0})`, BookOpen], ["bahan", `Bahan (${detail?.materials.length ?? 0})`, Upload], ["gambar", `Gambar (${figures.length})`, ImageIcon], ["draft", "Draft", FileText]] as const).map(([key, label, Icon]) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`flex flex-1 items-center justify-center gap-1 px-2 py-2 ${tab === key ? "border-b-2 border-slate-900 text-slate-900" : "text-slate-500"}`}><Icon className="h-3.5 w-3.5" />{label}</button>
              ))}
            </div>
            <div className="max-h-[70vh] overflow-y-auto p-3 text-sm">
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
                              {s.purpose && <div className="text-[11px] text-slate-600">{s.purpose}</div>}
                            </li>
                          ))}
                        </ol>
                      </div>
                      {detail.plan.diagrams.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700"><Workflow className="h-3.5 w-3.5" /> Diagram ({detail.plan.diagrams.length})</div>
                          <ul className="space-y-1 text-xs">{detail.plan.diagrams.map((d) => <li key={d.id} className="rounded-lg bg-slate-50 px-2 py-1"><b>{d.title}</b> <span className="text-slate-500">({d.type})</span> — {d.purpose}</li>)}</ul>
                        </div>
                      )}
                      {detail.plan.tables.length > 0 && (
                        <div>
                          <div className="mb-1 flex items-center gap-1 text-xs font-bold text-slate-700"><Table2 className="h-3.5 w-3.5" /> Tabel ({detail.plan.tables.length})</div>
                          <ul className="space-y-1 text-xs">{detail.plan.tables.map((t) => <li key={t.id} className="rounded-lg bg-slate-50 px-2 py-1"><b>{t.title}</b> — {t.purpose}{t.columns.length ? ` [${t.columns.join(", ")}]` : ""}</li>)}</ul>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500">Mau ubah? Bilang saja di chat, mis. “ganti BAB 3 jadi metode Waterfall” atau “tambah diagram sequence login”.</p>
                    </>
                  ) : <p className="text-xs text-slate-500">Rencana muncul setelah asisten cukup paham kebutuhanmu.</p>}
                </div>
              )}

              {detail && tab === "sumber" && (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800"><ShieldCheck className="mr-1 inline h-3 w-3" />Semua DOI diverifikasi ke Crossref. Peringkat SINTA/Scopus <b>tidak</b> dipastikan otomatis — cek lewat tautan di tiap sumber. Sistem hanya membaca abstrak.</p>
                  {!detail.sources.length && <p className="text-xs text-slate-500">Belum ada sumber. Asisten akan mencari setelah rencana dibuat.</p>}
                  {detail.sources.map((s) => (
                    <div key={s.id} className="rounded-xl border border-slate-100 p-2">
                      <div className="text-xs leading-snug text-slate-900">{s.citationApa}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {s.qualitySignals.map((q) => <span key={q} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{q}</span>)}
                        {s.pdfStatus && <span className={`rounded px-1.5 py-0.5 text-[10px] ${s.pdfStatus === "verified" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{PDF_LABEL[s.pdfStatus]}</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] font-semibold">
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
                  <p className="text-[11px] text-slate-500">Unggah ZIP kode, PDF panduan, DOCX contoh, atau data mentah lewat tombol “Unggah bahan”. Isinya dipakai sebagai konteks penulisan.</p>
                  {!detail.materials.length && <p className="text-xs text-slate-500">Belum ada bahan.</p>}
                  {detail.materials.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 rounded-xl border border-slate-100 px-2 py-1.5 text-xs">
                      <FileText className="h-3.5 w-3.5 text-slate-400" />
                      <div className="min-w-0 flex-1"><div className="truncate font-semibold">{m.title}</div><div className="text-[10px] text-slate-500">{m.kind} · {m.chars.toLocaleString("id-ID")} karakter</div></div>
                      <button type="button" onClick={() => removeMaterial(m.id)} title="Hapus"><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-600" /></button>
                    </div>
                  ))}
                </div>
              )}

              {detail && tab === "gambar" && (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">Minta di chat, mis. “buatkan gambar arsitektur sistem untuk BAB III”. Gambar dibuat di background (±2 menit) dan otomatis masuk DOCX lewat placeholder <code>[Gambar: Judul - keterangan]</code> di draft. Untuk UML pakai UML Builder.</p>
                  {!figures.length && <p className="text-xs text-slate-500">Belum ada gambar.</p>}
                  {figures.map((f) => (
                    <div key={f.id} className="rounded-xl border border-slate-100 p-2 text-xs">
                      <div className="flex items-center gap-2">
                        {f.status === "done" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : f.status === "failed" ? <span className="h-3.5 w-3.5 rounded-full bg-red-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                        <div className="min-w-0 flex-1 truncate font-semibold">{f.title || "Gambar"}</div>
                        <span className="text-[10px] text-slate-500">{f.status === "queued" ? "antre" : f.status === "running" ? "diproses" : f.status === "done" ? "selesai" : "gagal"}</span>
                      </div>
                      {f.status === "failed" && f.error && <div className="mt-1 text-[11px] text-red-600">{f.error}</div>}
                      {f.status === "done" && f.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.title} className="mt-2 w-full rounded-lg border border-slate-100" /></a>
                      )}
                      {f.status === "done" && <div className="mt-1 text-[10px] text-slate-500">Placeholder: <code>[Gambar: {f.title} - keterangan]</code></div>}
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
                      <div className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {detail.draft.split(/\s+/).length.toLocaleString("id-ID")} kata · {draftSections.length} bagian</div>
                      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-800">{detail.draft}</pre>
                      <p className="text-[11px] text-slate-500">Untuk revisi: ketik di chat “Revisi bagian ‘{draftSections[1] || "BAB II"}’: …”.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Chip({ children, onClick, tone, disabled }: { children: React.ReactNode; onClick: () => void; tone?: "primary"; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${tone === "primary" ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
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
