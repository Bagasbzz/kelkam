"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Download, History, Loader2, LockKeyhole, Plus, Save, Sparkles, Trash2, UnlockKeyhole, Upload, X } from "lucide-react";
import { authenticatedFetch, useAuth } from "@/components/AuthProvider";
import { describeRunStatus, fetchActiveRun, followRun, isRunLive, type AgentRunPublic } from "@/lib/client/agent-run";
import { getErrorMessage } from "@/lib/errors";
import { createStarterDeck, deckSchema, LAYOUT_IDS, THEMES, THEME_IDS, type PresentationDeck, type PresentationSlide, type PresentationTheme } from "@/lib/presentation/model";
import { layoutSlide, renderSlideSvg } from "@/lib/presentation/layout";
import styles from "./presentation.module.css";
import VisualControls from "./VisualControls";

interface Summary { id: string; title: string; revision: number; updatedAt: string }
interface Project {
  id: string;
  revision: number;
  deck: PresentationDeck;
  history: { revision: number; title: string; createdAt: string }[];
  proposal?: { runId: string; baseRevision: number; deck: PresentationDeck } | null;
}
const LAYOUT_LABELS = { title: "Pembuka", split: "Sorotan", cards: "Kartu", timeline: "Alur", statement: "Pernyataan" };

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

function Preview({ deck, index, small = false, playback = 0 }: { deck: PresentationDeck; index: number; small?: boolean; playback?: number }) {
  const slide = deck.slides[index];
  const svg = renderSlideSvg(layoutSlide(slide, deck.theme, index, deck.slides.length, deck.artDirection));
  return <div key={`${slide.id}:${playback}`} className={`${small ? styles.mini : styles.preview} ${!small && playback ? styles.motionPreview : ""}`} data-motion={slide.visual?.motion || "none"} role="img" aria-label={`Slide ${index + 1}: ${slide.title}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function PresentationWorkspace() {
  const { user, loading, openLoginModal } = useAuth();
  if (loading) return <div className={styles.loading}><Loader2 className="animate-spin" /> Memuat workspace...</div>;
  if (!user) return <main className={styles.landing}><p className={styles.kicker}>PRESENTATION STUDIO</p><h1>Cerita yang kuat.<br />Slide yang punya karakter.</h1><p>Masuk untuk menyimpan presentasi dan mengekspor PowerPoint editable.</p><button className={styles.primary} onClick={openLoginModal}>Masuk ke workspace</button></main>;
  return <PresentationLibrary key={user.id} owner={user.id} />;
}

function PresentationLibrary({ owner }: { owner: string }) {
  const [projects, setProjects] = useState<Summary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [theme, setTheme] = useState<PresentationTheme>("playful");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    api<{ projects: Summary[] }>("/api/presentasi", undefined, "GET", controller.signal)
      .then((data) => setProjects(data.projects))
      .catch((e) => { if (!controller.signal.aborted) setError(getErrorMessage(e)); });
    return () => controller.abort();
  }, [owner]);

  async function open(id?: string) {
    setBusy(true); setError("");
    try {
      const data = id
        ? await api<{ project: Project }>(`/api/presentasi/${id}`)
        : await api<{ project: Project }>("/api/presentasi", { theme });
      setProject(data.project);
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function close() {
    setProject(null);
    try { setProjects((await api<{ projects: Summary[] }>("/api/presentasi")).projects); }
    catch (e) { setError(getErrorMessage(e)); }
  }

  if (project) return <DeckEditor key={`${owner}:${project.id}`} initial={project} onClose={close} />;

  const demo = createStarterDeck(theme);
  return <main className={styles.landing}>
    <header className={styles.hero}><div><p className={styles.kicker}>PRESENTATION STUDIO / BETA</p><h1>Bukan sekadar<br />poin di atas slide.</h1><p>Susun alur cerita, temukan karakter visual, lalu lanjutkan di PowerPoint. Teks dan bentuk tetap bisa diedit.</p></div><div className={styles.heroPreview}><Preview deck={demo} index={0} /><span>Contoh desain, bukan hasil AI untuk topik Anda.</span></div></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <section className={styles.start}><div className={styles.sectionHeading}><h2>Mulai dari arah visual</h2><span>Bisa diganti tanpa mengubah isi</span></div><div className={styles.themes}>{THEME_IDS.map((id) => <button key={id} aria-pressed={theme === id} className={`${styles.theme} ${theme === id ? styles.chosen : ""}`} onClick={() => setTheme(id)}><div className={styles.swatches}>{[THEMES[id].background, THEMES[id].foreground, THEMES[id].accent, THEMES[id].secondary].map((color, i) => <i key={i} style={{ background: `#${color}` }} />)}</div><strong>{THEMES[id].label}</strong><span>{THEMES[id].description}</span></button>)}</div><button className={styles.primary} disabled={busy} onClick={() => open()}>{busy ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />} Buat presentasi</button></section>
    <section><div className={styles.sectionHeading}><h2>Presentasi Anda</h2><span>{projects.length} workspace</span></div><div className={styles.projects}>{projects.map((item) => <button className={styles.project} key={item.id} disabled={busy} onClick={() => open(item.id)}><span className={styles.projectMark}>P</span><strong>{item.title}</strong><span>Versi {item.revision} / {new Date(item.updatedAt).toLocaleDateString("id-ID")}</span></button>)}{!projects.length && <p className={styles.empty}>Belum ada presentasi. Mulai dengan contoh yang bisa diedit, atau susun deck baru dari bahan Anda.</p>}</div></section>
  </main>;
}

function DeckEditor({ initial, onClose }: { initial: Project; onClose: () => void }) {
  const [project, setProject] = useState(initial);
  const [deck, setDeck] = useState(initial.deck);
  const [selected, setSelected] = useState(0);
  const [panel, setPanel] = useState<"isi" | "cerita" | "riwayat">("isi");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [checkingRun, setCheckingRun] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<AgentRunPublic | null>(null);
  const [prompt, setPrompt] = useState("");
  const [material, setMaterial] = useState("");
  const [audience, setAudience] = useState("Mahasiswa di kelas");
  const [minutes, setMinutes] = useState(10);
  const [slideCount, setSlideCount] = useState(6);
  const [instruction, setInstruction] = useState("");
  const [preserve, setPreserve] = useState<"content" | "design" | "none">("content");
  const [showProposal, setShowProposal] = useState(!!initial.proposal);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [playback, setPlayback] = useState(0);
  const [assetBusy, setAssetBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dirty = JSON.stringify(deck) !== JSON.stringify(project.deck);
  const root = `/api/presentasi/${project.id}`;
  const activeDeck = showProposal && project.proposal ? project.proposal.deck : deck;
  const index = Math.min(selected, activeDeck.slides.length - 1);
  const slide = activeDeck.slides[index];
  const issues = layoutSlide(slide, activeDeck.theme, index, activeDeck.slides.length, activeDeck.artDirection).issues;
  const live = !!run && isRunLive(run.status);
  const editingDisabled = checkingRun || busy || assetBusy || live || !!project.proposal;

  function adopt(next: Project) {
    setProject(next); setDeck(next.deck); setShowProposal(!!next.proposal);
    setSelected((value) => Math.min(value, next.deck.slides.length - 1));
  }

  async function follow(first: () => Promise<Response>, knownId = "") {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); abort.current = controller;
    let runId = knownId;
    try {
      const result = await followRun({ first, continueUrl: `${root}/run`, runId: () => runId, signal: controller.signal, observer: { onRun: (value) => { runId = value.id; setRun(value); } } });
      if (controller.signal.aborted) return;
      adopt((await api<{ project: Project }>(root, undefined, "GET", controller.signal)).project);
      if (result?.error) setError(result.error);
      else if (result?.status === "done") setNotice("Usulan AI siap ditinjau. Isi lama belum diganti.");
    } catch (e) { if (!controller.signal.aborted) setError(getErrorMessage(e)); }
    finally { if (!controller.signal.aborted) { setBusy(false); busyRef.current = false; } }
  }

  useEffect(() => {
    let disposed = false;
    fetchActiveRun(`${root}/run`).then((active) => {
      if (disposed || !active) return;
      setRun(active);
      if (isRunLive(active.status)) void follow(() => authenticatedFetch(`${root}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: active.id, action: "continue" }) }), active.id);
    }).catch(() => { /* The next explicit action reports API failures. */ }).finally(() => { if (!disposed) setCheckingRun(false); });
    return () => { disposed = true; abort.current?.abort(); };
    // Each editor instance belongs to exactly one project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function editSlide(patch: Partial<PresentationSlide>) {
    if (editingDisabled) return;
    const targetId = slide.id;
    setDeck((current) => ({ ...current, slides: current.slides.map((item) => item.id === targetId ? { ...item, ...patch } : item) }));
  }

  async function action(work: () => Promise<void>) {
    if (busyRef.current || checkingRun || assetBusy) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(getErrorMessage(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }

  async function save() {
    const parsed = deckSchema.safeParse(deck);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Periksa isi slide.");
    const next = (await api<{ project: Project }>(root, { baseRevision: project.revision, deck: parsed.data }, "PATCH")).project;
    adopt(next); setNotice("Presentasi tersimpan."); return next;
  }

  function reorder(offset: number) {
    const target = index + offset;
    if (target < 0 || target >= deck.slides.length) return;
    const slides = [...deck.slides]; [slides[index], slides[target]] = [slides[target], slides[index]];
    setDeck({ ...deck, slides }); setSelected(target);
  }

  function addSlide(duplicate = false) {
    if (deck.slides.length >= 20) return;
    const item: PresentationSlide = duplicate ? { ...deck.slides[index], id: crypto.randomUUID(), locked: false } : { id: crypto.randomUUID(), title: "Satu pesan utama", eyebrow: "", body: ["Tambahkan gagasan pendukung di sini."], source: "", notes: "", layout: "cards", locked: false };
    const slides = [...deck.slides]; slides.splice(index + 1, 0, item); setDeck({ ...deck, slides }); setSelected(index + 1);
  }

  async function exportPptx() {
    const saved = dirty ? await save() : project;
    const response = await authenticatedFetch(`${root}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: saved.revision }) });
    if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error || "Ekspor gagal."); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `${saved.deck.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "presentasi"}.pptx`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("PPTX diunduh. Periksa font dan tata letak di PowerPoint sebelum presentasi.");
  }

  async function upload() {
    if (!pendingFile) return;
    if (pendingFile.size > 12 * 1024 * 1024) throw new Error("Bahan maksimal 12 MB.");
    const form = new FormData(); form.append("file", pendingFile);
    const response = await authenticatedFetch("/api/context/extract", { method: "POST", body: form });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.success) throw new Error(result?.error || "Bahan gagal dibaca.");
    const combined = [material, String(result.data.content)].filter(Boolean).join("\n\n");
    if (combined.length > 40000) throw new Error("Gabungan bahan melebihi 40.000 karakter. Ringkas bahan atau unggah dokumen lebih pendek.");
    setMaterial(combined); setPendingFile(null); setNotice("Teks bahan ditambahkan. Gambar tidak otomatis dimasukkan ke slide.");
  }

  function startAi(kind: "generate" | "revise") {
    if (checkingRun || assetBusy) return;
    if (dirty) { setError("Simpan perubahan sebelum meminta AI agar versi acuannya jelas."); return; }
    if (project.proposal) { setError("Terapkan atau abaikan usulan yang ada sebelum meminta usulan baru."); return; }
    const body = kind === "generate" ? { baseRevision: project.revision, prompt, materialText: material, audience, minutes, slideCount } : { baseRevision: project.revision, slideId: slide.id, instruction, preserve };
    void follow(() => authenticatedFetch(`${root}/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  }

  function resumeRun() {
    if (!run) return;
    if (dirty) { setError("Perubahan lokal belum disimpan. Batalkan proses lama sebelum menyimpan dan meminta revisi baru."); return; }
    void follow(() => authenticatedFetch(`${root}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, action: "resume" }) }), run.id);
  }

  return <main className={styles.editor}>
    <header className={styles.toolbar}><button className={styles.back} disabled={busy || live} onClick={() => { if (!dirty || window.confirm("Perubahan belum disimpan. Tinggalkan editor?")) onClose(); }}>Semua presentasi</button><div className={styles.documentTitle}><strong>{deck.title}</strong><span>Versi {project.revision} / {dirty ? "Belum disimpan" : "Tersimpan"}</span></div><div className={styles.toolbarActions}><button disabled={busy || live || !dirty || showProposal} onClick={() => void action(async () => { await save(); })}><Save size={16} /> Simpan</button><button className={styles.primary} disabled={busy || live || showProposal} onClick={() => void action(exportPptx)}><Download size={16} /> Unduh PPTX</button></div></header>
    {error && <div role="alert" className={styles.error}>{error}<button onClick={() => setError("")} aria-label="Tutup pesan"><X size={16} /></button>{error.includes("Muat ulang") && <button onClick={() => void action(async () => { if (!dirty || window.confirm("Muat ulang akan mengganti perubahan lokal yang belum disimpan.")) adopt((await api<{ project: Project }>(root)).project); })}>Muat versi server</button>}</div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {run && (busy || live || run.status === "paused") && <div className={styles.runStatus} role="status"><Loader2 size={16} className={live ? "animate-spin" : ""} /><span>{describeRunStatus(run)} {run.events.at(-1)?.text}</span>{(live || run.status === "paused") && <button onClick={async () => { try { const data = await api<{ run: AgentRunPublic }>(`${root}/run`, { runId: run.id, action: "cancel" }); setRun(data.run); } catch (e) { setError(getErrorMessage(e)); } }}>Batalkan AI</button>}{run.status === "paused" && <button disabled={busy || dirty} onClick={resumeRun}>Lanjutkan</button>}</div>}
    {project.proposal && <div className={styles.proposal}><div><strong>Usulan AI, belum diterapkan</strong><p>Tinjau alur dan isi slide. Fakta, angka, serta sumber tetap perlu diperiksa.</p></div><button onClick={() => setShowProposal(!showProposal)}>{showProposal ? "Lihat versi tersimpan" : "Lihat usulan"}</button><button disabled={busy || dirty || !showProposal} onClick={() => void action(async () => { adopt((await api<{ project: Project }>(`${root}/proposal`, { baseRevision: project.revision, runId: project.proposal!.runId, action: "accept" })).project); setNotice("Usulan diterapkan sebagai versi baru."); })}><Check size={16} /> Terapkan</button><button disabled={busy} onClick={() => void action(async () => { adopt((await api<{ project: Project }>(`${root}/proposal`, { baseRevision: project.revision, runId: project.proposal!.runId, action: "discard" })).project); })}>Abaikan</button></div>}
    <div className={styles.workspace}>
      <aside className={styles.filmstrip} aria-label="Daftar slide"><div className={styles.railHeading}><strong>Alur cerita</strong><span>{activeDeck.slides.length} slide</span></div><ol>{activeDeck.slides.map((item, i) => <li key={item.id}><button aria-current={index === i ? "true" : undefined} className={index === i ? styles.activeSlide : ""} onClick={() => setSelected(i)}><Preview deck={activeDeck} index={i} small /><span><b>{String(i + 1).padStart(2, "0")}</b> {item.title} {item.locked && <LockKeyhole size={12} />}</span></button></li>)}</ol><button disabled={editingDisabled || deck.slides.length >= 20} onClick={() => addSlide()}><Plus size={15} /> Tambah slide</button></aside>
      <section className={styles.stage}><div className={styles.stageHeading}><span>{showProposal ? "USULAN" : "KANVAS"} / {String(index + 1).padStart(2, "0")}</span><button className={styles.playMotion} onClick={() => setPlayback((value) => value + 1)}>Putar preview motion</button><span>16:9 / Native PPTX</span></div><Preview deck={activeDeck} index={index} playback={playback} /><p className={styles.previewNote}>Preview motion web adalah simulasi, bukan render PowerPoint. Periksa animasi melalui Slide Show pada PPTX.</p><div className={styles.slideActions}><button title="Geser ke atas" disabled={editingDisabled || index === 0} onClick={() => reorder(-1)}><ArrowUp size={16} /> Naik</button><button disabled={editingDisabled || index === deck.slides.length - 1} onClick={() => reorder(1)}><ArrowDown size={16} /> Turun</button><button disabled={editingDisabled || deck.slides.length >= 20} onClick={() => addSlide(true)}><Copy size={16} /> Duplikat</button><button disabled={editingDisabled || deck.slides.length === 1} onClick={() => { if (window.confirm("Hapus slide ini?")) { setDeck({ ...deck, slides: deck.slides.filter((_, i) => i !== index) }); setSelected(Math.max(0, index - 1)); } }}><Trash2 size={16} /> Hapus</button></div>{issues.length > 0 && <div className={styles.quality}><strong>Catatan kualitas</strong>{issues.map((issue) => <p key={issue.code}>{issue.message}</p>)}</div>}<div className={styles.storyline}><h2>Pesan slide</h2><p>{slide.title}</p><span>{slide.notes || "Tambahkan catatan pembicara untuk detail yang tidak perlu memenuhi slide."}</span></div></section>
      <aside className={styles.inspector}><div className={styles.tabs} role="tablist" aria-label="Pengaturan presentasi">{([['isi', 'Edit slide'], ['cerita', 'Susun AI'], ['riwayat', 'Versi']] as const).map(([id, label]) => <button key={id} role="tab" aria-selected={panel === id} onClick={() => setPanel(id)}>{label}</button>)}</div>
        {panel === "isi" && <VisualControls key={slide.id} root={root} revision={project.revision} deck={activeDeck} slide={slide} disabled={editingDisabled} saved={!dirty} onDeckChange={setDeck} onSlideChange={editSlide} onBusyChange={setAssetBusy} />}
        {panel === "isi" && <div className={styles.panel}><fieldset disabled={editingDisabled}><label>Judul deck<input maxLength={120} value={deck.title} onChange={(e) => setDeck({ ...deck, title: e.target.value })} /></label><label>Arah visual<select value={deck.theme} onChange={(e) => setDeck({ ...deck, theme: e.target.value as PresentationTheme })}>{THEME_IDS.map((id) => <option key={id} value={id}>{THEMES[id].label}</option>)}</select></label><hr /><label>Label kecil<input maxLength={60} value={slide.eyebrow} onChange={(e) => editSlide({ eyebrow: e.target.value })} /></label><label>Pesan utama<textarea rows={3} maxLength={120} value={slide.title} onChange={(e) => editSlide({ title: e.target.value })} /></label><label>Komposisi<select value={slide.layout} onChange={(e) => editSlide({ layout: e.target.value as PresentationSlide["layout"] })}>{LAYOUT_IDS.map((id) => <option key={id} value={id}>{LAYOUT_LABELS[id]}</option>)}</select></label><div className={styles.fieldHeading}><strong>Gagasan pendukung</strong><span>{slide.body.length}/4</span></div>{slide.body.map((item, i) => <div key={`${slide.id}-${i}`} className={styles.bodyField}><textarea aria-label={`Gagasan ${i + 1}`} rows={3} maxLength={220} value={item} onChange={(e) => editSlide({ body: slide.body.map((value, j) => j === i ? e.target.value : value) })} /><button aria-label={`Hapus gagasan ${i + 1}`} onClick={() => editSlide({ body: slide.body.filter((_, j) => j !== i) })}><X size={14} /></button></div>)}<button disabled={editingDisabled || slide.body.length >= 4} onClick={() => editSlide({ body: [...slide.body, "Gagasan baru"] })}><Plus size={14} /> Gagasan</button><label>Sumber ringkas<textarea rows={2} maxLength={350} value={slide.source} onChange={(e) => editSlide({ source: e.target.value })} /></label><label>Catatan pembicara<textarea rows={5} maxLength={2000} value={slide.notes} onChange={(e) => editSlide({ notes: e.target.value })} /></label><button aria-pressed={slide.locked} onClick={() => editSlide({ locked: !slide.locked })}>{slide.locked ? <LockKeyhole size={15} /> : <UnlockKeyhole size={15} />}{slide.locked ? "Dikunci dari AI" : "Kunci dari perubahan AI"}</button></fieldset><div className={styles.aiSection}><h3>Revisi slide ini</h3><label>Pertahankan<select disabled={busy} value={preserve} onChange={(e) => setPreserve(e.target.value as typeof preserve)}><option value="content">Isi, angka, dan sumber</option><option value="design">Komposisi</option><option value="none">Boleh revisi isi dan komposisi</option></select></label><label>Instruksi<textarea disabled={busy} rows={3} maxLength={4000} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Misalnya: ubah menjadi alur yang lebih visual" /></label><button disabled={busy || live || dirty || slide.locked || !!project.proposal || !instruction.trim()} onClick={() => startAi("revise")}><Sparkles size={15} /> Buat usulan revisi</button>{dirty && <small>Simpan perubahan sebelum menggunakan AI.</small>}</div></div>}
        {panel === "cerita" && <div className={styles.panel}><p className={styles.help}>AI menyusun usulan alur cerita dari bahan Anda. Tinjau sebelum diterapkan. Konten contoh akan diganti; slide terkunci tetap dipertahankan.</p><fieldset disabled={busy || live}><label>Topik dan tujuan<textarea rows={4} maxLength={4000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Apa yang perlu audiens pahami atau lakukan setelah presentasi?" /></label><label>Audiens<input maxLength={200} value={audience} onChange={(e) => setAudience(e.target.value)} /></label><div className={styles.twoFields}><label>Durasi (menit)<input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></label><label>Jumlah slide<input type="number" min={1} max={12} value={slideCount} onChange={(e) => setSlideCount(Number(e.target.value))} /></label></div><label>Bahan dan sumber<textarea rows={10} maxLength={40000} value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Tempel bahan, kutipan laporan, fakta, serta rujukan. Jangan sertakan rahasia atau data pribadi." /></label><small>{material.length.toLocaleString("id-ID")} / 40.000 karakter. Bahan formulir tidak disimpan sebelum dikirim ke AI.</small><label className={styles.upload}><Upload size={16} /> Pilih bahan<input type="file" accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp" onChange={(e) => { setPendingFile(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>{pendingFile && <div className={styles.pendingFile}><span>{pendingFile.name}</span><button onClick={() => void action(upload)}>Baca bahan</button><button aria-label="Batalkan bahan" onClick={() => setPendingFile(null)}><X size={14} /></button></div>}<small>File baru dikirim saat memilih Baca bahan. OCR gambar memakai AI dan anggaran akun. Gambar belum menjadi objek slide.</small><button className={styles.primary} disabled={busy || live || dirty || !!project.proposal || !prompt.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 180 || !Number.isInteger(slideCount) || slideCount < 1 || slideCount > 12} onClick={() => startAi("generate")}><Sparkles size={16} /> Susun usulan cerita</button></fieldset><p className={styles.help}>Tidak ada angka, hasil penelitian, atau sumber yang boleh dianggap terverifikasi hanya karena ditulis AI. Periksa bahan dan usulan sebelum mengunduh.</p></div>}
        {panel === "cerita" && <ReportImport root={root} revision={project.revision} disabled={busy || live || checkingRun} onImport={(text) => setMaterial(text)} />}
        {panel === "riwayat" && <div className={styles.panel}><h3><History size={16} /> Riwayat tersimpan</h3><p className={styles.help}>Lima versi sebelumnya disimpan. Pemulihan membuat versi baru, bukan menghapus riwayat.</p>{project.history.map((item) => <div key={item.revision} className={styles.historyItem}><strong>Versi {item.revision}</strong><span>{item.title}</span><small>{new Date(item.createdAt).toLocaleString("id-ID")}</small><button disabled={busy || live || dirty || !!project.proposal} onClick={() => void action(async () => { if (window.confirm(`Pulihkan versi ${item.revision}?`)) adopt((await api<{ project: Project }>(`${root}/restore`, { baseRevision: project.revision, revision: item.revision })).project); })}>Pulihkan</button></div>)}{!project.history.length && <p className={styles.empty}>Riwayat muncul setelah perubahan pertama disimpan.</p>}<hr /><button className={styles.danger} disabled={busy || live} onClick={() => void action(async () => { if (window.confirm("Hapus workspace presentasi beserta riwayatnya?")) { await api(root, {}, "DELETE"); onClose(); } })}><Trash2 size={15} /> Hapus presentasi</button></div>}
      </aside>
    </div>
  </main>;
}

function ReportImport({ root, revision, disabled, onImport }: { root: string; revision: number; disabled: boolean; onImport: (text: string) => void }) {
  const [reports, setReports] = useState<{ id: string; title: string | null }[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className={styles.panel}>
    <h3>Bahan dari Laporan</h3>
    <p className={styles.help}>Ambil draft milik akun Anda sebagai bahan. Impor mengganti isi kotak bahan, tanpa mengubah dokumen laporan.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button disabled={disabled || busy} onClick={async () => {
      setBusy(true); setError("");
      try { setReports((await api<{ sessions: { id: string; title: string | null }[] }>("/api/laporan/sessions")).sessions); }
      catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); }
    }}>Tampilkan laporan saya</button>
    {reports.length > 0 && <label>Pilih laporan<select disabled={disabled || busy} value={sessionId} onChange={(e) => setSessionId(e.target.value)}><option value="">Pilih draft</option>{reports.map((report) => <option key={report.id} value={report.id}>{report.title || "Laporan tanpa judul"}</option>)}</select></label>}
    <button disabled={disabled || busy || !sessionId} onClick={async () => {
      if (!window.confirm("Ganti bahan formulir dengan draft laporan yang dipilih?")) return;
      setBusy(true); setError("");
      try { onImport((await api<{ text: string }>(`${root}/import-report`, { baseRevision: revision, sessionId })).text); }
      catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); }
    }}>{busy ? "Memuat..." : "Gunakan draft sebagai bahan"}</button>
  </div>;
}
