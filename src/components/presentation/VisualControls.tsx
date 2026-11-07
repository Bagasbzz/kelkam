"use client";

import { useEffect, useState } from "react";
import { ImagePlus, RefreshCw, Sparkles, X } from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";
import type { PresentationDeck, PresentationSlide } from "@/lib/presentation/model";
import styles from "./presentation.module.css";

interface ArtJob { id: string; status: "queued" | "running" | "done" | "failed"; title: string; fileId: string | null; error: string | null }
const STYLES = { geometric: "Geometric / bidang diagonal", zine: "Zine / kolase & halftone", kinetic: "Kinetic / tipografi ekspresif", blueprint: "Blueprint / sistem & jaringan", minimal: "Minimal / fokus pesan" };
const MOTIFS = { network: "Jaringan / koneksi", campus: "Kampus / ruang", botanical: "Botani / lingkungan", megaphone: "Megafon / komunikasi", orbit: "Orbit / sistem", none: "Tanpa ilustrasi native" };
const BACKGROUNDS = { solid: "Warna solid", halftone: "Halftone / titik cetak", grid: "Grid teknis", spotlight: "Spotlight / bidang cahaya" };
const MOTIONS = { none: "Tanpa animasi", fade: "Memudar", push: "Bergeser", reveal: "Judul muncul" };

async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await authenticatedFetch(url, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.success) throw new Error(value?.error || "Permintaan aset gagal.");
  return value;
}

export default function VisualControls({ root, revision, deck, slide, disabled, saved, onDeckChange, onSlideChange, onBusyChange }: {
  root: string; revision: number; deck: PresentationDeck; slide: PresentationSlide; disabled: boolean; saved: boolean;
  onDeckChange: (deck: PresentationDeck) => void; onSlideChange: (patch: Partial<PresentationSlide>) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [role, setRole] = useState<"hero" | "background" | "cutout">(slide.art?.role || "hero");
  const [jobs, setJobs] = useState<ArtJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollingFailed, setPollingFailed] = useState(false);
  const [listing, setListing] = useState(true);
  const visual = slide.visual ?? { motif: "none" as const, background: "solid" as const, motion: "none" as const };
  const active = jobs.some((job) => job.status === "queued" || job.status === "running");
  const lockedDeck = deck.slides.some((item) => item.locked);
  const style = deck.artDirection?.style ?? (deck.theme === "playful" ? "zine" : deck.theme === "product" ? "kinetic" : "geometric");

  useEffect(() => {
    const controller = new AbortController();
    request<{ jobs: ArtJob[] }>(`${root}/art`, undefined, controller.signal).then((result) => setJobs(result.jobs)).catch((e) => { if (!controller.signal.aborted) { setError(getErrorMessage(e)); setPollingFailed(true); } }).finally(() => { if (!controller.signal.aborted) setListing(false); });
    return () => controller.abort();
  }, [root]);

  useEffect(() => {
    if (!active || pollingFailed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      request<{ jobs: ArtJob[] }>(`${root}/art`, undefined, controller.signal).then((result) => setJobs(result.jobs)).catch((e) => { if (!controller.signal.aborted) { setError(getErrorMessage(e)); setPollingFailed(true); } });
    }, 5000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [active, jobs, root, pollingFailed]);

  async function createArt() {
    if (disabled || !saved || busy || slide.locked || listing || pollingFailed || active) return;
    setBusy(true); onBusyChange(true); setError("");
    try {
      const result = await request<{ job: ArtJob }>(`${root}/art`, { baseRevision: revision, slideId: slide.id, prompt, role });
      setJobs((items) => [result.job, ...items]); setPollingFailed(false);
    } catch (e) { setError(getErrorMessage(e)); } finally { setBusy(false); onBusyChange(false); }
  }

  return <div className={`${styles.panel} ${styles.visualPanel}`}>
    <h3>Desain dan elemen</h3>
    <p className={styles.help}>Atur gaya visual, ilustrasi, dan latar belakang slide.</p>
    <fieldset disabled={disabled}>
      <label>Gaya visual presentasi<select disabled={lockedDeck} value={style} onChange={(e) => onDeckChange({ ...deck, artDirection: { style: e.target.value as keyof typeof STYLES, concept: deck.artDirection?.concept || "" } })}>{Object.entries(STYLES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Konsep visual<textarea rows={3} maxLength={400} disabled={lockedDeck} value={deck.artDirection?.concept || ""} onChange={(e) => onDeckChange({ ...deck, artDirection: { style, concept: e.target.value } })} placeholder="Contoh: kampanye kampus sebagai zine, megafon dan halftone untuk gagasan mahasiswa" /></label>
      {lockedDeck && <small>Buka kunci slide sebelum mengubah desain seluruh presentasi.</small>}
      <label>Elemen ilustratif<select value={visual.motif} onChange={(e) => onSlideChange({ visual: { ...visual, motif: e.target.value as keyof typeof MOTIFS } })}>{Object.entries(MOTIFS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Latar belakang<select value={visual.background} onChange={(e) => onSlideChange({ visual: { ...visual, background: e.target.value as keyof typeof BACKGROUNDS } })}>{Object.entries(BACKGROUNDS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Animasi<select value={visual.motion} onChange={(e) => onSlideChange({ visual: { ...visual, motion: e.target.value as keyof typeof MOTIONS } })}>{Object.entries(MOTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <small>PNG/PDF tidak memutar animasi. Gunakan Slide Show di PowerPoint untuk memeriksa hasil PPTX. Mode web hanya simulasi.</small>
      <hr />
      <h3><ImagePlus size={16} /> Gambar dan latar belakang</h3>
      <label>Peran gambar<select value={role} onChange={(e) => { setRole(e.target.value as typeof role); if (slide.art) onSlideChange({ art: { ...slide.art, role: e.target.value as typeof role } }); }}><option value="hero">Hero / gambar utama</option><option value="background">Background</option><option value="cutout">Cutout / ilustrasi terpisah</option></select></label>
      {slide.art && <div className={styles.attachedArt}><span>Aset terpasang: {slide.art.alt || "Gambar slide"}</span><button onClick={() => onSlideChange({ art: undefined })}><X size={14} /> Lepas</button><small>Perubahan perlu disimpan. Foto/ilustrasi menjadi gambar; teks dan bentuk tetap editable.</small></div>}
      <label>Instruksi gambar AI<textarea rows={4} maxLength={2000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Jelaskan objek, suasana, dan hubungan dengan materi. Jangan minta gambar satu slide lengkap." /></label>
      <button disabled={busy || disabled || !saved || slide.locked || prompt.trim().length < 8 || active || listing || pollingFailed} onClick={() => void createArt()}><Sparkles size={15} /> {listing ? "Memeriksa aset..." : busy ? "Memproses..." : "Buat gambar AI"}</button>
      <small>Memakai anggaran AI akun. Generasi hanya berjalan saat tombol ditekan. Hasil tidak otomatis mengganti slide; pilih aset selesai dan simpan. Cutout tidak menjamin latar transparan dari provider.</small>
      {!saved && <small>Simpan presentasi sebelum membuat gambar AI.</small>}
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.artJobs}>{jobs.map((job) => <div className={styles.artJob} key={job.id}><strong>{job.title}</strong><span>{job.status === "done" ? "Siap dipakai" : job.status === "failed" ? "Gagal" : "Sedang membuat aset..."}</span>{job.error && <small>{job.error}</small>}{job.status === "done" && job.fileId && <button disabled={disabled || busy} onClick={() => onSlideChange({ art: { fileId: job.fileId!, role, alt: job.title.slice(0, 300) } })}>Pasang ke slide ini</button>}</div>)}</div>
    {pollingFailed && <button onClick={async () => { try { setJobs((await request<{ jobs: ArtJob[] }>(`${root}/art`)).jobs); setPollingFailed(false); setError(""); } catch (e) { setError(getErrorMessage(e)); } }}><RefreshCw size={14} /> Cek status lagi</button>}
  </div>;
}
