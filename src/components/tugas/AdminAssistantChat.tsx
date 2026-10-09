"use client";

/**
 * AdminAssistantChat — chatbot Admin AI untuk 1 course.
 * - Sesi tersimpan di server (AdminChatSession); bisa ganti/hapus sesi.
 * - askUser: pertanyaan dari AI tampil sebagai kartu; jawaban admin dikirim
 *   dengan `answerTo` supaya disimpan sebagai rubric/memory sesi.
 * - Toggle "Review mendalam" → model besar (lebih mahal; default model cepat).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Download, Loader2, MessageSquarePlus, Send, Sparkles, Trash2, User as UserIcon } from "lucide-react";
import Button from "@/components/ui/Button";
import SimpleMarkdown from "@/components/ui/SimpleMarkdown";
import {
  deleteAssistantSession,
  fetchAssistantHistory,
  fetchAssistantSessions,
  sendAssistantMessage,
  type AssistantAttachment,
  type AssistantSessionSummary,
} from "@/lib/client/tugas-api";

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  attachments?: AssistantAttachment[];
  toolsUsed?: string[];
}

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
  }, [messages, pendingQuestion]);

  async function openSession(id: string) {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat sesi.");
    } finally {
      setBusy(false);
    }
  }

  function newSession() {
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
      setError(err instanceof Error ? err.message : "Gagal menghapus sesi.");
    }
  }

  async function send(text: string, answerTo?: string) {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const tempId = `tmp-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: tempId, role: "user", content: message },
      { id: `${tempId}-a`, role: "assistant", content: "", pending: true },
    ]);
    try {
      const r = await sendAssistantMessage(courseId, { message, sessionId, answerTo: answerTo ?? null, deep });
      setSessionId(r.sessionId);
      setPendingQuestion(r.pendingQuestion);
      const replyText = r.reply || (r.pendingQuestion ? "" : "(tidak ada jawaban)");
      setMessages((prev) => {
        const next: ChatMsg[] = prev.filter((m) => m.id !== `${tempId}-a`);
        if (replyText) next.push({ id: `${tempId}-a`, role: "assistant", content: replyText, attachments: r.attachments ?? [], toolsUsed: r.toolsUsed });
        return next;
      });
      void loadSessions();
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== `${tempId}-a`));
      setError(err instanceof Error ? err.message : "Asisten gagal merespons.");
    } finally {
      setBusy(false);
    }
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
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "whitespace-pre-wrap bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
                {m.pending ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
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
                    {m.toolsUsed?.length ? (
                      <p className="mt-1.5 text-[10px] text-slate-400">tools: {Array.from(new Set(m.toolsUsed)).join(", ")}</p>
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
          className="flex items-end gap-2 border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingQuestion) answerQuestion(input);
            else void send(input);
          }}
        >
          <textarea
            className="min-h-[44px] flex-1 resize-y rounded-xl border border-slate-300 p-2 text-sm text-slate-900"
            rows={2}
            maxLength={6000}
            placeholder={pendingQuestion ? "Jawab pertanyaan asisten..." : "Contoh: nilai semua pengumpulan pertemuan 3, kriteria: ada ERD, relasi benar, penjelasan jelas"}
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
          <Button type="submit" size="md" icon={Send} isLoading={busy} disabled={busy || !input.trim()}>
            Kirim
          </Button>
        </form>
      </section>
    </div>
  );
}
