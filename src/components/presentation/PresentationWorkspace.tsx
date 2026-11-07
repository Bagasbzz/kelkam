"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Download, ImagePlus, Loader2, Play, Plus, Presentation, Save, Sparkles, Trash2, X } from "lucide-react";
import { authenticatedFetch, useAuth } from "@/components/AuthProvider";
import { describeRunStatus, fetchActiveRun, followRun, isRunLive, type AgentRunPublic } from "@/lib/client/agent-run";
import { getErrorMessage } from "@/lib/errors";
import { deckSchema, LAYOUT_IDS, type PresentationDeck, type PresentationSlide } from "@/lib/presentation/model";
import { layoutSlide, renderSlideSvg } from "@/lib/presentation/layout";
import { DESIGN_PRESETS } from "@/lib/presentation/presets";
import PresentationIntake from "./PresentationIntake";
import SlideCanvas, { TARGET_LABELS, type EditTarget } from "./SlideCanvas";
import SlidePlayer from "./SlidePlayer";
import VisualControls from "./VisualControls";
import styles from "./presentation.module.css";

interface Summary { id: string; title: string; revision: number; updatedAt: string }
interface Project {
  id: string; revision: number; deck: PresentationDeck;
  history: { revision: number; title: string; createdAt: string }[];
  proposal?: { runId: string; baseRevision: number; deck: PresentationDeck } | null;
}
interface IntakeResult { deck: PresentationDeck; prompt: string; materialText: string; audience: string; minutes: number; slideCount: number }
type Generation = Omit<IntakeResult, "deck"> & { motion: "none" | "fade" | "push" | "reveal" };
const LAYOUT_LABELS = { title: "Pembuka", split: "Sorotan", cards: "Gagasan", timeline: "Alur", statement: "Pesan besar" };

async function api<T>(url: string, body?: unknown, method = "POST", signal?: AbortSignal): Promise<T> {
  const response = await authenticatedFetch(url, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || `Permintaan gagal (${response.status}).`);
  return data as T;
}

function Preview({ deck, index }: { deck: PresentationDeck; index: number }) {
  const slide = deck.slides[index];
  return <div className={styles.mini} role="img" aria-label={`Slide ${index + 1}: ${slide.title}`} dangerouslySetInnerHTML={{ __html: renderSlideSvg(layoutSlide(slide, deck.theme, index, deck.slides.length, deck.artDirection, deck.palette)) }} />;
}

export default function PresentationWorkspace() {
  const { user, loading, openLoginModal } = useAuth();
  if (loading) return <div className={styles.loading}><Loader2 className="animate-spin" /> Memuat presentasi...</div>;
  if (!user) return <main className={styles.landing}><header className={styles.simpleHero}><div className={styles.heroIcon}><Presentation size={30} aria-hidden="true" /></div><p className={styles.kicker}>PRESENTASI AI</p><h1>Buat presentasi dengan AI</h1><p>Susun bahan menjadi slide dengan desain yang rapi dan beragam. Edit teks, gambar, dan tata letak, lalu unduh sebagai PowerPoint yang tetap dapat diedit.</p><button className={styles.primary} onClick={openLoginModal}>Masuk untuk membuat presentasi</button></header></main>;
  return <PresentationLibrary key={user.id} owner={user.id} />;
}

function PresentationLibrary({ owner }: { owner: string }) {
  const [projects, setProjects] = useState<Summary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [intake, setIntake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const creating = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ projects: Summary[] }>("/api/presentasi", undefined, "GET", controller.signal).then((data) => setProjects(data.projects)).catch((e) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [owner]);

  async function create(result: IntakeResult) {
    if (creating.current) return;
    creating.current = true;
    let created: Project | null = null;
    try {
      created = (await api<{ project: Project }>("/api/presentasi", { theme: result.deck.theme })).project;
      const next = (await api<{ project: Project }>(`/api/presentasi/${created.id}`, { baseRevision: created.revision, deck: { ...result.deck, id: created.id } }, "PATCH")).project;
      setGeneration({ prompt: result.prompt, materialText: result.materialText, audience: result.audience, minutes: result.minutes, slideCount: result.slideCount, motion: result.deck.slides[0].visual?.motion || "none" });
      setProject(next); setIntake(false);
    } catch (e) {
      if (created) {
        try { await api(`/api/presentasi/${created.id}`, {}, "DELETE"); }
        catch { setProjects((items) => [{ id: created!.id, title: created!.deck.title, revision: created!.revision, updatedAt: new Date().toISOString() }, ...items]); }
      }
      throw e;
    } finally { creating.current = false; }
  }

  async function close() {
    setProject(null); setGeneration(null);
    try { setProjects((await api<{ projects: Summary[] }>("/api/presentasi")).projects); }
    catch (e) { setError(getErrorMessage(e)); }
  }
  if (project) return <DeckEditor key={project.id} initial={project} initialGeneration={generation} onClose={close} />;
  if (intake) return <PresentationIntake onReady={create} onCancel={() => { if (!creating.current) setIntake(false); }} />;
  return <main className={styles.landing}>
    <header className={styles.simpleHero}><div className={styles.heroIcon}><Presentation size={30} aria-hidden="true" /></div><p className={styles.kicker}>PRESENTASI AI</p><h1>Buat presentasi dengan AI</h1><p>Unggah dokumen atau masukkan topik. AI membantu menyusun isi dan desain slide sesuai kebutuhan Anda, lalu hasilnya dapat diedit dan diunduh sebagai PowerPoint.</p><div className={styles.featureList}><span>Desain slide beragam</span><span>Teks dan gambar dapat diedit</span><span>Unduh PPTX</span></div><button className={styles.uploadStart} onClick={() => setIntake(true)}><Plus size={26} /><strong>Buat presentasi</strong><span>Unggah PDF, Word, PowerPoint, gambar, atau masukkan teks</span></button><small>Konsultasi dan pembuatan slide menggunakan kuota AI setelah persetujuan Anda.</small></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <section><div className={styles.sectionHeading}><h2>Presentasi tersimpan</h2><span>{projects.length} presentasi</span></div><div className={styles.projects}>{projects.map((item) => <button className={styles.project} key={item.id} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { setGeneration(null); setProject((await api<{ project: Project }>(`/api/presentasi/${item.id}`)).project); } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); } }}><span className={styles.projectMark}><Presentation size={24} aria-hidden="true" /></span><strong>{item.title}</strong><span>{new Date(item.updatedAt).toLocaleDateString("id-ID")}</span></button>)}{!projects.length && <p className={styles.empty}>Belum ada presentasi tersimpan. Pilih Buat presentasi untuk memulai.</p>}</div></section>
  </main>;
}

function DeckEditor({ initial, initialGeneration, onClose }: { initial: Project; initialGeneration: Generation | null; onClose: () => void }) {
  const [project, setProject] = useState(initial);
  const [deck, setDeck] = useState(initial.deck);
  const [selected, setSelected] = useState(0);
  const [target, setTarget] = useState<EditTarget | null>("title");
  const [panel, setPanel] = useState<"edit" | "design" | "history">("edit");
  const [busy, setBusy] = useState(false);
  const [assetBusy, setAssetBusy] = useState(false);
  const busyRef = useRef(false);
  const [checkingRun, setCheckingRun] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<AgentRunPublic | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [instruction, setInstruction] = useState("");
  const [preserve, setPreserve] = useState<"content" | "design" | "none">("content");
  const [showProposal, setShowProposal] = useState(!!initial.proposal);
  const [playing, setPlaying] = useState(false);
  const [generation, setGeneration] = useState(initialGeneration);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(deck) !== JSON.stringify(project.deck);
  const root = `/api/presentasi/${project.id}`;
  const activeDeck = showProposal && project.proposal ? project.proposal.deck : deck;
  const index = Math.min(selected, activeDeck.slides.length - 1);
  const slide = activeDeck.slides[index];
  const live = !!run && isRunLive(run.status);
  const disabled = checkingRun || busy || assetBusy || live || !!project.proposal;
  const issues = layoutSlide(slide, activeDeck.theme, index, activeDeck.slides.length, activeDeck.artDirection, activeDeck.palette).issues;

  function adopt(next: Project) {
    setProject(next); setDeck(next.deck); setShowProposal(!!next.proposal);
    setSelected((value) => Math.min(value, next.deck.slides.length - 1));
  }
  function editSlide(patch: Partial<PresentationSlide>) {
    if (disabled) return;
    const id = slide.id;
    setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }
  async function follow(first: () => Promise<Response>, knownId = "") {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice(""); setEvents([]);
    const controller = new AbortController(); abort.current = controller;
    let runId = knownId;
    try {
      const result = await followRun({ first, continueUrl: `${root}/run`, runId: () => runId, signal: controller.signal, observer: {
        onRun: (value) => { runId = value.id; setRun(value); },
        onEvent: (event) => setEvents((items) => [...items.slice(-4), event.text]),
      } });
      if (controller.signal.aborted) return;
      const next = (await api<{ project: Project }>(root, undefined, "GET", controller.signal)).project;
      adopt(next);
      if (result?.error) setError(result.error);
      else if (next.proposal) { setNotice("Slide Anda siap. Tinjau hasilnya, lalu pilih Gunakan hasil ini untuk mulai mengedit."); setGeneration(null); }
    } catch (e) { if (!controller.signal.aborted) setError(getErrorMessage(e)); }
    finally { if (!controller.signal.aborted) { busyRef.current = false; setBusy(false); } }
  }
  useEffect(() => {
    let disposed = false;
    fetchActiveRun(`${root}/run`).then((active) => {
      if (disposed) return;
      if (active) {
        setRun(active);
        if (isRunLive(active.status)) void follow(() => authenticatedFetch(`${root}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: active.id, action: "continue" }) }), active.id);
      } else if (initialGeneration) {
        void follow(() => authenticatedFetch(`${root}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...initialGeneration, baseRevision: initial.revision }) }));
      }
    }).catch((e) => { if (!disposed) setError(getErrorMessage(e)); }).finally(() => { if (!disposed) setCheckingRun(false); });
    return () => { disposed = true; abort.current?.abort(); };
    // The editor is remounted for each project; generation starts only after explicit intake approval.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function action(work: () => Promise<void>) {
    if (busyRef.current || checkingRun || assetBusy) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(getErrorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function save() {
    const parsed = deckSchema.safeParse(deck);
    if (!parsed.success) throw new Error("Periksa teks dan posisi objek. Isi tidak boleh kosong atau melewati batas slide.");
    const next = (await api<{ project: Project }>(root, { baseRevision: project.revision, deck: parsed.data }, "PATCH")).project;
    adopt(next); setNotice("Perubahan tersimpan."); return next;
  }
  async function download() {
    const saved = dirty ? await save() : project;
    const response = await authenticatedFetch(`${root}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: saved.revision }) });
    if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error || "Ekspor gagal."); }
    const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url;
    link.download = `${saved.deck.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "presentasi"}.pptx`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("PPTX diunduh. Jalankan Slide Show untuk memeriksa animasi dan hasil akhir.");
  }
  async function uploadImage(file: File) {
    if (disabled) return;
    if (slide.art && !window.confirm("Slide ini sudah punya gambar. Ganti dengan gambar baru?")) return;
    const id = slide.id;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError("Gunakan PNG/JPEG maksimal 4 MB."); return; }
    await action(async () => {
      const form = new FormData(); form.append("file", file);
      const response = await authenticatedFetch("/api/files/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || "Gambar gagal diunggah.");
      setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === id ? { ...item, art: { fileId: data.data.fileId, role: "hero", alt: file.name.slice(0, 300) }, adjustments: (item.adjustments || []).filter((entry) => entry.target !== "art") } : item) }));
      setTarget("art"); setNotice("Gambar ditambahkan. Geser dan tarik sudut untuk mengatur ukurannya, lalu simpan.");
    });
  }
  function reorder(offset: number) {
    if (disabled) return;
    const next = index + offset; if (next < 0 || next >= deck.slides.length) return;
    const slides = [...deck.slides]; [slides[index], slides[next]] = [slides[next], slides[index]];
    setDeck({ ...deck, slides }); setSelected(next);
  }
  function add(duplicate = false) {
    if (disabled || deck.slides.length >= 20) return;
    const item: PresentationSlide = duplicate ? { ...slide, id: crypto.randomUUID(), locked: false } : { id: crypto.randomUUID(), title: "Pesan utama slide", eyebrow: "", body: ["Tambahkan penjelasan singkat."], notes: "", source: "", layout: "split", locked: false, visual: { motif: "none", background: "solid", motion: slide.visual?.motion || "none" } };
    const slides = [...deck.slides]; slides.splice(index + 1, 0, item); setDeck({ ...deck, slides }); setSelected(index + 1);
  }
  function revise() {
    if (disabled || dirty || !instruction.trim()) return;
    void follow(() => authenticatedFetch(`${root}/revise`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: project.revision, slideId: slide.id, instruction, preserve }) }));
  }
  function resume() {
    if (!run || dirty) return;
    void follow(() => authenticatedFetch(`${root}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, action: "resume" }) }), run.id);
  }
  function setAllMotion(motion: "none" | "fade" | "push" | "reveal") {
    if (disabled) return;
    setDeck({ ...deck, slides: deck.slides.map((item) => ({ ...item, visual: { motif: item.visual?.motif || "none", background: item.visual?.background || "solid", motion } })) });
  }
  const targetText = target === "title" ? slide.title : target === "eyebrow" ? slide.eyebrow : target?.startsWith("body-") ? slide.body[Number(target.slice(5))] ?? "" : "";
  const closePlayer = () => setPlaying(false);
  return <main className={styles.editor}>
    <header className={styles.toolbar}><button className={styles.back} disabled={busy || live || assetBusy} onClick={() => { if (!dirty || window.confirm("Perubahan belum disimpan. Tinggalkan editor?")) onClose(); }}>Semua presentasi</button><div className={styles.documentTitle}><strong>{deck.title}</strong><span>{dirty ? "Ada perubahan belum disimpan" : "Tersimpan"}</span></div><div className={styles.toolbarActions}><button onClick={() => setPlaying(true)}><Play size={16} /> Tayangkan</button><button disabled={disabled || !dirty} onClick={() => void action(async () => { await save(); })}><Save size={16} /> Simpan</button><button className={styles.primary} disabled={busy || live || assetBusy || !!project.proposal} onClick={() => void action(download)}><Download size={16} /> Unduh PPTX</button></div></header>
    {error && <div role="alert" className={styles.error}><span>{error}</span><button onClick={() => void action(async () => { if (!dirty || window.confirm("Muat ulang akan mengganti perubahan yang belum disimpan.")) adopt((await api<{ project: Project }>(root)).project); })}>Muat ulang hasil</button><button onClick={() => setError("")} aria-label="Tutup pesan"><X size={16} /></button></div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {(busy || live || run?.status === "paused") && <div className={styles.runStatus} role="status"><Loader2 size={16} className={busy || live ? "animate-spin" : ""} /><span>{run ? describeRunStatus(run) : "Menyiapkan slide Anda..."} {events.at(-1)}</span>{run && (live || run.status === "paused") && <button onClick={async () => { try { setRun((await api<{ run: AgentRunPublic }>(`${root}/run`, { runId: run.id, action: "cancel" })).run); } catch (e) { setError(getErrorMessage(e)); } }}>Batalkan</button>}{run?.status === "paused" && <button disabled={busy || dirty} onClick={resume}>Lanjutkan</button>}</div>}
    {generation && !busy && !live && !project.proposal && <div className={styles.proposal}><p>Bahan siap. Jika generasi terputus, Anda bisa mencoba lagi tanpa mengunggah ulang selama halaman ini tetap terbuka.</p><button disabled={checkingRun || dirty} onClick={() => void follow(() => authenticatedFetch(`${root}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...generation, baseRevision: project.revision }) }))}>Coba buat slide lagi</button></div>}
    {project.proposal && <div className={styles.proposal}><div><strong>Hasil AI siap ditinjau</strong><p>Pilih slide di kiri untuk melihat hasilnya. Periksa fakta dan sumber sebelum digunakan.</p></div><button onClick={() => setShowProposal(!showProposal)}>{showProposal ? "Bandingkan versi sebelumnya" : "Lihat hasil AI"}</button><button disabled={busy || dirty || !showProposal} onClick={() => void action(async () => { adopt((await api<{ project: Project }>(`${root}/proposal`, { baseRevision: project.revision, runId: project.proposal!.runId, action: "accept" })).project); setNotice("Hasil diterapkan. Klik teks atau gambar di slide untuk mulai mengedit."); })}><Check size={16} /> Gunakan hasil ini</button><button disabled={busy} onClick={() => void action(async () => { adopt((await api<{ project: Project }>(`${root}/proposal`, { baseRevision: project.revision, runId: project.proposal!.runId, action: "discard" })).project); })}>Abaikan</button></div>}
    <div className={styles.workspace}>
      <aside className={styles.filmstrip} aria-label="Daftar slide"><div className={styles.railHeading}><strong>Slide Anda</strong><span>{activeDeck.slides.length}</span></div><ol>{activeDeck.slides.map((item, i) => <li key={item.id}><button aria-current={index === i ? "true" : undefined} className={index === i ? styles.activeSlide : ""} onClick={() => { setSelected(i); setTarget("title"); }}><Preview deck={activeDeck} index={i} /><span><b>{String(i + 1).padStart(2, "0")}</b> {item.title}</span></button></li>)}</ol><button disabled={disabled || deck.slides.length >= 20} onClick={() => add()}><Plus size={15} /> Tambah slide</button></aside>
      <section className={styles.stage}><div className={styles.stageHeading}><span>SLIDE {index + 1} / {activeDeck.slides.length}</span><span>Klik objek, geser, atau tarik sudutnya</span></div><SlideCanvas key={slide.id} deck={activeDeck} index={index} disabled={disabled} selected={target} onSelect={(value) => { setTarget(value); setPanel("edit"); }} onChange={(value) => editSlide(value)} /><div className={styles.quickTools}><button disabled={disabled} onClick={() => fileInput.current?.click()}><ImagePlus size={16} /> Tambah gambar</button><input ref={fileInput} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void uploadImage(file); }} /><button disabled={disabled || index === 0} onClick={() => reorder(-1)} aria-label="Geser slide ke atas"><ArrowUp size={16} /></button><button disabled={disabled || index === deck.slides.length - 1} onClick={() => reorder(1)} aria-label="Geser slide ke bawah"><ArrowDown size={16} /></button><button disabled={disabled || deck.slides.length >= 20} onClick={() => add(true)}><Copy size={16} /> Duplikat</button><button disabled={disabled || deck.slides.length === 1} onClick={() => { if (window.confirm("Hapus slide ini?")) { setDeck({ ...deck, slides: deck.slides.filter((_, i) => i !== index) }); setSelected(Math.max(0, index - 1)); } }} aria-label="Hapus slide"><Trash2 size={16} /></button></div><p className={styles.previewNote}>Teks dan posisi objek ikut ke PPTX. Font dan animasi dapat berbeda di PowerPoint.</p>{issues.length > 0 && <details className={styles.quality}><summary>Periksa kualitas slide ({issues.length})</summary>{issues.map((issue) => <p key={issue.code}>{issue.message}</p>)}</details>}</section>
      <aside className={styles.inspector}><div className={styles.tabs} role="tablist" aria-label="Edit presentasi">{([['edit', 'Edit'], ['design', 'Tampilan'], ['history', 'Versi']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={panel === id} onClick={() => setPanel(id)}>{label}</button>)}</div>
        {panel === "edit" && <div className={styles.panel}><h3>{target ? TARGET_LABELS[target] : "Pilih objek di slide"}</h3><fieldset disabled={disabled}>{target && target !== "art" && <label>Ubah teks<textarea rows={5} maxLength={target === "title" ? 120 : target === "eyebrow" ? 60 : 220} value={targetText} onChange={(e) => { if (target === "title") editSlide({ title: e.target.value }); else if (target === "eyebrow") editSlide({ eyebrow: e.target.value }); else { const body = [...slide.body]; body[Number(target.slice(5))] = e.target.value; editSlide({ body }); } }} /></label>}{target === "art" && <><p className={styles.help}>Geser gambar di kanvas atau tarik titik sudut untuk mengatur ukuran.</p><button onClick={() => editSlide({ art: undefined, adjustments: (slide.adjustments || []).filter((item) => item.target !== "art") })}><Trash2 size={14} /> Hapus gambar</button></>}{target && slide.adjustments?.some((item) => item.target === target) && <button onClick={() => editSlide({ adjustments: (slide.adjustments || []).filter((item) => item.target !== target) })}>Kembalikan posisi awal</button>}<small>Tip: pilih objek, lalu gunakan tombol panah untuk menggeser sedikit. Shift + panah untuk langkah lebih besar.</small><label>Catatan pembicara<textarea rows={4} maxLength={2000} value={slide.notes} onChange={(e) => editSlide({ notes: e.target.value })} /></label></fieldset><div className={styles.aiSection}><h3><Sparkles size={15} /> Minta AI memperbaiki slide</h3><label>Yang ingin diubah<textarea rows={3} maxLength={4000} disabled={busy || live} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Misalnya: ringkas penjelasannya, tapi jangan ubah angka" /></label><label>Pertahankan<select value={preserve} onChange={(e) => setPreserve(e.target.value as typeof preserve)}><option value="content">Isi dan sumber</option><option value="design">Tampilan dan posisi</option><option value="none">Boleh ubah keduanya</option></select></label><button disabled={disabled || dirty || slide.locked || !instruction.trim()} onClick={revise}><Sparkles size={15} /> Buat usulan</button>{dirty && <small>Simpan perubahan sebelum meminta revisi AI.</small>}</div><details className={styles.advanced}><summary>Isi dan pengaturan tambahan</summary><fieldset disabled={disabled}><label>Nama presentasi<input maxLength={120} value={deck.title} onChange={(e) => setDeck({ ...deck, title: e.target.value })} /></label><label>Komposisi<select value={slide.layout} onChange={(e) => editSlide({ layout: e.target.value as PresentationSlide["layout"], adjustments: [] })}>{LAYOUT_IDS.map((id) => <option key={id} value={id}>{LAYOUT_LABELS[id]}</option>)}</select></label><label>Sumber ringkas<textarea rows={2} maxLength={350} value={slide.source} onChange={(e) => editSlide({ source: e.target.value })} /></label>{slide.body.map((text, i) => <label key={i}>Teks {i + 1}<textarea maxLength={220} value={text} onChange={(e) => editSlide({ body: slide.body.map((value, j) => i === j ? e.target.value : value) })} /></label>)}<button disabled={slide.body.length >= 4} onClick={() => editSlide({ body: [...slide.body, "Teks baru"] })}><Plus size={14} /> Tambah teks</button><button aria-pressed={slide.locked} onClick={() => editSlide({ locked: !slide.locked })}>{slide.locked ? "Buka kunci AI" : "Kunci dari revisi AI"}</button></fieldset></details></div>}
        {panel === "design" && <><div className={styles.panel}><h3>Tampilan yang Anda suka</h3><div className={styles.presetOptions}>{DESIGN_PRESETS.map((preset) => <button disabled={disabled || deck.slides.some((item) => item.locked)} key={preset.id} aria-pressed={deck.palette === preset.palette && deck.artDirection?.style === preset.artDirection.style && deck.theme === preset.theme} onClick={() => setDeck({ ...deck, theme: preset.theme, palette: preset.palette, artDirection: preset.artDirection })}>{preset.label}</button>)}</div><label>Animasi semua slide<select disabled={disabled} value={deck.slides.every((item) => item.visual?.motion === deck.slides[0].visual?.motion) ? deck.slides[0].visual?.motion || "none" : "mixed"} onChange={(e) => setAllMotion(e.target.value as "none" | "fade" | "push" | "reveal")}><option value="mixed" disabled>Berbeda per slide</option><option value="none">Tanpa animasi</option><option value="fade">Halus / memudar</option><option value="push">Bergeser</option><option value="reveal">Judul muncul</option></select></label><button onClick={() => setPlaying(true)}><Play size={16} /> Lihat saat pindah slide</button><small>Pilihan animasi juga diekspor ke PPTX. Pengaturan tanpa animasi tidak dipaksa menjadi animasi oleh AI.</small></div><details className={styles.advanced}><summary>Elemen, background & gambar AI</summary><VisualControls key={slide.id} root={root} revision={project.revision} deck={activeDeck} slide={slide} disabled={disabled} saved={!dirty} onDeckChange={setDeck} onSlideChange={editSlide} onBusyChange={setAssetBusy} /></details></>}
        {panel === "history" && <div className={styles.panel}><h3>Versi sebelumnya</h3><p className={styles.help}>Lima versi terakhir bisa dipulihkan tanpa menimpa versi saat ini.</p>{project.history.map((item) => <div className={styles.historyItem} key={item.revision}><strong>Versi {item.revision}: {item.title}</strong><small>{new Date(item.createdAt).toLocaleString("id-ID")}</small><button disabled={disabled || dirty} onClick={() => void action(async () => { if (window.confirm(`Pulihkan versi ${item.revision}?`)) adopt((await api<{ project: Project }>(`${root}/restore`, { baseRevision: project.revision, revision: item.revision })).project); })}>Pulihkan</button></div>)}<button className={styles.danger} disabled={busy || live || assetBusy} onClick={() => void action(async () => { if (window.confirm("Hapus presentasi dan riwayatnya?")) { await api(root, {}, "DELETE"); onClose(); } })}><Trash2 size={15} /> Hapus presentasi</button></div>}
      </aside>
    </div>
    {playing && <SlidePlayer deck={activeDeck} initialIndex={index} onClose={closePlayer} />}
  </main>;
}
