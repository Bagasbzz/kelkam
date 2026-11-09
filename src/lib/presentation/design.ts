import { FONT_PAIRS, inspectSlide, type DeckDesign, type FrameStyle, type PresentationDeck, type PresentationFont, type PresentationSlide, type SlideArt, type SlideEditTarget } from "./model";
import { fitText, layoutSlide, SLIDE_HEIGHT, SLIDE_WIDTH, type Bounds, type ShapeElement, type SlideElement, type SlideScene, type TextElement } from "./layout";
import { drawBackdrop, drawMotif, glyphPoints, styleGenes, type MotifColors } from "./motifs";

/** Em dash/en dash are a hallmark of AI text; slides never show them. */
export function noDash(value: string) {
  return value
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/^\s*[–—]+\s*/g, "")
    .replace(/\s*[–—]+\s*/g, ", ");
}

/**
 * Designed decks: a per-deck identity (colors, fonts, frame family, seed) drives ~12 compositions.
 * Everything is native geometry or an owned image, so previews and the editable PPTX stay identical.
 */
export function sceneFor(deck: PresentationDeck, index: number, slide: PresentationSlide = deck.slides[index]): SlideScene {
  return deck.design
    ? layoutDesignedSlide(slide, deck.design, index, deck.slides.length)
    : layoutSlide(slide, deck.theme, index, deck.slides.length, deck.artDirection, deck.palette);
}

// ---------------------------------------------------------------------------
// Color: model output is never trusted for legibility.
// ---------------------------------------------------------------------------

const rgb = (hex: string) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const channel = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
export function luminance(hex: string) {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
export function mix(a: string, b: string, amount: number) {
  const [x, y] = [rgb(a), rgb(b)];
  return x.map((value, i) => Math.round((value + (y[i] - value) * amount) * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
const readableOn = (fill: string, preferred: string) => contrast(preferred, fill) >= 4.5 ? preferred : contrast("FFFFFF", fill) >= contrast("151515", fill) ? "FFFFFF" : "151515";

export interface DesignTokens {
  primary: string; accent: string; background: string; surface: string; text: string; muted: string;
  onPrimary: string; onAccent: string; onSurface: string; accentText: string; dark: boolean;
  heading: PresentationFont; body: PresentationFont; frame: FrameStyle;
}

export function designTokens(design: DeckDesign): DesignTokens {
  const background = design.background.toUpperCase();
  const dark = luminance(background) < 0.3;
  const text = readableOn(background, design.text.toUpperCase());
  let surface = design.surface.toUpperCase();
  if (contrast(text, surface) < 4.5) surface = mix(background, dark ? "FFFFFF" : design.primary, dark ? 0.1 : 0.07);
  const primary = design.primary.toUpperCase();
  const accent = design.accent.toUpperCase();
  const muted = contrast(mix(text, background, 0.35), background) >= 4.5 ? mix(text, background, 0.35) : text;
  // Accent-colored words must still read on the page; otherwise fall back to primary, then text.
  const accentText = contrast(accent, background) >= 3 ? accent : contrast(primary, background) >= 3 ? primary : text;
  const pair = FONT_PAIRS[design.fonts];
  return {
    primary, accent, background, surface, text, muted, dark, accentText,
    onPrimary: readableOn(primary, "FFFFFF"), onAccent: readableOn(accent, "151515"), onSurface: readableOn(surface, text),
    heading: pair.heading, body: pair.body, frame: design.frame,
  };
}

// ---------------------------------------------------------------------------
// Deterministic variation: same deck renders the same; another seed varies.
// ---------------------------------------------------------------------------

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Shapes (normalized 0..1 polygons authored here, never by the model)
// ---------------------------------------------------------------------------

type Points = readonly (readonly [number, number])[];
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const HEXAGON: Points = [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]];
const DIAMOND: Points = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
const SLANT: Points = [[0.22, 0], [1, 0], [1, 1], [0, 1]];
const CHEVRON: Points = [[0, 0], [0.84, 0], [1, 0.5], [0.84, 1], [0, 1], [0.16, 0.5]];

function arch(): Points {
  const points: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const angle = Math.PI + (Math.PI * i) / 16;
    points.push([round3(0.5 + 0.5 * Math.cos(angle)), round3(0.5 + 0.5 * Math.sin(angle))]);
  }
  return [...points, [1, 1], [0, 1]];
}
function blob(rand: () => number): Points {
  const a = rand() * Math.PI * 2, b = rand() * Math.PI * 2;
  const points: [number, number][] = [];
  for (let i = 0; i < 36; i++) {
    const t = (Math.PI * 2 * i) / 36;
    const r = 0.5 * (0.86 + 0.09 * Math.sin(3 * t + a) + 0.05 * Math.sin(5 * t + b));
    points.push([round3(0.5 + r * Math.cos(t)), round3(0.5 + r * Math.sin(t))]);
  }
  return points;
}
function rounded(w: number, h: number, radius = 0.32): Points {
  const rx = Math.min(radius / w, 0.5), ry = Math.min(radius / h, 0.5);
  const points: [number, number][] = [];
  const corner = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 5; i++) {
      const angle = from + (Math.PI / 2) * (i / 5);
      points.push([round3(cx + rx * Math.cos(angle)), round3(cy + ry * Math.sin(angle))]);
    }
  };
  corner(1 - rx, ry, -Math.PI / 2); corner(1 - rx, 1 - ry, 0); corner(rx, 1 - ry, Math.PI / 2); corner(rx, ry, Math.PI);
  return points;
}

type PhotoFrame = "hexagon" | "slant" | "blob" | "circle" | "arch" | "rounded" | "rect" | "diamond";
const FRAME_PHOTOS: Record<FrameStyle, readonly [PhotoFrame, PhotoFrame]> = {
  diagonal: ["hexagon", "slant"], blob: ["blob", "circle"], wave: ["arch", "circle"], geometric: ["hexagon", "diamond"],
  grid: ["rounded", "rect"], halftone: ["blob", "rounded"], minimal: ["rect", "arch"], gradient: ["circle", "rounded"],
};

// ---------------------------------------------------------------------------
// Body convention: "Label: isi" gives card headers, numbers for stats, and info rows.
// ---------------------------------------------------------------------------

export function splitLabel(value: string): { label: string; text: string } {
  const match = /^([^:.!?]{1,42}):\s+([\s\S]+)$/u.exec(value.trim());
  return match ? { label: noDash(match[1].trim()), text: noDash(match[2].trim()) } : { label: "", text: noDash(value.trim()) };
}

const pad = (value: number) => String(value).padStart(2, "0");

export function layoutDesignedSlide(slide: PresentationSlide, design: DeckDesign, index = 0, total = 1): SlideScene {
  const genes = styleGenes(design.seed, design.frame, random);
  // The page itself leans toward the deck color, so no two decks share the same plain background.
  const t = designTokens({ ...design, background: mix(design.background.toUpperCase(), design.primary.toUpperCase(), genes.tint) });
  const deckRand = random(design.seed);
  const mirror = deckRand() < 0.5;
  const photoFrame = FRAME_PHOTOS[t.frame][deckRand() < 0.6 ? 0 : 1];
  const rand = random(design.seed ^ hashString(slide.id));
  const elements: SlideElement[] = [];
  const issues = inspectSlide(slide);
  const textSizes = new Map<TextElement, number>();
  const layout = ({ title: "cover", split: "bullets", timeline: "process", statement: "quote" } as Record<string, PresentationSlide["layout"]>)[slide.layout] ?? slide.layout;
  const isCover = layout === "cover" || layout === "closing";
  const art = slide.art;

  // --- primitives -----------------------------------------------------------
  const shape = (kind: ShapeElement["shape"], x: number, y: number, w: number, h: number, fill: string, options: Partial<Pick<ShapeElement, "lineColor" | "lineWidth" | "opacity" | "points">> = {}) => {
    elements.push({ type: "shape", shape: kind, x, y, w, h, fill, ...options });
  };
  const poly = (x: number, y: number, w: number, h: number, fill: string, points: Points, opacity = 1) => shape("polygon", x, y, w, h, fill, { points, opacity });
  const line = (x: number, y: number, w: number, h: number, color: string, width = 1, opacity = 1) => elements.push({ type: "line", x, y, w, h, color, lineWidth: width, opacity });
  const text = (raw: string, b: Bounds, size: number, options: Partial<Pick<TextElement, "fontFace" | "color" | "bold" | "align" | "lineHeight" | "editKey">> = {}) => {
    if (!raw) return;
    const value = noDash(raw);
    const fontFace = options.fontFace ?? t.body;
    const lineHeight = options.lineHeight ?? 1.25;
    const element: TextElement = { type: "text", text: value, ...fitText(value, b, size, fontFace, lineHeight), ...b, lineHeight, fontFace, color: t.text, bold: false, align: "left", ...options };
    elements.push(element);
    textSizes.set(element, size);
    return element;
  };
  const headingBold = t.heading !== "Georgia" && t.heading !== "Impact";
  const title = (b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align">> = {}) =>
    text(slide.title, b, size, { editKey: "title", fontFace: t.heading, bold: headingBold, lineHeight: t.heading === "Georgia" ? 1.18 : 1.06, ...options });
  const eyebrow = (b: Bounds, onFill?: string, align: TextElement["align"] = "left") => {
    if (!slide.eyebrow) return;
    const label = slide.eyebrow.toUpperCase();
    if (genes.eyebrow === "tag") {
      const width = Math.min(b.w, 0.45 + label.length * 0.1);
      const px = align === "right" ? b.x + b.w - width : b.x;
      shape("rect", px, b.y + 0.02, width, 0.36, onFill ? t.background : t.accent);
      text(label, { x: px + 0.14, y: b.y + 0.07, w: width - 0.2, h: 0.3 }, 11, { editKey: "eyebrow", bold: true, color: onFill ? t.text : t.onAccent });
    } else if (genes.eyebrow === "rule") {
      const ruleX = align === "right" ? b.x + b.w - 0.5 : b.x;
      line(ruleX, b.y + 0.2, 0.5, 0, onFill ?? t.accentText, 2.4);
      text(label, { x: align === "right" ? b.x : b.x + 0.65, y: b.y, w: b.w - 0.65, h: 0.4 }, 12, { editKey: "eyebrow", bold: true, color: onFill ?? t.accentText, align });
    } else text(label, { ...b, h: 0.4 }, 12, { editKey: "eyebrow", bold: true, color: onFill ?? t.accentText, align });
  };
  const body = (i: number, b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align" | "bold">> = {}) =>
    text(slide.body[i], b, size, { editKey: `body-${i}` as SlideEditTarget, ...options });

  /** Photo in the deck's frame with an offset color block, or a tasteful placeholder until an image exists. */
  const photo = (b: Bounds, options: { frame?: PhotoFrame; block?: boolean; editable?: boolean; image?: SlideArt } = {}) => {
    const kind = options.frame ?? photoFrame;
    const image = options.image ?? art;
    const points: Points | "ellipse" = kind === "circle" ? "ellipse" : kind === "hexagon" ? HEXAGON : kind === "slant" ? SLANT : kind === "blob" ? blob(rand)
      : kind === "arch" ? arch() : kind === "diamond" ? DIAMOND : kind === "rounded" ? rounded(b.w, b.h) : [[0, 0], [1, 0], [1, 1], [0, 1]];
    const draw = (x: number, y: number, fill: string, opacity = 1) => points === "ellipse" ? shape("ellipse", x, y, b.w, b.h, fill, { opacity }) : poly(x, y, b.w, b.h, fill, points, opacity);
    if (options.block !== false) draw(b.x + (mirror ? -0.22 : 0.22), b.y + 0.22, t.accent);
    if (image && image.role !== "background") {
      if (image.role === "cutout") {
        draw(b.x, b.y, t.surface);
        elements.push({ type: "image", ...image, editKey: options.editable === false ? undefined : "art", ...b, crop: "contain" });
      } else elements.push({ type: "image", ...image, editKey: options.editable === false ? undefined : "art", ...b, crop: "cover", mask: points });
    } else {
      // No image yet: the deck's logo, or generative art of the deck's own motif, never an empty placeholder icon.
      draw(b.x, b.y, mix(t.primary, t.background, t.dark ? 0.6 : 0.82));
      const inset = Math.min(b.w, b.h) * 0.14;
      const inner = { x: b.x + inset, y: b.y + inset, w: b.w - inset * 2, h: b.h - inset * 2 };
      if (design.logo && isCover) {
        elements.push(...drawMotif(genes.motif, inner, random(design.seed ^ 991), motifColors, 1.4).map((element) => ({ ...element, opacity: Math.min(element.opacity ?? 1, 0.35) })));
        const s = Math.min(inner.w, inner.h) * 0.62;
        elements.push({ type: "image", fileId: design.logo, role: "cutout", alt: "Logo", x: inner.x + (inner.w - s) / 2, y: inner.y + (inner.h - s) / 2, w: s, h: s, crop: "contain" });
      } else {
        elements.push(...drawMotif(genes.motif, inner, random(design.seed ^ hashString(slide.id) ^ 7), motifColors, 1.6));
      }
    }
  };

  const motifColors: MotifColors = { primary: t.primary, accent: t.accent, text: t.text, surface: t.surface, background: t.background };

  // --- chrome: consistent per deck, varied per seed ---------------------------
  const W = SLIDE_WIDTH, H = SLIDE_HEIGHT;
  const fx = (x: number, w: number) => mirror ? W - x - w : x;
  if (art?.role === "background") {
    elements.push({ type: "image", ...art, editKey: "art", x: 0, y: 0, w: W, h: H, crop: "cover", opacity: 1 });
    shape("rect", 0, 0, W, H, t.background, { opacity: 0.86 });
  }
  /**
   * Generative chrome: the deck's motif family drawn fresh per slide (same family, new arrangement),
   * placed in the corners away from the header (logo/institution) and the page number.
   */
  const backTone = mix(t.background, t.dark ? "FFFFFF" : t.primary, t.dark ? 0.06 : 0.07);
  const chrome = () => {
    elements.push(...drawBackdrop(genes.backdrop, W, H, random(design.seed ^ 0x2f), motifColors, backTone, mirror));
    if (isCover) return;
    const fam = genes.motif;
    const topRight = !mirror; // header sits on the opposite side
    if (fam === "mosaic") {
      elements.push(...drawMotif(fam, { x: topRight ? W - 0.62 : 0.14, y: 0.9, w: 0.5, h: H - 1.8 }, rand, motifColors, 0.85));
    } else if (fam === "confetti" || fam === "grain" || fam === "stripes" || fam === "terrain") {
      elements.push(...drawMotif(fam, { x: topRight ? W - 2.75 : 0.12, y: 0.06, w: 2.6, h: 0.9 }, rand, motifColors, 0.9));
      if (genes.corner === 0) elements.push(...drawMotif(fam, { x: topRight ? 0.12 : W - 2.95, y: 6.72, w: 2.8, h: 0.7 }, rand, motifColors, 0.8));
    } else {
      // Large forms anchored off-canvas: only a corner shows, kept above the eyebrow line (y < 0.95).
      elements.push(...drawMotif(fam, { x: topRight ? W - 1.9 : -1.6, y: -2.0, w: 3.5, h: 2.95 }, rand, motifColors, 1));
      if (genes.corner === 0) elements.push(...drawMotif(fam, { x: topRight ? -1.25 : W - 1.25, y: 6.25, w: 2.5, h: 2.5 }, rand, motifColors, 0.8));
    }
  };
  if (layout !== "section") chrome();

  // --- header & footer ------------------------------------------------------------
  const institution = design.institution ?? "";
  const logo = design.logo;
  const header = (onFill?: string) => {
    const y = t.frame === "wave" ? 0.13 : 0.3;
    let x = fx(0.75, 4.5);
    if (logo) {
      elements.push({ type: "image", fileId: logo, role: "cutout", alt: "Logo", x: mirror ? W - 0.75 - 0.36 : 0.75, y: y - 0.02, w: 0.36, h: 0.36, crop: "contain" });
      if (!mirror) x = 1.2;
    }
    if (institution) text(institution, { x, y: y + 0.03, w: mirror ? 4.05 : 4.5, h: 0.3 }, 10, { bold: true, color: onFill ?? (t.frame === "wave" ? t.onPrimary : t.muted), align: mirror ? "right" : "left" });
  };
  const footer = (color = t.muted) => text(`${pad(index + 1)} / ${pad(total)}`, { x: mirror ? 0.75 : W - 2.1, y: 7.0, w: 1.35, h: 0.26 }, 10, { color, align: mirror ? "left" : "right" });

  // --- compositions ----------------------------------------------------------------
  const contentX = 0.85, contentW = W - 1.7;
  const rows = (count: number, top: number, bottom: number) => (bottom - top) / Math.max(count, 1);
  switch (layout) {
    case "cover":
    case "closing": {
      const closing = layout === "closing";
      if (t.frame === "diagonal") {
        poly(fx(7.4, 5.933), 0, 5.933, H, t.primary, mirror ? [[0, 0], [0.62, 0], [0.86, 1], [0, 1]] : [[0.38, 0], [1, 0], [1, 1], [0.14, 1]]);
        poly(fx(7.05, 1.45), 0, 1.45, H, t.accent, mirror ? [[0.6, 0], [0.75, 0], [0.33, 1], [0.18, 1]] : [[0.25, 0], [0.4, 0], [0.82, 1], [0.67, 1]]);
      }
      const photoBox = photoFrame === "circle" ? { x: fx(8.15, 4.4), y: 1.4, w: 4.4, h: 4.4 } : { x: fx(7.85, 4.85), y: 1.2, w: 4.85, h: 4.6 };
      // A large, softened layer of the deck motif behind the picture: unique per seed.
      elements.push(...drawMotif(genes.motif, { x: fx(6.6, 6.73), y: 0, w: 6.73, h: H }, random(design.seed ^ 0x51), motifColors, 1.5)
        .map((element) => element.type === "shape" && (element.opacity ?? 1) > 0 ? { ...element, opacity: Math.min(element.opacity ?? 1, 0.5) } : element));
      if (!closing || art) photo(photoBox);
      else elements.push(...drawMotif(genes.motif, { x: photoBox.x + 0.3, y: photoBox.y + 0.3, w: photoBox.w - 0.6, h: photoBox.h - 0.6 }, random(design.seed ^ 0x77), motifColors, 1.7));
      // Without a picture the cover frame already shows the logo large; avoid a duplicate in the corner.
      if (logo && (art || closing)) elements.push({ type: "image", fileId: logo, role: "cutout", alt: "Logo", x: fx(0.85, 0.62), y: 0.55, w: 0.62, h: 0.62, crop: "contain" });
      if (institution) text(institution, { x: fx(logo && (art || closing) ? 1.6 : 0.85, 5.5), y: 0.72, w: 5.5, h: 0.32 }, 12, { bold: true, color: t.muted, align: mirror ? "right" : "left" });
      const textX = fx(0.85, 6.6), textW = 6.6;
      const align = mirror ? "right" : "left";
      eyebrow({ x: textX, y: 1.55, w: textW, h: 0.42 }, undefined, align);
      title({ x: textX, y: 2.15, w: textW, h: closing ? 2.2 : 2.55 }, closing ? 60 : 54, { align });
      const [lead, ...info] = slide.body;
      if (lead) body(0, { x: textX, y: closing ? 4.5 : 4.85, w: textW, h: 0.75 }, 18, { color: t.muted, align });
      const cells = info.slice(0, 3);
      if (cells.length) {
        const cellW = Math.min(2.25, textW / cells.length);
        cells.forEach((value, i) => {
          const { label, text: content } = splitLabel(value);
          const x = mirror ? textX + textW - cellW * (i + 1) : textX + i * cellW;
          line(x, 5.85, 0, 0.72, t.accent, 2.2);
          if (label) text(label, { x: x + 0.14, y: 5.83, w: cellW - 0.2, h: 0.28 }, 10, { color: t.muted });
          body(i + 1, { x: x + 0.14, y: label ? 6.1 : 5.9, w: cellW - 0.2, h: label ? 0.5 : 0.65 }, 13, { bold: true });
          // The label is drawn separately; editing still changes the whole "Label: isi" line.
          const last = elements.at(-1);
          if (label && last?.type === "text" && last.editKey === `body-${i + 1}`) Object.assign(last, fitText(content, last, 13, last.fontFace, last.lineHeight), { text: content });
        });
      }
      break;
    }
    case "section": {
      shape("rect", 0, 0, W, H, t.primary);
      if (t.frame === "gradient" || t.frame === "grid") for (let i = 0; i < 5; i++) shape("rect", fx(8.4 + i * 0.4, 5 - i * 0.4), 0.6 + i * 0.3, 5 - i * 0.4, 6.3 - i * 0.6, t.background, { opacity: 0.06 + i * 0.03 });
      const photoSide = !!art;
      if (photoSide) {
        elements.push({ type: "image", ...art!, editKey: "art", x: fx(7.6, 5.733), y: 0, w: 5.733, h: H, crop: art!.role === "cutout" ? "contain" : "cover", mask: art!.role === "cutout" ? undefined : mirror ? [[0, 0], [1, 0], [0.8, 1], [0, 1]] : SLANT });
      } else {
        const onPrimary: MotifColors = { primary: mix(t.primary, t.onPrimary, 0.35), accent: t.accent, text: t.onPrimary, surface: mix(t.primary, t.onPrimary, 0.15), background: t.primary };
        elements.push(...drawMotif(genes.motif, { x: fx(7.9, 5.2), y: 0.6, w: 5.2, h: 6.3 }, rand, onPrimary, 1.8));
      }
      const x = fx(0.95, 6.3);
      text(slide.eyebrow || pad(index + 1), { x, y: 1.55, w: 6.3, h: 1.3 }, 72, { editKey: "eyebrow", fontFace: t.heading, bold: headingBold, color: readableOn(t.primary, t.accent), align: mirror ? "right" : "left" });
      title({ x, y: 2.95, w: 6.3, h: 2.2 }, 46, { color: t.onPrimary, align: mirror ? "right" : "left" });
      if (slide.body[0]) body(0, { x, y: 5.25, w: 6.3, h: 1.1 }, 17, { color: t.onPrimary, align: mirror ? "right" : "left" });
      header(t.onPrimary);
      footer(t.onPrimary);
      break;
    }
    case "agenda": {
      header();
      eyebrow({ x: fx(contentX, 4.0), y: 1.25, w: 4.0, h: 0.42 });
      title({ x: fx(contentX, 4.1), y: 1.85, w: 4.1, h: 2.6 }, 42, { align: mirror ? "right" : "left" });
      const listX = mirror ? contentX : 5.55;
      const count = Math.max(slide.body.length, 1);
      const step = rows(count, 1.35, 6.35);
      slide.body.forEach((value, i) => {
        const y = 1.35 + i * step;
        const { label } = splitLabel(value);
        if (genes.agenda === "outline") {
          // Outlined numerals in the heading face, no filled badges.
          text(String(i + 1), { x: listX, y: y + 0.02, w: 0.9, h: Math.min(step, 0.95) }, 34, { fontFace: t.heading, bold: headingBold, color: i % 2 ? t.accentText : t.primary });
          body(i, { x: listX + 1.0, y: y + 0.1, w: 6.0, h: step - 0.16 }, label ? 18 : 20, { bold: !label && value.length < 50 });
        } else if (genes.agenda === "stack") {
          // Staggered large items with a colored tick, no numbering.
          const indent = (i % 2) * 0.45;
          shape("rect", listX + indent, y + 0.16, 0.16, Math.min(step - 0.3, 0.5), i % 2 ? t.accent : t.primary);
          body(i, { x: listX + indent + 0.38, y: y + 0.06, w: 6.5 - indent, h: step - 0.12 }, label ? 19 : 22, { bold: !label && value.length < 60 });
        } else {
          body(i, { x: listX, y: y + 0.08, w: 6.2, h: step - 0.16 }, label ? 18 : 20, { bold: !label && value.length < 50 });
          text(String(i + 1), { x: listX + 6.3, y: y + 0.1, w: 0.7, h: 0.45 }, 13, { bold: true, color: t.muted, align: "right" });
          line(listX, y + step - 0.04, 7.0, 0, i % 2 ? t.accent : t.primary, i === count - 1 ? 0 : 1.2, i === count - 1 ? 0 : 0.7);
        }
      });
      footer();
      break;
    }
    case "bullets": {
      header();
      const withPhoto = !!art;
      const textW = withPhoto ? 7.05 : contentW;
      const textX = withPhoto ? fx(contentX, textW) : contentX;
      eyebrow({ x: textX, y: 1.05, w: textW, h: 0.42 });
      title({ x: textX, y: 1.55, w: textW, h: 1.3 }, 36);
      const count = Math.max(slide.body.length, 1);
      const twoCol = !withPhoto && count === 4;
      const step = rows(twoCol ? 2 : count, 3.05, 6.55);
      const marker = glyphPoints(genes.glyph);
      const indent = genes.marker === "lead" ? 0 : genes.marker === "bar" ? 0.32 : 0.55;
      slide.body.forEach((_, i) => {
        const col = twoCol ? i % 2 : 0, row = twoCol ? Math.floor(i / 2) : i;
        const colW = twoCol ? (textW - 0.4) / 2 : textW;
        const x = textX + col * (colW + 0.4), y = 3.05 + row * step;
        const color = i % 2 ? t.accent : t.primary;
        if (genes.marker === "glyph") {
          if (marker === "ellipse") shape("ellipse", x + 0.04, y + 0.12, 0.22, 0.22, color);
          else poly(x + 0.04, y + 0.12, 0.24, 0.24, color, marker);
        } else if (genes.marker === "ring") shape("ellipse", x + 0.02, y + 0.1, 0.28, 0.28, color, { opacity: 0, lineColor: color, lineWidth: 2.4 });
        else if (genes.marker === "bar") shape("rect", x, y + 0.06, 0.08, Math.max(0.3, Math.min(step - 0.3, 0.9)), color);
        else line(x, y - 0.08, 0.7, 0, color, 2.4);
        body(i, { x: x + indent, y, w: colW - indent, h: step - 0.12 }, 18);
      });
      if (withPhoto) photo({ x: fx(8.55, 4.0), y: 1.65, w: 4.0, h: 4.4 });
      footer();
      break;
    }
    case "cards": {
      header();
      eyebrow({ x: contentX, y: 1.05, w: contentW, h: 0.42 });
      title({ x: contentX, y: 1.55, w: art ? 8.6 : contentW, h: 1.25 }, 36);
      if (art) photo({ x: fx(10.15, 2.35), y: 0.95, w: 2.35, h: 2.0 }, { block: false });
      const count = Math.max(slide.body.length, 1);
      const gap = 0.32;
      const cardW = (contentW - gap * (count - 1)) / count;
      slide.body.forEach((value, i) => {
        const { label, text: content } = splitLabel(value);
        const x = contentX + i * (cardW + gap);
        let y = 3.15, h = 2.85;
        let onCard = t.onSurface;
        let inset = 0.28;
        if (genes.cards === "tiles") {
          // Solid color tiles, sharp corners, no shadow and no numbering.
          const fills = [t.primary, t.accent, t.surface];
          const fill = fills[(i + (design.seed % 3)) % 3];
          shape("rect", x, y, cardW, h, fill);
          onCard = fill === t.primary ? t.onPrimary : fill === t.accent ? t.onAccent : t.onSurface;
          const g = glyphPoints(genes.glyph);
          if (g === "ellipse") shape("ellipse", x + cardW - 0.45, y + h - 0.45, 0.2, 0.2, onCard, { opacity: 0.55 });
          else poly(x + cardW - 0.47, y + h - 0.47, 0.22, 0.22, onCard, g, 0.55);
        } else if (genes.cards === "columns") {
          // Open columns: a full-height rule and generous whitespace instead of boxes.
          shape("rect", x, y, 0.06, h, i % 2 ? t.accent : t.primary);
          inset = 0.3;
          onCard = t.text;
        } else {
          // Staggered panels with one cut corner.
          y += i % 2 ? 0.35 : 0;
          h -= 0.35;
          const cut = 0.45 / cardW;
          poly(x, y, cardW, h, t.surface, [[0, 0], [1 - cut, 0], [1, 0.45 / h], [1, 1], [0, 1]]);
          poly(x + cardW - 0.45, y, 0.45, 0.45, i % 2 ? t.accent : t.primary, [[0, 0], [1, 0], [1, 1]]);
        }
        if (label) text(label, { x: x + inset, y: y + 0.3, w: cardW - inset - 0.25, h: 0.7 }, 17, { bold: true, color: onCard, fontFace: t.heading });
        const element = body(i, { x: x + inset, y: y + (label ? 1.05 : 0.35), w: cardW - inset - 0.25, h: label ? h - 1.25 : h - 0.6 }, 15, { color: onCard });
        if (label && element) Object.assign(element, fitText(content, element, 15, element.fontFace, element.lineHeight), { text: content });
      });
      footer();
      break;
    }
    case "photo": {
      header();
      const box = photoFrame === "circle" ? { x: fx(1.0, 4.9), y: 1.35, w: 4.9, h: 4.9 } : { x: fx(0.95, 5.3), y: 1.2, w: 5.3, h: 5.2 };
      photo(box);
      const x = fx(6.95, 5.55);
      eyebrow({ x, y: 1.45, w: 5.55, h: 0.42 }, undefined, mirror ? "right" : "left");
      title({ x, y: 2.0, w: 5.55, h: 1.75 }, 36, { align: mirror ? "right" : "left" });
      line(mirror ? x + 5.55 - 1.2 : x, 3.88, 1.2, 0, t.accent, 4);
      const count = Math.max(slide.body.length, 1);
      const step = rows(count, 4.1, 6.65);
      slide.body.forEach((_, i) => body(i, { x, y: 4.1 + i * step, w: 5.55, h: step - 0.08 }, 16, { color: i ? t.muted : t.text, align: mirror ? "right" : "left" }));
      footer();
      break;
    }
    case "quote": {
      header();
      const withPhoto = !!art;
      const quoteW = withPhoto ? 7.6 : 10.4;
      const qx = fx(1.55, quoteW);
      text("“", { x: qx - 0.8, y: 0.75, w: 1.6, h: 2.0 }, 150, { fontFace: "Georgia", color: t.accentText, bold: true });
      const quote = title({ x: qx, y: 1.95, w: quoteW, h: 2.9 }, 36);
      // Attribution sits under the measured quote, not at a fixed height.
      const after = quote ? Math.min(5.1, quote.y + quote.lines.length * quote.fontSize / 72 * quote.lineHeight * 1.17 + 0.35) : 5.1;
      line(mirror ? qx + quoteW - 1.0 : qx, after, 1.0, 0, t.accent, 3);
      if (slide.body[0]) body(0, { x: qx, y: after + 0.2, w: quoteW, h: 0.6 }, 16, { bold: true, color: t.muted });
      slide.body.slice(1).forEach((_, i) => body(i + 1, { x: qx, y: after + 0.85 + i * 0.36, w: quoteW, h: 0.34 }, 13, { color: t.muted }));
      if (withPhoto) photo({ x: fx(9.75, 2.85), y: 1.9, w: 2.85, h: 2.85 }, { frame: "circle" });
      footer();
      break;
    }
    case "stats": {
      header();
      eyebrow({ x: contentX, y: 1.05, w: contentW, h: 0.42 });
      title({ x: contentX, y: 1.55, w: contentW, h: 1.25 }, 36);
      const count = Math.max(slide.body.length, 1);
      const colW = contentW / count;
      slide.body.forEach((value, i) => {
        const x = contentX + i * colW;
        const { label, text: content } = splitLabel(value);
        if (i) line(x, 3.35, 0, 2.9, t.muted, 0.8, 0.5);
        shape("ellipse", x + 0.22, 3.25, 0.22, 0.22, i % 2 ? t.primary : t.accent);
        text(label || pad(i + 1), { x: x + 0.22, y: 3.6, w: colW - 0.44, h: 1.35 }, 54, { fontFace: t.heading, bold: headingBold, color: i % 2 && contrast(t.primary, t.background) >= 3 ? t.primary : t.accentText });
        const element = body(i, { x: x + 0.22, y: 5.0, w: colW - 0.44, h: 1.4 }, 15, { color: t.text });
        if (label && element) Object.assign(element, fitText(content, element, 15, element.fontFace, element.lineHeight), { text: content });
      });
      footer();
      break;
    }
    case "process": {
      header();
      eyebrow({ x: contentX, y: 1.05, w: contentW, h: 0.42 });
      title({ x: contentX, y: 1.55, w: contentW, h: 1.25 }, 36);
      const count = Math.max(slide.body.length, 1);
      const stepW = contentW / count;
      slide.body.forEach((value, i) => {
        const x = contentX + i * stepW;
        poly(x, 3.2, stepW - 0.08, 0.95, i % 2 ? t.accent : t.primary, i === 0 ? [[0, 0], [0.86, 0], [1, 0.5], [0.86, 1], [0, 1]] : CHEVRON);
        const { label, text: content } = splitLabel(value);
        text(label || `Tahap ${i + 1}`, { x: x + (i ? 0.38 : 0.22), y: 3.42, w: stepW - 0.85, h: 0.55 }, 15, { bold: true, color: i % 2 ? t.onAccent : t.onPrimary });
        const element = body(i, { x: x + 0.12, y: 4.45, w: stepW - 0.3, h: 2.2 }, 15);
        if (label && element) Object.assign(element, fitText(content, element, 15, element.fontFace, element.lineHeight), { text: content });
      });
      footer();
      break;
    }
    case "compare": {
      header();
      eyebrow({ x: contentX, y: 1.05, w: contentW, h: 0.42 });
      title({ x: contentX, y: 1.55, w: contentW, h: 1.25 }, 36);
      const count = Math.min(Math.max(slide.body.length, 1), 4);
      const colW = (contentW - 0.4) / 2;
      const rowsCount = count > 2 ? 2 : 1;
      const boxH = rowsCount === 2 ? 1.6 : 2.6;
      slide.body.forEach((value, i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = contentX + col * (colW + 0.4), y = 3.1 + row * (boxH + 0.25);
        const fill = col ? t.accent : t.primary;
        shape("roundRect", x, y, colW, boxH, t.surface);
        shape("rect", x, y, 0.14, boxH, fill);
        const { label, text: content } = splitLabel(value);
        if (label) text(label, { x: x + 0.38, y: y + 0.2, w: colW - 0.6, h: 0.5 }, 17, { bold: true, color: t.onSurface });
        const element = body(i, { x: x + 0.38, y: y + (label ? 0.72 : 0.25), w: colW - 0.6, h: boxH - (label ? 0.9 : 0.45) }, 15, { color: t.onSurface });
        if (label && element) Object.assign(element, fitText(content, element, 15, element.fontFace, element.lineHeight), { text: content });
      });
      footer();
      break;
    }
    case "figure": {
      header();
      title({ x: contentX, y: 1.0, w: contentW, h: 1.0 }, 30);
      const card = { x: fx(contentX, 7.7), y: 2.15, w: 7.7, h: 4.15 };
      shape("roundRect", card.x + 0.12, card.y + 0.14, card.w, card.h, t.accent, { opacity: 0.5 });
      shape("roundRect", card.x, card.y, card.w, card.h, "FFFFFF", { lineColor: mix(t.text, "FFFFFF", 0.8), lineWidth: 0.75 });
      const inner = { x: card.x + 0.18, y: card.y + 0.18, w: card.w - 0.36, h: card.h - 0.36 };
      if (art) elements.push({ type: "image", ...art, editKey: "art", ...inner, crop: "contain" });
      else text("Gambar dari laporan akan tampil di sini.", { x: inner.x, y: inner.y + inner.h / 2 - 0.2, w: inner.w, h: 0.4 }, 14, { color: "6B6B6B", align: "center" });
      if (slide.body[0]) body(0, { x: card.x, y: 6.42, w: card.w, h: 0.45 }, 12, { color: t.muted, align: "center" });
      const sideX = mirror ? contentX : 9.0;
      slide.body.slice(1).forEach((_, i) => {
        const y = 2.3 + i * 1.4;
        shape("rect", sideX, y + 0.08, 0.1, 1.05, i % 2 ? t.accent : t.primary);
        body(i + 1, { x: sideX + 0.3, y, w: 3.15, h: 1.3 }, 15);
      });
      footer();
      break;
    }
    default: {
      header();
      title({ x: contentX, y: 1.3, w: contentW, h: 1.3 }, 36);
      slide.body.forEach((_, i) => body(i, { x: contentX, y: 2.9 + i * 0.9, w: contentW, h: 0.8 }, 18));
      footer();
    }
  }

  for (const element of elements) {
    const adjustment = element.editKey && slide.adjustments?.find((item) => item.target === element.editKey);
    if (adjustment) {
      const { x, y, w, h } = adjustment;
      Object.assign(element, { x, y, w, h });
      if (element.type === "text") Object.assign(element, fitText(element.text, element, textSizes.get(element) ?? element.fontSize, element.fontFace, element.lineHeight, 0.5));
    }
    if (element.type === "text" && element.editKey && element.fontSize < 14 && (textSizes.get(element) ?? 0) >= 18 && !issues.some((issue) => issue.code === "small-text")) {
      issues.push({ slideId: slide.id, code: "small-text", severity: "warning", message: "Teks diperkecil agar muat. Ringkas isi atau perbesar kotaknya agar nyaman dibaca." });
    }
  }
  return { width: W, height: H, background: t.background, elements, issues };
}

/** Image files a designed deck references besides slide art (logo). */
export function designAssetIds(deck: Pick<PresentationDeck, "design">): string[] {
  return deck.design?.logo ? [deck.design.logo] : [];
}

/** Example identities shown as "Contoh tampilan"; the AI adapts them, it does not copy a template. */
export const STYLE_EXAMPLES: readonly { id: string; label: string; description: string; design: Omit<DeckDesign, "seed" | "institution" | "logo"> }[] = [
  { id: "biru-korporat", label: "Biru Korporat", description: "Putih, biru tegas, garis kuning diagonal, foto dalam heksagon.", design: { primary: "1E40D8", accent: "FFC928", background: "F7F9FC", surface: "E8EEFB", text: "0F1B3D", frame: "diagonal", fonts: "tegas" } },
  { id: "kolase-kuning", label: "Kolase Kuning", description: "Kertas abu muda, titik halftone kuning, label pil hitam, kolase.", design: { primary: "1B1B1B", accent: "FFC21A", background: "F3F2EE", surface: "FFFFFF", text: "151515", frame: "halftone", fonts: "tegas" } },
  { id: "hitam-lime", label: "Hitam Lime", description: "Latar hitam, judul raksasa hijau lime, kesan berani dan modern.", design: { primary: "B6F23A", accent: "B6F23A", background: "0E0F0C", surface: "1C1E19", text: "F4F6EF", frame: "minimal", fonts: "kondensasi" } },
  { id: "navy-oranye", label: "Navy Oranye", description: "Putih, navy dan oranye, foto lingkaran, bentuk membulat.", design: { primary: "1C1A6E", accent: "FF9F1C", background: "FFFFFF", surface: "F1F1F8", text: "16153F", frame: "blob", fonts: "geometris" } },
  { id: "ungu-geometris", label: "Ungu Geometris", description: "Ungu tegas dan abu gelap, segitiga di sudut, bersih.", design: { primary: "5B2EDB", accent: "2F2F37", background: "F6F5FA", surface: "ECE8FB", text: "1D1B26", frame: "geometric", fonts: "bersih" } },
  { id: "merah-muda-gelombang", label: "Merah Muda Lembut", description: "Krem dan merah muda, gelombang di bawah, serif anggun.", design: { primary: "D9818C", accent: "8C3B4A", background: "FFF8F5", surface: "FBE7E4", text: "4A2430", frame: "wave", fonts: "elegan" } },
  { id: "biru-grid", label: "Biru Grid Teknik", description: "Grid halus, navy dan biru, bintang kecil, rapi dan teknis.", design: { primary: "16416F", accent: "3E86C6", background: "F5F8FB", surface: "E3EBF3", text: "102A45", frame: "grid", fonts: "ramah" } },
  { id: "hijau-krem", label: "Hijau Krem", description: "Krem hangat dan hijau sage, garis tipis, minimalis akademik.", design: { primary: "4E8C76", accent: "C9A66B", background: "FBF7EE", surface: "EEF3EC", text: "24352E", frame: "minimal", fonts: "geometris" } },
  { id: "merah-gelap", label: "Merah Gelap", description: "Hitam dengan blok gradien merah, kontras dan dramatis.", design: { primary: "C1121F", accent: "FF4D5A", background: "0B0B0D", surface: "1A1A1F", text: "F5F5F5", frame: "gradient", fonts: "bersih" } },
  { id: "cokelat-elegan", label: "Cokelat Elegan", description: "Krem dan cokelat, berlian kecil, nuansa tenang dan formal.", design: { primary: "6B4E37", accent: "C8A27A", background: "F3ECE2", surface: "E7DCCD", text: "3B2A1E", frame: "geometric", fonts: "elegan" } },
];
