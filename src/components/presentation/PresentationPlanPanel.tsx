"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, FileText, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { authenticatedFetch } from "@/components/AuthProvider";
import { getErrorMessage } from "@/lib/errors";
import { layoutSlide, renderSlideSvg } from "@/lib/presentation/layout";
import type { PresentationDeck, PresentationSlide, SlideVisual } from "@/lib/presentation/model";
import { DESIGN_PRESETS, type DesignPreset } from "@/lib/presentation/presets";
import styles from "./presentation.module.css";

export interface ChatMaterial { id: string; fileId: string; title: string; fileName: string; kind: string }
export interface PlanImage { slide: number; prompt: string; role: "hero" | "background" | "cutout"; slideId?: string; jobId?: string }
export interface ChatPlan {
  goal: string; audience: string; minutes: number; density: "ringkas" | "seimbang" | "padat"; templateId?: string;
  slides: { role: string; title: string; point: string; material?: string; visual?: string }[];
  images?: PlanImage[]; omitted?: string;
}
export interface ChatSource { kind: "report"; sessionId: string; title: string; draftChars: number }
export interface ArtPlacement { slideId: string; fileId: string; role: PlanImage["role"]; alt: string }
interface ArtJob { id: string; status: "queued" | "running" | "done" | "failed"; title: string; fileId: string | null; error: string | null }

const DENSITY_LABEL = { ringkas: "Teks ringkas", seimbang: "Teks seimbang", padat: "Teks padat" } as const;
const ROLE_LABEL = { hero: "Gambar utama", background: "Latar belakang", cutout: "Ilustrasi terpisah" } as const;
const MOTIF_BY_STYLE: Record<string, SlideVisual["motif"]> = { geometric: "botanical", zine: "megaphone", kinetic: "orbit", blueprint: "network", minimal: "none" };
const BACKGROUND_BY_STYLE: Record<string, SlideVisual["background"]> = { geometric: "solid", zine: "halftone", kinetic: "spotlight", blueprint: "grid", minimal: "solid" };
const SAMPLE_ID = "00000000-0000-4000-8000-000000000001";

/** Labels the AI may offer as answer options; a match shows the picture instead of a plain chip. */
export const TEMPLATE_LABELS = new Set(DESIGN_PRESETS.map((preset) => preset.label.toLowerCase()));

function sampleSvg(preset: DesignPreset) {
  const slide: PresentationSlide = {
    id: SAMPLE_ID, title: preset.label, eyebrow: "CONTOH TAMPILAN", body: ["Judul jelas, poin singkat, dan visual yang mendukung pesan."],
    notes: "", source: "", layout: "title", locked: false,
    visual: { motif: MOTIF_BY_STYLE[preset.artDirection.style] ?? "none", background: BACKGROUND_BY_STYLE[preset.artDirection.style] ?? "solid", motion: "none" },
  };
  return renderSlideSvg(layoutSlide(slide, preset.theme, 0, 1, preset.artDirection, preset.palette));
}

/** Visual template choices. Picking one sends a normal chat message, so the AI keeps the full context. */
export function TemplatePicker({ onPick, disabled, only, compact }: { onPick: (label: string) => void; disabled?: boolean; only?: readonly string[]; compact?: boolean }) {
  const presets = useMemo(() => {
    const wanted = only?.map((label) => label.toLowerCase());
    return DESIGN_PRESETS.filter((preset) => !wanted || wanted.includes(preset.label.toLowerCase())).map((preset) => ({ preset, svg: sampleSvg(preset) }));
  }, [only]);
  return <div className={`${styles.templateGrid} ${compact ? styles.templateCompact : ""}`}>
    {presets.map(({ preset, svg }) => <button key={preset.id} type="button" disabled={disabled} onClick={() => onPick(preset.label)} title={preset.description}>
      <span className={styles.mini} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      <strong>{preset.label}</strong>
    </button>)}
  </div>;
}

function SlideThumb({ deck, index, onOpen }: { deck: PresentationDeck; index: number; onOpen: () => void }) {
  const slide = deck.slides[index];
  const svg = renderSlideSvg(layoutSlide(slide, deck.theme, index, deck.slides.length, deck.artDirection, deck.palette));
  return <button type="button" className={styles.thumb} onClick={onOpen} aria-label={`Buka slide ${index + 1} di editor: ${slide.title}`}>
    <span className={styles.mini} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    <span><b>{String(index + 1).padStart(2, "0")}</b> {slide.title}</span>
  </button>;
}

async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await authenticatedFetch(url, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value?.success) throw new Error(value?.error || "Permintaan gambar gagal.");
  return value as T;
}

/** AI-suggested images. Nothing is generated until the user presses a button; results are placed on request. */
function PlannedImages({ root, revision, images, deck, canStart, onApply, onProject, onError }: {
  root: string; revision: number; images: PlanImage[]; deck: PresentationDeck; canStart: boolean;
  onApply: (items: ArtPlacement[]) => void; onProject: () => Promise<void>; onError: (message: string) => void;
}) {
  const [jobs, setJobs] = useState<ArtJob[]>([]);
  const [starting, setStarting] = useState(false);
  const tracked = images.some((image) => image.jobId);
  const active = images.some((image) => { const job = jobs.find((item) => item.id === image.jobId); return image.jobId && (!job || job.status === "queued" || job.status === "running"); });

  useEffect(() => {
    if (!tracked) return;
    let stopped = false;
    const load = () => request<{ jobs: ArtJob[] }>(`${root}/art`).then((result) => { if (!stopped) setJobs(result.jobs); }).catch(() => undefined);
    void load();
    if (!active) return () => { stopped = true; };
    const timer = window.setInterval(load, 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [root, tracked, active]);

  const slideFor = (image: PlanImage) => deck.slides.find((item) => item.id === image.slideId) ?? (image.slideId ? undefined : deck.slides[image.slide - 1]);
  const jobFor = (image: PlanImage) => jobs.find((item) => item.id === image.jobId);
  const ready = images.flatMap((image) => {
    const job = jobFor(image); const slide = slideFor(image);
    return job?.status === "done" && job.fileId && slide && slide.art?.fileId !== job.fileId ? [{ slideId: slide.id, fileId: job.fileId, role: image.role, alt: image.prompt.slice(0, 300) }] : [];
  });
  const waiting = images.map((image, index) => ({ image, index })).filter(({ image }) => !image.jobId);

  async function start(indexes: number[]) {
    if (starting || !canStart) return;
    setStarting(true);
    try {
      for (const index of indexes) await request(`${root}/art`, { baseRevision: revision, planImage: index });
    } catch (e) { onError(getErrorMessage(e)); }
    finally { await onProject().catch(() => undefined); setStarting(false); }
  }

  return <div className={styles.plannedImages}>
    <div className={styles.panelRow}><strong><ImagePlus size={15} /> Usulan gambar AI ({images.length})</strong>
      {waiting.length > 0 && <button type="button" className={styles.primary} disabled={!canStart || starting} onClick={() => void start(waiting.map(({ index }) => index))}>{starting ? <Loader2 size={14} className="animate-spin" /> : null} Buat {waiting.length} gambar</button>}
    </div>
    <ol>{images.map((image, index) => {
      const job = jobFor(image); const slide = slideFor(image);
      const placed = !!job?.fileId && slide?.art?.fileId === job.fileId;
      return <li key={`${index}-${image.slide}`}>
        <div><b>Slide {image.slide}</b>{slide ? `: ${slide.title}` : ""} · {ROLE_LABEL[image.role]}</div>
        <p>{image.prompt}</p>
        <span className={styles.jobState}>
          {!image.jobId ? <button type="button" disabled={!canStart || starting} onClick={() => void start([index])}>Buat gambar ini</button>
            : !job || job.status === "queued" || job.status === "running" ? <><Loader2 size={13} className="animate-spin" /> Sedang dibuat</>
            : job.status === "failed" ? <em>{job.error || "Gambar gagal dibuat."}</em>
            : placed ? <><Check size={13} /> Terpasang</>
            : !job.fileId ? <em>Gambar tidak tersedia.</em>
            : slide ? <button type="button" onClick={() => onApply([{ slideId: slide.id, fileId: job.fileId!, role: image.role, alt: image.prompt.slice(0, 300) }])}>Pasang ke slide</button>
            : <em>Slide tujuan sudah tidak ada. Pasang dari tab Tampilan.</em>}
        </span>
      </li>;
    })}</ol>
    {ready.length > 1 && <button type="button" onClick={() => onApply(ready)}>Pasang semua gambar yang selesai ({ready.length})</button>}
    <small>{canStart ? "Setiap gambar memakai kuota AI dan hanya dibuat setelah Anda menekan tombol." : "Gunakan hasil AI dan simpan perubahan terlebih dahulu, lalu gambar dapat dibuat."}</small>
  </div>;
}

interface PanelProps {
  root: string;
  revision: number;
  deck: PresentationDeck;
  shownDeck: PresentationDeck;
  showingProposal: boolean;
  fresh: boolean;
  plan?: ChatPlan | null;
  materials: ChatMaterial[];
  source?: ChatSource | null;
  working: boolean;
  canPickTemplate: boolean;
  canStartImages: boolean;
  onOpenSlide: (index: number) => void;
  onPickTemplate: (label: string) => void;
  onApplyArt: (items: ArtPlacement[]) => void;
  onProject: () => Promise<void>;
  onError: (message: string) => void;
}

export default function PresentationPlanPanel({ root, revision, deck, shownDeck, showingProposal, fresh, plan, materials, source, working, canPickTemplate, canStartImages, onOpenSlide, onPickTemplate, onApplyArt, onProject, onError }: PanelProps) {
  const [removing, setRemoving] = useState("");
  const template = plan?.templateId ? DESIGN_PRESETS.find((preset) => preset.id === plan.templateId) : undefined;

  async function remove(materialId: string) {
    setRemoving(materialId);
    try {
      const res = await authenticatedFetch(`${root}/materials`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId }) });
      const result = await res.json().catch(() => null) as { success?: boolean; error?: string } | null;
      if (!res.ok || !result?.success) throw new Error(result?.error || "Bahan gagal dihapus.");
      await onProject();
    } catch (e) { onError(getErrorMessage(e)); }
    finally { setRemoving(""); }
  }

  return <div className={styles.planPanel}>
    {fresh && !showingProposal ? <section>
      <h3>Pilih contoh tampilan</h3>
      <p className={styles.help}>Opsional. Pilih tampilan yang Anda suka, AI akan memakainya saat menyusun slide. Jika dilewati, AI memilihkan yang sesuai topik.</p>
      <TemplatePicker onPick={onPickTemplate} disabled={!canPickTemplate} />
    </section> : <section>
      <div className={styles.panelRow}><h3>{showingProposal ? "Hasil AI (belum dipakai)" : "Slide Anda"}</h3><span>{shownDeck.slides.length} slide</span></div>
      <p className={styles.help}>{showingProposal ? "Tinjau setiap slide. Pilih Gunakan hasil ini di atas untuk mulai mengedit." : "Klik slide untuk mengedit teks, gambar, dan posisi objek."}</p>
      <div className={styles.thumbGrid}>{shownDeck.slides.map((item, index) => <SlideThumb key={item.id} deck={shownDeck} index={index} onOpen={() => onOpenSlide(index)} />)}</div>
    </section>}

    {plan && <section>
      <h3>Rencana presentasi</h3>
      <p className={styles.planGoal}>{plan.goal}</p>
      <div className={styles.planMeta}><span>{plan.audience}</span><span>{plan.minutes} menit</span><span>{DENSITY_LABEL[plan.density]}</span>{template && <span>{template.label}</span>}</div>
      <details className={styles.planOutline}>
        <summary>Urutan {plan.slides.length} slide</summary>
        <ol>{plan.slides.map((slide, index) => <li key={`${index}-${slide.title}`}><strong>{slide.title}</strong><span>{slide.point}</span>{slide.material && <small>Bahan: {slide.material}</small>}</li>)}</ol>
      </details>
      {plan.omitted && <p className={styles.help}>Tidak dimasukkan: {plan.omitted}</p>}
      {!!plan.images?.length && <PlannedImages root={root} revision={revision} images={plan.images} deck={deck} canStart={canStartImages} onApply={onApplyArt} onProject={onProject} onError={onError} />}
    </section>}

    {(source || materials.length > 0) && <section>
      <h3>Bahan yang dibaca AI</h3>
      <ul className={styles.materialList}>
        {source && <li><FileText size={16} aria-hidden="true" /><div><strong>Laporan: {source.title}</strong><small>{source.draftChars.toLocaleString("id-ID")} karakter, dibaca sesuai kebutuhan</small></div></li>}
        {materials.map((item) => <li key={item.id}><FileText size={16} aria-hidden="true" /><div><strong>{item.title}</strong><small>{item.fileName}</small></div><button type="button" disabled={working || removing === item.id} onClick={() => void remove(item.id)} aria-label={`Hapus ${item.title}`}><Trash2 size={15} /></button></li>)}
      </ul>
    </section>}
  </div>;
}
