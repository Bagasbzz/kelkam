"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  ClipboardCheck,
  FileEdit,
  Trash2,
} from "lucide-react";

const STORAGE_KEY = "report_chat_experiment_v1";

type Stage = "chat" | "review" | "references" | "draft";
type Message = { role: "user" | "assistant"; content: string };
type Brief = {
  title: string;
  documentType: string;
  requirements: string[];
  missing: string[];
  outline: { title: string; purpose: string }[];
};
type Source = { id: string; title: string; content: string; fileName?: string };
type Reference = {
  id: string;
  title: string;
  citationApa: string;
  url: string;
  abstract: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  doi?: string | null;
};
type SearchResult = Reference & { pdfUrl?: string | null; citationCount?: number; isOpenAccess?: boolean };

const emptyBrief: Brief = { title: "", documentType: "", requirements: [], missing: [], outline: [] };

const initialState = {
  stage: "chat" as Stage,
  messages: [] as Message[],
  brief: emptyBrief,
  sources: [] as Source[],
  searchResults: [] as SearchResult[],
  references: [] as Reference[],
  draft: "",
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readResponse<T>(response: Response): Promise<T & { success?: boolean; error?: string }> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || "Permintaan belum berhasil.");
  return data;
}

export default function LaporanChatPage() {
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState<"chat" | "file" | "search" | "draft" | "revise" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setState({ ...initialState, ...JSON.parse(saved) });
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const hasBrief = Boolean(state.brief.title.trim() && state.brief.outline.length && state.sources.length);
  const selectedReferences = state.references.length;
  const stageIndex = ["chat", "review", "references", "draft"].indexOf(state.stage);
  const welcome = useMemo(() => state.messages.length === 0, [state.messages.length]);

  const askAI = async (nextMessage: string) => {
    const trimmed = nextMessage.trim();
    if (!trimmed || busy) return;
    setBusy("chat");
    setError("");
    const nextMessages = [...state.messages, { role: "user" as const, content: trimmed }];
    try {
      const response = await authenticatedFetch("/api/report-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", messages: nextMessages, brief: state.brief, sources: state.sources, references: state.references, draft: "", instruction: "", approved: false }),
      });
      const data = await readResponse<{ reply: string; brief: Brief }>(response);
      setState((current) => ({ ...current, messages: [...nextMessages, { role: "assistant", content: data.reply }], brief: data.brief }));
      setMessage("");
    } catch (caught) {
      setError(getErrorMessage(caught, "Bimbingan AI belum berhasil."));
    } finally {
      setBusy(null);
    }
  };

  const addSource = () => {
    if (!sourceText.trim()) return;
    setState((current) => ({ ...current, sources: [{ id: makeId("source"), title: sourceTitle.trim() || "Catatan pengguna", content: sourceText.trim() }, ...current.sources] }));
    setSourceTitle("");
    setSourceText("");
  };

  const uploadSource = async (file?: File) => {
    if (!file) return;
    setBusy("file");
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await authenticatedFetch("/api/context/extract", { method: "POST", body: formData });
      const data = await readResponse<{ data?: { title?: string; content?: string; fileName?: string } }>(response);
      if (!data.data?.content) throw new Error("Isi file tidak terbaca.");
      setState((current) => ({ ...current, sources: [{ id: makeId("file"), title: data.data?.title || file.name, content: data.data?.content || "", fileName: data.data?.fileName || file.name }, ...current.sources] }));
    } catch (caught) {
      setError(getErrorMessage(caught, "File belum berhasil dibaca."));
    } finally {
      setBusy(null);
    }
  };

  const searchReferences = async () => {
    if (!query.trim()) return;
    setBusy("search");
    setError("");
    try {
      const response = await authenticatedFetch("/api/references/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, limit: 8 }) });
      const data = await readResponse<{ data?: SearchResult[] }>(response);
      setState((current) => ({ ...current, searchResults: (data.data || []).map((item) => ({ ...item, id: item.id || makeId("ref") })) }));
    } catch (caught) {
      setError(getErrorMessage(caught, "Pencarian referensi belum berhasil."));
    } finally {
      setBusy(null);
    }
  };

  const createDraft = async () => {
    setBusy("draft");
    setError("");
    try {
      const response = await authenticatedFetch("/api/report-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft", messages: state.messages, brief: state.brief, sources: state.sources, references: state.references, draft: "", instruction: "", approved: true }) });
      const data = await readResponse<{ draft: string }>(response);
      setState((current) => ({ ...current, stage: "draft", draft: data.draft }));
    } catch (caught) {
      setError(getErrorMessage(caught, "Draft belum berhasil dibuat."));
    } finally {
      setBusy(null);
    }
  };

  const reviseDraft = async () => {
    if (!revision.trim()) return;
    setBusy("revise");
    setError("");
    try {
      const response = await authenticatedFetch("/api/report-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revise", messages: state.messages, brief: state.brief, sources: state.sources, references: state.references, draft: state.draft, instruction: revision, approved: true }) });
      const data = await readResponse<{ draft: string }>(response);
      setState((current) => ({ ...current, draft: data.draft }));
      setRevision("");
    } catch (caught) {
      setError(getErrorMessage(caught, "Revisi belum berhasil."));
    } finally {
      setBusy(null);
    }
  };

  const reset = () => {
    if (!window.confirm("Hapus percobaan laporan chat ini?")) return;
    setState(initialState);
  };

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-8 text-slate-900 md:px-8 md:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Laporan lama</Link>
          <button onClick={reset} className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /> Hapus percobaan</button>
        </div>
        <header className="mb-8 max-w-3xl">
          <p className="mb-3 text-xs font-black uppercase tracking-[0.22em] text-emerald-700">Eksperimen laporan</p>
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">Ngobrol dulu. Laporan menyusul.</h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-600">Ceritakan tugas, bahan, dan arahan dosen dengan bahasa biasa. AI merapikan pemahaman bersama kamu sebelum menulis.</p>
        </header>

        <nav className="mb-6 grid gap-2 sm:grid-cols-4" aria-label="Tahapan laporan">
          {["chat", "review", "references", "draft"].map((item, index) => {
            const labels = ["Ngobrol", "Cek rekap", "Pilih sumber", "Buat draft"];
            const active = index === stageIndex;
            const done = index < stageIndex;
            return <button key={item} onClick={() => setState((current) => ({ ...current, stage: item as Stage }))} className={`flex items-center gap-3 border-b-2 px-2 py-3 text-left text-sm font-black ${active ? "border-emerald-600 text-emerald-800" : done ? "border-emerald-200 text-slate-700" : "border-slate-200 text-slate-400"}`}><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs ${active ? "bg-emerald-700 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-200"}`}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>{labels[index]}</button>;
          })}
        </nav>

        {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
            {state.stage === "chat" && <>
              <div className="mb-5 flex items-center gap-3"><MessageCircle className="h-6 w-6 text-emerald-700" /><div><h2 className="text-xl font-black">Bimbingan awal</h2><p className="text-sm text-slate-500">Mulai dari instruksi tugas atau ide yang masih berantakan.</p></div></div>
              <div className="mb-5 space-y-3 rounded-xl bg-slate-50 p-4">
                {welcome && <p className="text-sm leading-relaxed text-slate-600">Contoh: “Saya harus membuat laporan analisis sistem informasi perpustakaan. Dosen minta ada latar belakang, metode, UML, dan minimal lima jurnal.”</p>}
                {state.messages.map((item, index) => <div key={`${item.role}-${index}`} className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${item.role === "user" ? "ml-auto bg-slate-900 text-white" : "bg-white text-slate-700 shadow-sm"}`}>{item.content}</div>)}
                {busy === "chat" && <div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><Loader2 className="h-4 w-4 animate-spin" /> AI sedang merapikan pemahaman...</div>}
              </div>
              <div className="flex gap-2"><textarea value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void askAI(message); } }} placeholder="Ceritakan tugas, arahan dosen, atau kebingunganmu..." className="min-h-24 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" /><button onClick={() => void askAI(message)} disabled={!message.trim() || Boolean(busy)} className="self-end rounded-xl bg-emerald-700 p-3 text-white disabled:opacity-40" title="Kirim pesan"><Send className="h-5 w-5" /></button></div>
              <button onClick={() => setState((current) => ({ ...current, stage: "review" }))} disabled={!state.messages.length || !state.brief.outline.length} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-black text-slate-700 disabled:opacity-40">Cek rekap sementara <ChevronRight className="h-4 w-4" /></button>
            </>}

            {state.stage === "review" && <>
              <div className="mb-6 flex items-center gap-3"><ClipboardCheck className="h-6 w-6 text-emerald-700" /><div><h2 className="text-xl font-black">Rekap yang bisa kamu koreksi</h2><p className="text-sm text-slate-500">AI hanya membantu merapikan. Kamu tetap yang menyetujui arah laporan.</p></div></div>
              <label className="mb-4 block text-sm font-bold">Judul<input value={state.brief.title} onChange={(event) => setState((current) => ({ ...current, brief: { ...current.brief, title: event.target.value } }))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-500" /></label>
              <label className="mb-5 block text-sm font-bold">Jenis dokumen<input value={state.brief.documentType} onChange={(event) => setState((current) => ({ ...current, brief: { ...current.brief, documentType: event.target.value } }))} className="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 font-semibold outline-none focus:border-emerald-500" /></label>
              <div className="grid gap-5 md:grid-cols-2"><div><h3 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Yang dipahami</h3><ul className="space-y-2">{state.brief.requirements.map((item, index) => <li key={index} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{item}</li>)}</ul></div><div><h3 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-400">Masih kurang</h3><ul className="space-y-2">{state.brief.missing.map((item, index) => <li key={index} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{item}</li>)}</ul></div></div>
              <div className="mt-6"><h3 className="mb-3 text-xs font-black uppercase tracking-widest text-slate-400">Kerangka</h3><div className="space-y-2">{state.brief.outline.map((item, index) => <div key={index} className="rounded-xl border border-slate-200 p-3"><input value={item.title} onChange={(event) => setState((current) => ({ ...current, brief: { ...current.brief, outline: current.brief.outline.map((section, sectionIndex) => sectionIndex === index ? { ...section, title: event.target.value } : section) } }))} className="w-full font-black outline-none" /><textarea value={item.purpose} onChange={(event) => setState((current) => ({ ...current, brief: { ...current.brief, outline: current.brief.outline.map((section, sectionIndex) => sectionIndex === index ? { ...section, purpose: event.target.value } : section) } }))} className="mt-2 w-full resize-none text-sm text-slate-500 outline-none" /></div>)}</div></div>
              <button onClick={() => setState((current) => ({ ...current, stage: "references" }))} disabled={!hasBrief} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white disabled:opacity-40">Setujui rekap & lanjut <ChevronRight className="h-4 w-4" /></button>
            </>}

            {state.stage === "references" && <>
              <div className="mb-6 flex items-center gap-3"><Search className="h-6 w-6 text-emerald-700" /><div><h2 className="text-xl font-black">Pilih sumber yang benar-benar ada</h2><p className="text-sm text-slate-500">AI tidak akan mengarang jurnal. Cari, baca ringkasannya, lalu pilih yang relevan.</p></div></div>
              <div className="flex gap-2"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchReferences(); }} placeholder="Contoh: usability sistem informasi perpustakaan" className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" /><button onClick={() => void searchReferences()} disabled={!query.trim() || Boolean(busy)} className="rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy === "search" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Cari"}</button></div>
              <div className="mt-5 space-y-3">{state.searchResults.map((item) => { const selected = state.references.some((reference) => reference.id === item.id); return <article key={item.id} className={`rounded-xl border p-4 ${selected ? "border-emerald-300 bg-emerald-50/40" : "border-slate-200"}`}><div className="flex items-start justify-between gap-4"><div><h3 className="font-black leading-snug">{item.title}</h3><p className="mt-1 text-xs font-bold text-slate-500">{item.authors?.slice(0, 4).join(", ") || "Penulis tidak tersedia"} {item.year ? `(${item.year})` : ""} {item.venue ? `- ${item.venue}` : ""}</p></div><button onClick={() => setState((current) => ({ ...current, references: selected ? current.references.filter((reference) => reference.id !== item.id) : [...current.references, item] }))} className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-black ${selected ? "border-emerald-300 bg-emerald-700 text-white" : "border-emerald-200 text-emerald-700"}`}>{selected ? "Dipilih" : "Pakai"}</button></div><p className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-600">{item.abstract || "Abstrak tidak tersedia."}</p>{item.url && <a href={item.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-bold text-emerald-700 underline">Buka sumber</a>}</article>; })}</div>
              <button onClick={() => setState((current) => ({ ...current, stage: "draft" }))} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white">Lanjut ke draft {selectedReferences ? `(${selectedReferences} sumber)` : "tanpa sitasi"} <ChevronRight className="h-4 w-4" /></button>
            </>}

            {state.stage === "draft" && <>
              <div className="mb-6 flex items-center gap-3"><FileText className="h-6 w-6 text-emerald-700" /><div><h2 className="text-xl font-black">Draft yang bisa diarahkan</h2><p className="text-sm text-slate-500">Draft ini memakai rekap, bahan, dan referensi yang kamu pilih.</p></div></div>
              {!state.draft ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><p className="text-sm text-slate-500">Semua konteks sudah siap. Generate draft pertama sekarang.</p><button onClick={() => void createDraft()} disabled={Boolean(busy)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:opacity-40">{busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileEdit className="h-4 w-4" />} Generate draft</button></div> : <><div className="mb-4 flex gap-2"><textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="Contoh: perjelas latar belakang dan beri tanda pada data yang masih kurang..." className="min-h-20 flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-emerald-500" /><button onClick={() => void reviseDraft()} disabled={!revision.trim() || Boolean(busy)} className="self-end rounded-xl bg-slate-900 p-3 text-white disabled:opacity-40" title="Kirim revisi">{busy === "revise" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}</button></div><pre className="max-h-[620px] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm leading-relaxed text-slate-700">{state.draft}</pre></>}
            </>}
          </section>

          <aside className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-white shadow-sm"><h2 className="font-black">Bahan laporan</h2><p className="mt-1 text-sm leading-relaxed text-slate-300">Masukkan instruksi, catatan, contoh, data, atau file pendukung.</p><input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Nama bahan" className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none" /><textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Tempel catatan di sini..." className="mt-2 min-h-28 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white outline-none" /><div className="mt-2 flex gap-2"><button onClick={addSource} disabled={!sourceText.trim()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black disabled:opacity-40"><Plus className="h-4 w-4" /> Tambah</button><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-black"><Paperclip className="h-4 w-4" /> {busy === "file" ? "Membaca..." : "Unggah file"}<input type="file" className="hidden" accept=".txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.php,.py,.java,.sql,.html,.css,.xml,.yml,.yaml,.pdf,.docx,.zip" onChange={(event) => void uploadSource(event.target.files?.[0])} /></label></div>{state.sources.length > 0 && <div className="mt-4 space-y-2">{state.sources.map((source) => <div key={source.id} className="flex items-start justify-between gap-2 rounded-lg bg-slate-800 p-3"><div><p className="text-sm font-bold">{source.title}</p><p className="mt-1 line-clamp-2 text-xs text-slate-400">{source.content}</p></div><button onClick={() => setState((current) => ({ ...current, sources: current.sources.filter((item) => item.id !== source.id) }))} className="text-slate-500 hover:text-red-400" title="Hapus bahan"><Trash2 className="h-4 w-4" /></button></div>)}</div>}</section>
            <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">Status konteks</h2><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-black">{state.sources.length}</p><p className="text-xs font-bold text-slate-500">bahan</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-2xl font-black">{state.references.length}</p><p className="text-xs font-bold text-slate-500">referensi dipilih</p></div></div>{state.brief.missing.length > 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-xs font-bold leading-relaxed text-amber-900">Masih ada hal yang perlu dilengkapi. AI akan menandainya sebagai placeholder, bukan mengarang.</p>}</section>
          </aside>
        </div>
      </div>
    </main>
  );
}