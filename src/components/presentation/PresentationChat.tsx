"use client";

import FeedbackButtons from "@/components/feedback/FeedbackButtons";
import { useEffect, useRef, useState } from "react";
import { Bot, FileText, Loader2, Paperclip, Send, X } from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";
import AgentRunProgress from "@/components/ui/AgentRunProgress";
import Button from "@/components/ui/Button";
import SimpleMarkdown from "@/components/ui/SimpleMarkdown";
import type { AgentEvent, AgentRunPublic } from "@/lib/client/agent-run";
import { attachmentError, MAX_CHAT_ATTACHMENTS } from "@/lib/client/report-attachments";
import { getErrorMessage } from "@/lib/errors";
import { TEMPLATE_LABELS, TemplatePicker } from "./PresentationPlanPanel";

export interface ChatMessage { id: string; role: "user" | "assistant"; content: string; at: string; runId?: string; options?: string[] }

const ACCEPT = ".pdf,.docx,.pptx,.xlsx,.zip,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp";

interface Props {
  root: string;
  messages: ChatMessage[];
  /** Judul laporan bila presentasi dibuat dari Laporan. */
  sourceTitle?: string;
  /** Pertanyaan AI yang menunggu jawaban (run waiting_user). */
  question?: { question: string; options?: string[] } | null;
  run: AgentRunPublic | null;
  events: AgentEvent[];
  startedAt: number;
  lastBeatAt: number;
  working: boolean;
  /** Alasan chat belum bisa dipakai; kosong berarti boleh mengirim. */
  blockedReason: string;
  onSend: (message: string) => void;
  onCancel: () => void;
  onProject: () => Promise<void>;
  onError: (message: string) => void;
}

/** Percakapan dengan AI presentasi. Tampilan mengikuti Asisten Laporan agar terasa satu produk. */
export default function PresentationChat({ root, messages, sourceTitle, question, run, events, startedAt, lastBeatAt, working, blockedReason, onSend, onCancel, onProject, onError }: Props) {
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const blocked = !!blockedReason;
  const busy = working || uploading;
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [messages.length, working]);

  const last = messages.at(-1);
  // Answer choices stay with the last AI message, so they survive a reload of the page.
  const options = !working && last?.role === "assistant" ? (last.options?.length ? last.options : question?.options) : undefined;
  const templateOptions = options?.filter((option) => TEMPLATE_LABELS.has(option.toLowerCase())) ?? [];
  const otherOptions = options?.filter((option) => !TEMPLATE_LABELS.has(option.toLowerCase())) ?? [];
  const starters = sourceTitle
    ? ["Buat presentasi sidang 15 menit dari laporan ini", "Buat presentasi seminar hasil dengan teks ringkas", "Pilihkan bagian laporan yang paling penting untuk dipresentasikan"]
    : ["Saya ingin membuat presentasi tugas kuliah", "Bantu buat presentasi dari dokumen yang saya lampirkan", "Buat presentasi singkat 10 menit"];

  function stage(files: File[]) {
    if (!files.length) return;
    for (const file of files) {
      const invalid = attachmentError(file, false);
      if (invalid) { onError(invalid); return; }
    }
    setPending((items) => [...items, ...files].slice(0, MAX_CHAT_ATTACHMENTS));
  }

  /** Bahan diunggah saat pesan dikirim, lalu didaftarkan ke presentasi agar AI bisa membacanya sendiri. */
  async function upload(files: File[]) {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      const res = await authenticatedFetch("/api/context/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: { title: string; fileName: string; kind: string; fileId?: string } } | null;
      if (!res.ok || !data?.success || !data.data?.fileId) throw new Error(data?.error || `Gagal membaca ${file.name}.`);
      const added = await authenticatedFetch(`${root}/materials`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: data.data.fileId, title: (data.data.title || file.name).slice(0, 200), fileName: (data.data.fileName || file.name).slice(0, 200), kind: (data.data.kind || "file").slice(0, 40) }),
      });
      const result = await added.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!added.ok || !result?.success) throw new Error(result?.error || `${file.name} gagal ditambahkan.`);
    }
  }

  async function send(text: string) {
    const typed = text.trim();
    if ((!typed && !pending.length) || busy || blocked) return;
    const files = pending;
    const message = typed || `Saya melampirkan bahan: ${files.map((file) => file.name).join(", ")}. Pelajari isinya, lalu bantu saya menyusun presentasinya.`;
    if (files.length) {
      setUploading(true);
      try { await upload(files); setPending([]); await onProject(); }
      catch (e) { onError(getErrorMessage(e)); setUploading(false); return; }
      setUploading(false);
    }
    setInput("");
    onSend(message.slice(0, 4000));
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
      <div className="mx-auto max-w-3xl space-y-4" aria-live="polite">
        {!messages.length && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-relaxed text-slate-600">
          <p className="font-bold text-slate-900">{sourceTitle ? `Presentasi dari laporan “${sourceTitle}”` : "Ceritakan presentasi yang Anda butuhkan"}</p>
          <p className="mt-1">{sourceTitle
            ? "AI akan membaca laporan Anda, memilih bagian yang paling penting, lalu menyusun slide. Sebutkan tujuan presentasi, durasi, atau biarkan AI menanyakannya."
            : "Lampirkan dokumen, materi kuliah, atau tulis topiknya. AI akan membaca bahan, menanyakan tujuan, audiens, durasi, dan banyaknya teks, lalu menyusun rencana dan slide yang bisa Anda tinjau."}</p>
        </div>}
        {messages.map((m) => m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-slate-900 px-4 py-2.5 text-[15px] text-white">{m.content}</div>
          </div>
        ) : (
          <div key={m.id} className="flex gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white"><Bot className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1 text-[15px] leading-relaxed text-slate-900"><SimpleMarkdown text={m.content} />{!m.id.startsWith("pending") && <FeedbackButtons feature="presentasi" targetId={m.id} />}</div>
          </div>
        ))}
        {templateOptions.length > 0 && <div className="pl-10"><TemplatePicker compact only={templateOptions} disabled={blocked} onPick={(label) => void send(`Tampilan: ${label}`)} /></div>}
        {otherOptions.length > 0 && <div className="flex flex-wrap gap-2 pl-10">{otherOptions.map((option) => <button key={option} type="button" disabled={blocked} onClick={() => void send(option)} className="rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">{option}</button>)}</div>}
        {working && <AgentRunProgress run={run} events={events} startedAt={startedAt} lastBeatAt={lastBeatAt} onCancel={onCancel} />}
        {uploading && <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Membaca lampiran...</div>}
        <div ref={bottom} />
      </div>
    </div>

    <div className="border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 md:px-6">
      <div className="mx-auto max-w-3xl">
        {blocked && <p role="status" className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{blockedReason}</p>}
        <div className="-mx-3 mb-2 flex items-center gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {!messages.length && starters.map((text) => <button key={text} type="button" disabled={busy || blocked} onClick={() => void send(text)} className="inline-flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 sm:whitespace-normal">{text}</button>)}
          <label className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 px-3.5 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 ${busy ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
            <Paperclip className="h-3.5 w-3.5" /> Lampirkan bahan
            <input type="file" className="hidden" accept={ACCEPT} multiple disabled={busy} onChange={(e) => { stage(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          </label>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="rounded-2xl border border-slate-300 bg-white p-2 shadow-sm focus-within:border-slate-500">
          {pending.length > 0 && <div className="mb-2 flex flex-wrap gap-2 border-b border-slate-100 pb-2" aria-label="Lampiran belum dikirim">
            {pending.map((file, index) => <span key={`${file.name}-${index}`} className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700">
              <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate" title={file.name}>{file.name}</span>
              <button type="button" disabled={busy} onClick={() => setPending((items) => items.filter((_, i) => i !== index))} aria-label={`Hapus lampiran ${file.name}`} className="-my-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center text-slate-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
            </span>)}
            <p className="w-full px-1 text-xs text-slate-500">Lampiran diunggah saat Anda menekan Kirim.</p>
          </div>}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }}
              rows={1}
              maxLength={4000}
              disabled={busy || blocked}
              placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
              aria-label="Pesan untuk AI presentasi"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
            />
            <Button type="submit" aria-label="Kirim pesan" variant="secondary" size="sm" className="h-10 w-11 shrink-0 !px-0" disabled={busy || blocked || (!input.trim() && !pending.length)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
          </div>
        </form>
      </div>
    </div>
  </div>;
}
