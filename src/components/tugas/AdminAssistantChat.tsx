"use client";

/**
 * AdminAssistantChat — chatbot Admin AI untuk 1 course.
 * - Sesi tersimpan di server (AdminChatSession); bisa ganti/hapus sesi.
 * - askUser: pertanyaan dari AI tampil sebagai kartu; jawaban admin dikirim
 *   dengan `answerTo` supaya disimpan sebagai rubric/memory sesi.
 * - Toggle "Review mendalam" → model besar (lebih mahal; default model cepat).
 */

import { getErrorMessage } from "@/lib/errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Download, MessageSquarePlus, Paperclip, Send, Sparkles, Trash2, User as UserIcon, X } from "lucide-react";
import Button from "@/components/ui/Button";
import SimpleMarkdown from "@/components/ui/SimpleMarkdown";
import AgentRunProgress from "@/components/ui/AgentRunProgress";
import { authenticatedFetch } from "@/components/AuthProvider";
import { controlRun, fetchActiveRun, followRun, isRunLive, type AgentEvent, type AgentRunPublic } from "@/lib/client/agent-run";
import { MAX_FILE_BYTES, MAX_FILE_LABEL } from "@/lib/file-limits";
import {
  assistantActiveRunUrl,
  assistantRunUrl,
  deleteAssistantSession,
  fetchAssistantHistory,
  fetchAssistantSessions,
  openAssistantRunStream,
  uploadSubmissionFile,
  type AssistantAttachment,
  type AssistantSessionSummary,
} from "@/lib/client/tugas-api";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  attachments?: AssistantAttachment[];
}

interface PendingFile {
  fileId: string;
  name: string;
  size: number;
  isImage: boolean;
  /** Object URL untuk preview gambar; di-revoke saat dihapus. */
  previewUrl?: string;
}

const MAX_ATTACHMENTS = 5;
const ACCEPT_ATTACHMENTS = ".pdf,.docx,.pptx,.zip,.txt,.md,.csv,.json,.py,.js,.ts,.java,.php,.c,.cpp,.sql,image/png,image/jpeg,image/webp,image/gif";

const QUICK_PROMPTS = [
  "Siapa yang belum kumpul di pertemuan terakhir?",
  "Analisis keterlambatan semua tugas",
  "Rekap nilai semua mahasiswa",
  "Cek kemiripan pengumpulan tugas terbaru",
  "Baca deskripsi tugas terbaru lalu cek kesesuaian semua pengumpulan",
  "Ekspor semua pengumpulan tugas terbaru ke Word",
];

export default function AdminAssistantChat({ courseId, initialPrompt }: { courseId: string; initialPrompt?: string }) {
  const [sessions, setSessions] = useState<AssistantSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState(initialPrompt ?? "");
  const [pendingQuestion, setPendingQuestion] = useState<{ question: string; options?: string[] } | null>(null);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Agent run yang sedang di-stream
  const [run, setRun] = useState<AgentRunPublic | null>(null);
  const [runEvents, setRunEvents] = useState<AgentEvent[]>([]);
  const [runStartedAt, setRunStartedAt] = useState(0);
  const [lastBeatAt, setLastBeatAt] = useState(0);
  const [runBusy, setRunBusy] = useState(false);
  const runAbortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => runAbortRef.current?.abort(), []);

  const loadSessions = useCallback(async () => {
    try {
      const r = await fetchAssistantSessions(courseId);
      setSessions(r.sessions);
    } catch {
      /* non-fatal */
    }
  }, [courseId]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion, runEvents.length]);

  async function openSession(id: string) {
    runAbortRef.current?.abort();
    setBusy(true);
    setError(null);
    try {
      const r = await fetchAssistantHistory(courseId, id);
      setSessionId(id);
      setPendingQuestion(null);
      setMessages(
        r.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content })),
      );
      // Auto-attach bila ada run yang masih berjalan (mis. setelah refresh / sinyal putus).
      const active = await fetchActiveRun(assistantActiveRunUrl(courseId, id)).catch(() => null);
      if (active && isRunLive(active.status)) {
        setBusy(false);
        void followAgentRun(
          id,
          () => authenticatedFetch(assistantRunUrl(courseId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: active.id, action: "continue" }) }),
          active,
        );
        return;
      }
    } catch (err) {
      setError(getErrorMessage(err, "Gagal memuat sesi."));
    } finally {
      setBusy(false);
    }
  }

  function newSession() {
    runAbortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setPendingQuestion(null);
    setError(null);
  }

  async function removeSession(id: string) {
    try {
      await deleteAssistantSession(courseId, id);
      if (sessionId === id) newSession();
      await loadSessions();
    } catch (err) {
      setError(getErrorMessage(err, "Gagal menghapus sesi."));
    }
  }

  /**
   * Ikuti run sampai selesai (stream + sambung ulang otomatis), lalu tampilkan
   * jawaban akhir / pertanyaan askUser.
   */
  async function followAgentRun(knownSessionId: string | null, first: () => Promise<Response>, initial?: AgentRunPublic) {
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;
    let runId = initial?.id ?? "";
    let sid = knownSessionId;
    setBusy(true);
    setError(null);
    setRun(initial ?? null);
    setRunEvents(initial?.events ?? []);
    setRunStartedAt(initial ? new Date(initial.createdAt).getTime() : Date.now());
    setLastBeatAt(Date.now());
    const placeholderId = `run-${Date.now()}`;
    setMessages((prev) => [...prev, { id: placeholderId, role: "assistant", content: "", pending: true }]);
    try {
      const final = await followRun({
        first: async () => {
          const res = await first();
          const headerSid = res.headers.get("x-session-id");
          if (headerSid) { sid = headerSid; setSessionId(headerSid); }
          return res;
        },
        continueUrl: assistantRunUrl(courseId),
        runId: () => runId,
        signal: controller.signal,
        observer: {
          onRun: (r) => { runId = r.id; if (!sid) { sid = r.sessionId; setSessionId(r.sessionId); } setRun(r); setRunEvents(r.events); setLastBeatAt(Date.now()); },
          onEvent: (ev) => { setRunEvents((prev) => [...prev.slice(-80), ev]); setLastBeatAt(Date.now()); },
          onHeartbeat: () => setLastBeatAt(Date.now()),
        },
      });
      if (controller.signal.aborted) return;
      const pq = final?.pendingQuestion ?? null;
      setPendingQuestion(pq);
      const replyText = final?.reply
        || (final?.status === "failed" ? `Proses gagal: ${final.error || "kesalahan tak dikenal"}. Ketik "lanjut" untuk mencoba meneruskan.` : "")
        || (final?.status === "paused" ? "Dijeda. Ketik \"lanjut\" untuk meneruskan dari langkah terakhir." : "")
        || (final?.status === "cancelled" ? "Dihentikan." : "")
        || (pq ? "" : "(tidak ada jawaban)");
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== placeholderId);
        if (replyText) next.push({ id: placeholderId, role: "assistant", content: replyText, attachments: final?.attachments ?? [] });
        return next;
      });
      void loadSessions();
    } catch (err) {
      if (controller.signal.aborted) return;
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      setError(getErrorMessage(err, "Asisten gagal merespons."));
    } finally {
      if (runAbortRef.current === controller) { setBusy(false); setRun(null); setRunEvents([]); }
    }
  }

  async function send(text: string, answerTo?: string) {
    const message = text.trim();
    if (!message || busy || uploading) return;
    const attached = files;
    setInput("");
    setFiles([]);
    const shown = attached.length ? `${message}\n\n[Lampiran: ${attached.map((f) => f.name).join(", ")}]` : message;
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: "user", content: shown }]);
    const sid = sessionId;
    await followAgentRun(sid, () => openAssistantRunStream(courseId, {
      message, sessionId: sid, answerTo: answerTo ?? null, deep,
      attachments: attached.map((f) => ({ fileId: f.fileId, name: f.name })),
    }, runAbortRef.current?.signal));
    attached.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
  }

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list).slice(0, MAX_ATTACHMENTS - files.length);
    if (!picked.length) { setError(`Maksimal ${MAX_ATTACHMENTS} lampiran per pesan.`); return; }
    const tooBig = picked.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) { setError(`"${tooBig.name}" melebihi ${MAX_FILE_LABEL}.`); return; }
    setUploading(true);
    setError(null);
    try {
      for (const f of picked) {
        const r = await uploadSubmissionFile(f);
        const isImage = /^image\//.test(f.type);
        setFiles((prev) => prev.some((p) => p.fileId === r.fileId) ? prev : [...prev, { fileId: r.fileId, name: f.name, size: f.size, isImage, previewUrl: isImage ? URL.createObjectURL(f) : undefined }]);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Gagal mengunggah lampiran."));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeFile(fileId: string) {
    setFiles((prev) => {
      const target = prev.find((f) => f.fileId === fileId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.fileId !== fileId);
    });
  }

  async function pauseRun() {
    if (!run) return;
    setRunBusy(true);
    try { await controlRun(assistantRunUrl(courseId), run.id, "pause"); } catch (err) { setError(getErrorMessage(err, "Gagal menjeda.")); } finally { setRunBusy(false); }
  }
  async function cancelRun() {
    if (!run) return;
    setRunBusy(true);
    try { await controlRun(assistantRunUrl(courseId), run.id, "cancel"); } catch (err) { setError(getErrorMessage(err, "Gagal menghentikan.")); } finally { setRunBusy(false); }
  }

  function answerQuestion(answer: string) {
    if (!pendingQuestion) return;
    const q = pendingQuestion.question;
    setPendingQuestion(null);
    void send(answer, q);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      {/* Sidebar sesi */}
      <aside className="space-y-2">
        <Button type="button" variant="outline" size="sm" icon={MessageSquarePlus} onClick={newSession} className="w-full">
          Sesi baru
        </Button>
        <div className="max-h-[420px] space-y-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs ${
                s.id === sessionId ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
              }`}
            >
              <button type="button" className="flex-1 truncate text-left text-slate-700" onClick={() => void openSession(s.id)} title={s.title ?? ""}>
                {s.title || "Tanpa judul"}
                <span className="ml-1 text-slate-400">({s._count.messages})</span>
              </button>
              <button type="button" aria-label="Hapus sesi" className="text-slate-300 hover:text-red-600" onClick={() => void removeSession(s.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {!sessions.length && <p className="px-1 text-xs text-slate-400">Belum ada sesi.</p>}
        </div>
      </aside>

      {/* Chat */}
      <section className="flex min-h-[520px] flex-col rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Bot className="h-4 w-4 text-blue-600" /> Asisten Dosen AI
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
            <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Review mendalam (model besar)
          </label>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {!messages.length && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                Asisten punya akses ke seluruh konteks course: deskripsi tugas, materi (PPTX/PDF), semua mahasiswa & akun, pengumpulan beserta
                waktu/keterlambatan, catatan & feedback, isi file (termasuk ZIP dan kode), kemiripan, indikasi AI, dan bisa mengekspor hasil ke Word.
                Lampirkan rubrik, contoh jawaban, materi, atau gambar lewat ikon klip (atau tempel gambar langsung) agar dipakai sebagai patokan.
              </p>
              <div className="flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q} type="button" className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50" onClick={() => void send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "assistant" && <Bot className="mt-1 h-4 w-4 shrink-0 text-blue-600" />}
              <div className={`${m.pending ? "w-full max-w-[85%]" : "max-w-[85%]"} rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "whitespace-pre-wrap bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                {m.pending ? (
                  <AgentRunProgress run={run} events={runEvents} startedAt={runStartedAt} lastBeatAt={lastBeatAt} onPause={pauseRun} onCancel={cancelRun} busy={runBusy} />
                ) : m.role === "assistant" ? (
                  <>
                    <SimpleMarkdown text={m.content} />
                    {m.attachments?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <a key={a.fileId} href={a.url} download className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">
                            <Download className="h-3.5 w-3.5" /> {a.name} <span className="text-slate-400">({Math.max(1, Math.round(a.size / 1024))} KB)</span>
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  m.content
                )}
              </div>
              {m.role === "user" && <UserIcon className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
            </div>
          ))}

          {pendingQuestion && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <p className="font-bold text-amber-900">Asisten butuh konteks:</p>
              <p className="mt-1 whitespace-pre-wrap text-amber-900">{pendingQuestion.question}</p>
              {pendingQuestion.options?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {pendingQuestion.options.map((o) => (
                    <button key={o} type="button" className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs text-amber-900 hover:bg-amber-100" onClick={() => answerQuestion(o)} disabled={busy}>
                      {o}
                    </button>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs text-amber-700">Atau ketik jawaban di bawah — akan disimpan sebagai rubrik sesi ini.</p>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div ref={bottomRef} />
        </div>

        <form
          className="border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingQuestion) answerQuestion(input);
            else void send(input);
          }}
          onPaste={(e) => {
            const items = Array.from(e.clipboardData?.files ?? []);
            if (items.length) { e.preventDefault(); const dt = new DataTransfer(); items.forEach((f) => dt.items.add(f)); void addFiles(dt.files); }
          }}
        >
          {files.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {files.map((f) => (
                <span key={f.fileId} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
                  {f.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
                  ) : (
                    <Paperclip className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  <span className="max-w-[180px] truncate" title={f.name}>{f.name}</span>
                  <span className="text-slate-400">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
                  <button type="button" aria-label={`Hapus ${f.name}`} className="text-slate-400 hover:text-red-600" onClick={() => removeFile(f.fileId)} disabled={busy}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTACHMENTS} className="hidden" onChange={(e) => void addFiles(e.target.files)} />
            <button
              type="button"
              aria-label="Lampirkan file"
              title="Lampirkan rubrik, contoh, materi, atau gambar (PDF/DOCX/PPTX/ZIP/gambar)"
              className="inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading || files.length >= MAX_ATTACHMENTS}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <textarea
              className="min-h-[44px] flex-1 resize-y rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
              rows={2}
              maxLength={6000}
              placeholder={pendingQuestion ? "Jawab pertanyaan asisten..." : "Contoh: nilai semua pengumpulan pertemuan 3 sesuai rubrik terlampir"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (pendingQuestion) answerQuestion(input);
                  else void send(input);
                }
              }}
              disabled={busy}
            />
            <Button type="submit" size="md" icon={Send} isLoading={busy || uploading} disabled={busy || uploading || !input.trim()}>
              Kirim
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
