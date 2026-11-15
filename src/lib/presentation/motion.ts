import type { AnimationPreset } from "./model";
import type { SlideScene, SlideElement, BuildTag } from "./layout";

export type { BuildTag };

/**
 * Animasi presentasi (Fase 2, 2026-11-15).
 *
 * Satu rencana animasi dipakai dua tempat agar web dan PPTX identik:
 * - Pratinjau web (mode Tayangkan): `renderSlideSvg(scene, plan)` di layout.ts.
 * - Ekspor PPTX: `timingXml(steps)` di export-pptx.ts.
 *
 * Aturan pemilik (K23 dikoreksi 2026-11-15): animasi hanya ada bila diminta.
 * Preset "none" => tanpa animasi (steps kosong, tanpa transisi).
 *
 * Elemen yang bergerak ditentukan oleh penanda `build` (lihat EditableElement di
 * layout.ts); bila tidak ada, diturunkan dari `editKey`. Latar selebar slide dan
 * elemen tanpa penanda tetap DIAM (terlihat sejak awal) supaya latar/bingkai tidak
 * ikut muncul-hilang.
 */

/** Efek masuk satu kelompok. `word` = judul muncul per kata (hanya teks judul; elemen lain di grup memakai fade). */
export type BuildEffect = "fade" | "rise" | "zoom" | "pop" | "wipe" | "word";

export interface MotionStep {
  group: BuildTag;
  effect: BuildEffect;
  /** Jeda mulai relatif terhadap awal slide (ms). */
  delayMs: number;
  durationMs: number;
  /** Indeks elemen di `scene.elements`. */
  elements: number[];
}

export interface MotionPlan {
  transition: "none" | "fade" | "push";
  steps: MotionStep[];
}

const BODY_TAGS = ["body-0", "body-1", "body-2", "body-3"] as const;

/** Kelompok efektif satu elemen, atau null bila harus diam. */
export function elementBuildGroup(element: SlideElement): BuildTag | null {
  if (element.build) return element.build;
  const key = element.editKey;
  if (key === "title" || key === "eyebrow") return "title";
  if (key === "art") return "art";
  if (key === "body-0" || key === "body-1" || key === "body-2" || key === "body-3") return key;
  return null;
}

/** Efek per kelompok untuk tiap preset. Tanpa entri = kelompok itu diam. */
const PRESET_EFFECTS: Record<Exclude<AnimationPreset, "none">, Record<"title" | "art" | "body" | "deco", BuildEffect>> = {
  halus: { title: "fade", art: "fade", body: "fade", deco: "fade" },
  dinamis: { title: "rise", art: "wipe", body: "rise", deco: "zoom" },
  ceria: { title: "pop", art: "zoom", body: "rise", deco: "pop" },
  ketik: { title: "word", art: "fade", body: "wipe", deco: "fade" },
};

const PRESET_TRANSITION: Record<Exclude<AnimationPreset, "none">, MotionPlan["transition"]> = {
  halus: "fade", dinamis: "push", ceria: "fade", ketik: "fade",
};

const GROUP_GAP_MS = 300; // jeda start-ke-start antarkelompok
const BODY_GAP_MS = 250; // jeda antarpoin
/** Ketik: jeda antarkata dan lama memudar tiap kata (sama di web dan PPTX). */
export const WORD_GAP_MS = 120;
export const WORD_FADE_MS = 300;
const DUR: Record<BuildEffect, number> = { fade: 550, rise: 550, zoom: 500, wipe: 550, pop: 600, word: WORD_FADE_MS };

/** Efek nyata satu elemen: efek per kata hanya untuk teks judul, elemen lain di grup itu memudar. */
export function elementEffect(element: SlideElement | undefined, effect: BuildEffect): BuildEffect {
  return effect === "word" && !(element?.type === "text" && element.editKey === "title") ? "fade" : effect;
}

function titleWordCount(scene: SlideScene, indices: number[]): number {
  for (const i of indices) {
    const el = scene.elements[i];
    if (el.type === "text" && el.editKey === "title") {
      return Math.max(1, el.lines.join(" ").trim().split(/\s+/u).filter(Boolean).length);
    }
  }
  return 1;
}

/**
 * Susun rencana animasi untuk satu slide.
 * Urutan muncul: judul (termasuk eyebrow) -> gambar -> poin satu per satu -> dekorasi.
 */
export function buildPlan(scene: SlideScene, preset: AnimationPreset): MotionPlan {
  if (preset === "none") return { transition: "none", steps: [] };
  const effects = PRESET_EFFECTS[preset];

  // Kumpulkan indeks per kelompok, menjaga urutan gambar.
  const groups = new Map<BuildTag, number[]>();
  scene.elements.forEach((element, index) => {
    const group = elementBuildGroup(element);
    if (!group) return;
    // Latar selebar slide (gambar background atau full-bleed) tetap diam agar tidak muncul-hilang.
    if (element.type === "image"
      && (element.role === "background" || (element.w >= scene.width * 0.9 && element.h >= scene.height * 0.9))) return;
    const list = groups.get(group) ?? [];
    list.push(index);
    groups.set(group, list);
  });

  const steps: MotionStep[] = [];
  let cursor = 0;

  const title = groups.get("title");
  if (title?.length) {
    const words = titleWordCount(scene, title);
    const effect = effects.title;
    const typed = (words - 1) * WORD_GAP_MS + WORD_FADE_MS;
    steps.push({ group: "title", effect, delayMs: 0, durationMs: DUR[effect], elements: title });
    // Ketik: kelompok berikutnya menunggu judul selesai diketik.
    cursor = effect === "word" ? typed + 150 : GROUP_GAP_MS;
  }

  const art = groups.get("art");
  if (art?.length) {
    const effect = effects.art;
    steps.push({ group: "art", effect, delayMs: cursor, durationMs: DUR[effect], elements: art });
    cursor += GROUP_GAP_MS;
  }

  for (const tag of BODY_TAGS) {
    const body = groups.get(tag);
    if (!body?.length) continue;
    const effect = effects.body;
    steps.push({ group: tag, effect, delayMs: cursor, durationMs: DUR[effect], elements: body });
    cursor += BODY_GAP_MS;
  }

  const deco = groups.get("deco");
  if (deco?.length) {
    const effect = effects.deco;
    steps.push({ group: "deco", effect, delayMs: cursor, durationMs: DUR[effect], elements: deco });
  }

  return { transition: PRESET_TRANSITION[preset], steps };
}

/** Peta indeks elemen -> efek/jeda, untuk renderer SVG. */
export function elementMotion(plan: MotionPlan, scene: SlideScene): Map<number, { effect: BuildEffect; delayMs: number; durationMs: number }> {
  const map = new Map<number, { effect: BuildEffect; delayMs: number; durationMs: number }>();
  for (const step of plan.steps) {
    for (const index of step.elements) {
      const effect = elementEffect(scene.elements[index], step.effect);
      map.set(index, { effect, delayMs: step.delayMs, durationMs: effect === step.effect ? step.durationMs : DUR[effect] });
    }
  }
  return map;
}
