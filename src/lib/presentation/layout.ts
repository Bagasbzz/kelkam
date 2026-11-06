import { EDIT_TARGETS, inspectSlide, slideAdjustmentSchema, THEMES, type ArtDirection, type PresentationFont, type PresentationIssue, type PresentationPalette, type PresentationSlide, type PresentationTheme, type SlideEditTarget } from "./model";
import { PALETTES } from "./presets";

export const SLIDE_WIDTH = 13.333;
export const SLIDE_HEIGHT = 7.5;

export interface Bounds { x: number; y: number; w: number; h: number }
interface EditableElement { readonly editKey?: SlideEditTarget }
export interface TextElement extends Bounds, EditableElement {
  type: "text"; text: string; lines: string[]; fontFace: PresentationFont; fontSize: number;
  color: string; bold: boolean; align: "left" | "center" | "right"; lineHeight: number;
}
export interface ShapeElement extends Bounds, EditableElement {
  type: "shape"; shape: "rect" | "roundRect" | "ellipse" | "polygon";
  fill: string; opacity?: number; lineColor?: string; lineWidth?: number;
  /** Normalized, internally authored vertices, not model-generated SVG or code. */
  points?: readonly (readonly [number, number])[];
}
export interface LineElement extends Bounds, EditableElement { type: "line"; color: string; lineWidth: number; opacity?: number; flipV?: boolean }
export interface ImageElement extends Bounds, EditableElement {
  type: "image"; fileId: string; role: "hero" | "background" | "cutout"; alt: string; crop: "cover" | "contain"; opacity?: number;
}
export type SlideElement = TextElement | ShapeElement | LineElement | ImageElement;
export interface SlideScene { width: number; height: number; background: string; elements: SlideElement[]; issues: PresentationIssue[] }

/** Keep pointer-derived geometry finite and wholly on the slide before persisting. */
export function constrainBounds(bounds: Bounds): Bounds {
  if (![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite)) throw new RangeError("Batas elemen harus berupa angka finite.");
  const w = Math.max(0.5, Math.min(SLIDE_WIDTH, bounds.w));
  const h = Math.max(0.3, Math.min(SLIDE_HEIGHT, bounds.h));
  let x = Math.max(0, Math.min(SLIDE_WIDTH - w, bounds.x));
  let y = Math.max(0, Math.min(SLIDE_HEIGHT - h, bounds.y));
  // Roundoff must not create a box rejected by the strict persisted schema.
  if (x + w > SLIDE_WIDTH) x = Math.max(0, x - Number.EPSILON * SLIDE_WIDTH);
  if (y + h > SLIDE_HEIGHT) y = Math.max(0, y - Number.EPSILON * SLIDE_HEIGHT);
  return { x, y, w, h };
}

export function adjustSlideElement(slide: PresentationSlide, target: SlideEditTarget, bounds: Bounds): PresentationSlide {
  const adjustment = slideAdjustmentSchema.parse({ target, ...constrainBounds(bounds) });
  // Draft text may be temporarily blank while editing; validate the full deck on save.
  return { ...slide, adjustments: [...(slide.adjustments ?? []).filter((item) => item.target !== target), adjustment] };
}

// Conservative system-font width estimates keep wrapping deterministic and offline.
function textWidth(value: string, fontSize: number, fontFace: PresentationFont): number {
  let units = 0;
  for (const char of value) {
    if (/\s/u.test(char)) units += 0.34;
    else if (/[ilI1.,:;'!|]/u.test(char)) units += 0.35;
    else if (/[mwMW@%]/u.test(char)) units += 1.02;
    else if (/[A-Z0-9]/u.test(char)) units += 0.76;
    else if (char.codePointAt(0)! > 0x2ff) units += 1.12;
    else units += 0.63;
  }
  return units * fontSize / 72 * (fontFace === "Arial Black" ? 1.13 : fontFace === "Impact" ? 0.91 : 1);
}

function wrapText(value: string, width: number, fontSize: number, fontFace: PresentationFont): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(/\s+/u).filter(Boolean)) {
    if (line && textWidth(`${line} ${word}`, fontSize, fontFace) <= width) { line += ` ${word}`; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const char of word) {
      if (line && textWidth(line + char, fontSize, fontFace) > width) { lines.push(line); line = ""; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(value: string, bounds: Bounds, size: number, fontFace: PresentationFont, lineHeight: number, minimum = 9) {
  const officeLeading = fontFace === "Impact" ? 1.35 : 1.17;
  let fontSize = size;
  let lines = wrapText(value, bounds.w, fontSize, fontFace);
  while (fontSize > minimum && lines.length * fontSize / 72 * lineHeight * officeLeading > bounds.h - 0.04) {
    fontSize = Math.max(minimum, fontSize - (fontSize > 9 ? 1 : 0.25));
    lines = wrapText(value, bounds.w, fontSize, fontFace);
  }
  return { fontSize, lines };
}

/** Pure, authoritative inch geometry for both browser previews and native PPTX. */
export function layoutSlide(slide: PresentationSlide, theme: PresentationTheme, index = 0, total = 1, artDirection?: ArtDirection, paletteId?: PresentationPalette): SlideScene {
  const style = artDirection?.style ?? ({ playful: "zine", editorial: "geometric", product: "kinetic" } as const)[theme];
  const originalPalette = style === "blueprint"
    ? { ...THEMES[theme], background: "102E50", foreground: "F1F7FA", muted: "B0CADD", accent: "8BD9EA", secondary: "315877", surface: "193D60", headingFont: "Arial" as const }
    : THEMES[theme];
  const palette = paletteId && paletteId !== "original" ? { ...originalPalette, ...PALETTES[paletteId] } : originalPalette;
  const headingFont: PresentationFont = style === "zine" ? "Arial Black" : style === "kinetic" ? "Impact" : palette.headingFont;
  const elements: SlideElement[] = [];
  const issues = inspectSlide(slide);
  const textSizes = new Map<TextElement, number>();
  const shape = (kind: ShapeElement["shape"], x: number, y: number, w: number, h: number, fill: string, options: Partial<Pick<ShapeElement, "lineColor" | "lineWidth" | "opacity" | "points">> = {}) => {
    elements.push({ type: "shape", shape: kind, x, y, w, h, fill, ...options });
  };
  const polygon = (x: number, y: number, w: number, h: number, fill: string, points: ShapeElement["points"], opacity = 1) => shape("polygon", x, y, w, h, fill, { points, opacity });
  const line = (x: number, y: number, w: number, h: number, color = palette.muted, lineWidth = 1, opacity = 1, flipV = false) => {
    elements.push({ type: "line", x, y, w, h, color, lineWidth, opacity, flipV });
  };
  const text = (value: string, x: number, y: number, w: number, h: number, size: number, options: Partial<Pick<TextElement, "fontFace" | "color" | "bold" | "align" | "lineHeight" | "editKey">> = {}) => {
    if (!value) return;
    const fontFace = options.fontFace ?? palette.bodyFont;
    const lineHeight = options.lineHeight ?? 1.28;
    const element: TextElement = { type: "text", text: value, ...fitText(value, { x, y, w, h }, size, fontFace, lineHeight), x, y, w, h, lineHeight, fontFace, color: palette.foreground, bold: false, align: "left", ...options };
    elements.push(element);
    textSizes.set(element, size);
  };
  const heading = (x: number, y: number, w: number, h: number, size: number) => text(slide.title, x, y, w, h, size, { editKey: "title", fontFace: headingFont, bold: headingFont !== "Georgia" && headingFont !== "Impact", lineHeight: headingFont === "Georgia" ? 1.28 : 1.12 });
  const body = (i: number, x: number, y: number, w: number, h: number, size: number) => text(slide.body[i], x, y, w, h, size, { editKey: `body-${i}` as SlideEditTarget });

  // Texture is bounded native geometry, so exported slides remain fully editable.
  const background = slide.visual?.background ?? (style === "zine" ? "halftone" : style === "blueprint" ? "grid" : "solid");
  if (background === "halftone") {
    for (let row = 0; row < 13; row++) for (let col = 0; col < 12; col++) {
      const diameter = 0.024 + (col / 11) * 0.041;
      shape("ellipse", 9.35 + col * 0.28, 0.8 + row * 0.39, diameter, diameter, palette.foreground, { opacity: 0.28 });
    }
  } else if (background === "grid" || style === "blueprint") {
    for (let i = 0; i <= 26; i++) line(i * 0.5, 0, 0, 7.5, palette.secondary, 0.5, 0.55);
    for (let i = 0; i <= 15; i++) line(0, i * 0.5, 13.333, 0, palette.secondary, 0.5, 0.55);
  } else if (background === "spotlight") {
    for (let i = 0; i < 5; i++) shape("ellipse", 8.35 + i * 0.28, 1.1 + i * 0.28, 4.5 - i * 0.56, 4.5 - i * 0.56, palette.accent, { opacity: 0.025 + i * 0.012 });
  }

  if (slide.art?.role === "background") {
    elements.push({ type: "image", ...slide.art, editKey: "art", x: 0, y: 0, w: SLIDE_WIDTH, h: SLIDE_HEIGHT, crop: "cover", opacity: 0.34 });
    shape("rect", 0, 0, 8.45, 7.5, palette.background, { opacity: 0.96 });
  }

  if (style === "geometric") {
    polygon(8.55, 0, 4.783, 7.5, palette.secondary, [[0.4, 0], [1, 0], [1, 1], [0, 1]]);
    polygon(11.5, 0, 1.833, 2.2, palette.accent, [[0, 0], [1, 0], [1, 1]]);
    line(0.65, 0.48, 11.95, 0, palette.foreground, 1.2);
  } else if (style === "zine") {
    polygon(8.4, 1.2, 4.35, 4.9, palette.secondary, [[0.13, 0], [1, 0.09], [0.9, 1], [0, 0.87]]);
    shape("rect", 0.65, 0.57, 0.2, 0.43, palette.accent);
    line(0.65, 6.87, 11.98, 0, palette.foreground, 2.2);
  } else if (style === "kinetic") {
    shape("rect", 0, 0, 0.16, 7.5, palette.accent);
    polygon(11.65, 0.5, 0.98, 0.54, palette.accent, [[0, 0], [0.6, 0], [1, 0.5], [0.6, 1], [0, 1], [0.4, 0.5]]);
    line(0.65, 6.87, 11.98, 0, palette.secondary, 0.8);
  } else {
    line(0.65, 0.48, 11.98, 0, palette.accent, style === "blueprint" ? 0.8 : 1.2);
    line(0.65, 6.87, 11.98, 0, palette.secondary, 0.8);
  }

  // These small scenes express the topic, not arbitrary decorative iconography.
  const motif = (x: number, y: number, w: number, h: number) => {
    const kind = slide.visual?.motif ?? (theme === "playful" ? "megaphone" : theme === "editorial" ? "botanical" : "network");
    const sx = (v: number) => x + v * w;
    const sy = (v: number) => y + v * h;
    const block = (a: number, b: number, c: number, d: number, fill = palette.foreground, opacity = 1) => shape("rect", sx(a), sy(b), c * w, d * h, fill, { opacity });
    const edge = (a: number, b: number, c: number, d: number, color = palette.accent, width = 2) => line(sx(Math.min(a, c)), sy(Math.min(b, d)), Math.abs(c - a) * w, Math.abs(d - b) * h, color, width, 1, (c - a) * (d - b) < 0);
    if (kind === "none") return;
    if (kind === "megaphone") {
      polygon(sx(0.14), sy(0.22), w * 0.65, h * 0.48, palette.accent, [[0, 0.32], [1, 0], [1, 1], [0, 0.68]]);
      block(0.1, 0.365, 0.14, 0.19);
      polygon(sx(0.31), sy(0.59), w * 0.19, h * 0.29, palette.foreground, [[0, 0], [0.7, 0], [1, 1], [0.3, 1]]);
      edge(0.85, 0.23, 0.97, 0.1); edge(0.86, 0.46, 1, 0.46); edge(0.85, 0.68, 0.97, 0.83);
      shape("ellipse", sx(0.745), sy(0.22), w * 0.09, h * 0.48, palette.background, { lineColor: palette.foreground, lineWidth: 2 });
    } else if (kind === "campus") {
      polygon(sx(0.09), sy(0.16), w * 0.8, h * 0.22, palette.accent, [[0, 1], [0.5, 0], [1, 1]]);
      block(0.13, 0.4, 0.72, 0.04); block(0.08, 0.83, 0.82, 0.065); block(0.04, 0.92, 0.9, 0.04);
      for (let i = 0; i < 4; i++) { block(0.17 + i * 0.18, 0.47, 0.065, 0.32); block(0.15 + i * 0.18, 0.77, 0.105, 0.04, palette.accent); }
      shape("ellipse", sx(0.45), sy(0.25), w * 0.08, h * 0.08, palette.background);
    } else if (kind === "botanical") {
      edge(0.5, 0.96, 0.5, 0.18, palette.foreground, 3);
      for (let i = 0; i < 4; i++) {
        const yy = 0.15 + i * 0.17;
        polygon(sx(0.13), sy(yy), w * 0.37, h * 0.23, i % 2 ? palette.accent : palette.foreground, [[0, 0], [0.7, 0.13], [1, 1], [0.26, 0.73]]);
        polygon(sx(0.5), sy(yy + 0.06), w * 0.37, h * 0.23, i % 2 ? palette.foreground : palette.accent, [[1, 0], [0.74, 0.73], [0, 1], [0.3, 0.13]]);
      }
      line(sx(0.08), sy(0.98), w * 0.84, 0, palette.foreground, 1);
    } else if (kind === "orbit") {
      for (let i = 0; i < 3; i++) shape("ellipse", sx(0.06 + i * 0.13), sy(0.06 + i * 0.13), w * (0.88 - i * 0.26), h * (0.88 - i * 0.26), palette.background, { opacity: 0.8, lineColor: i === 1 ? palette.accent : palette.secondary, lineWidth: i === 1 ? 2.2 : 1.2 });
      shape("ellipse", sx(0.39), sy(0.39), w * 0.22, h * 0.22, palette.accent);
      shape("ellipse", sx(0.76), sy(0.16), w * 0.12, h * 0.12, palette.foreground);
      shape("ellipse", sx(0.05), sy(0.57), w * 0.09, h * 0.09, palette.accent);
      edge(0.5, 0.5, 0.82, 0.22, palette.accent, 1);
    } else {
      const nodes = [[0.1, 0.22], [0.67, 0.08], [0.44, 0.47], [0.85, 0.7], [0.12, 0.86]];
      for (const [a, b] of [[0, 2], [1, 2], [2, 3], [2, 4], [0, 1], [3, 4]]) edge(nodes[a][0], nodes[a][1], nodes[b][0], nodes[b][1], palette.accent, 1.4);
      nodes.forEach(([a, b], i) => {
        shape(i === 2 ? "ellipse" : "rect", sx(a - 0.055), sy(b - 0.055), w * 0.11, h * 0.11, i === 2 ? palette.accent : palette.background, { lineColor: palette.foreground, lineWidth: 1.6 });
        if (style === "blueprint") { line(sx(a - 0.085), sy(b), w * 0.17, 0, palette.muted, 0.5); line(sx(a), sy(b - 0.085), 0, h * 0.17, palette.muted, 0.5); }
      });
    }
  };
  const visual = (x: number, y: number, w: number, h: number) => {
    if (slide.art && slide.art.role !== "background") {
      shape("rect", x + 0.12, y + 0.12, w, h, palette.accent);
      elements.push({ type: "image", ...slide.art, editKey: "art", x, y, w, h, crop: slide.art.role === "cutout" ? "contain" : "cover" });
    } else motif(x, y, w, h);
  };

  text(slide.eyebrow, style === "zine" ? 1.02 : 0.65, 0.65, 10.1, 0.37, 12, { editKey: "eyebrow", color: palette.accent, bold: true });
  // Outlier input uses a spacious editorial fallback instead of clipping text.
  const dense = slide.body.some((item) => item.length > 180) || slide.body.join("").length > 540 || ((slide.layout === "title" || slide.layout === "statement") && slide.body.length > 2);
  if (dense) {
    heading(0.65, 1.33, slide.art && slide.art.role !== "background" ? 8 : 11.35, 1.4, 33);
    if (slide.art && slide.art.role !== "background") visual(9.4, 1.25, 2.65, 1.42);
    slide.body.forEach((_, i) => {
      const x = 0.75 + (i % 2) * 6.12;
      const y = 3.0 + Math.floor(i / 2) * 1.85;
      line(x, y, 5.52, 0, palette.accent, 1.5);
      body(i, x, y + 0.13, 5.52, 1.6, 21);
    });
  } else switch (slide.layout) {
    case "title": {
      heading(0.65, 1.36, 7.6, 3.52, style === "kinetic" ? 72 : style === "zine" ? 61 : 57);
      visual(8.75, 1.82, 3.7, 4.2);
      const count = Math.max(slide.body.length, 1);
      slide.body.forEach((_, i) => body(i, 0.7, 5.05 + i * (1.52 / count), 7.15, 1.52 / count - 0.03, 19));
      break;
    }
    case "split": {
      // Preserve measured two-line Georgia clearance: >=98.33pt before y=2.85.
      heading(0.65, 1.33, 11.35, 1.4, 33);
      const step = 3.6 / Math.max(slide.body.length, 1);
      slide.body.forEach((_, i) => {
        const y = 2.98 + i * step;
        text(String(i + 1).padStart(2, "0"), 0.7, y + 0.02, 0.6, 0.43, 18, { fontFace: headingFont, color: palette.accent });
        body(i, 1.5, y, 5.9, step - 0.08, 21);
        if (i < slide.body.length - 1) line(1.5, y + step - 0.11, 5.9, 0, palette.secondary, 0.7);
      });
      visual(8.65, 3.02, 3.5, 3.3);
      break;
    }
    case "cards": {
      heading(0.65, 1.4, 4.0, 3.8, style === "zine" ? 41 : 43);
      const step = 4.88 / Math.max(slide.body.length, 1);
      slide.body.forEach((_, i) => {
        const y = 1.4 + i * step;
        line(5.16, y, 7.1, 0, palette.foreground, 0.9);
        text(String(i + 1).padStart(2, "0"), 5.18, y + 0.12, 0.88, 0.68, 33, { fontFace: headingFont, color: palette.accent });
        body(i, 6.37, y + 0.13, 5.8, step - 0.2, 23);
      });
      if (!slide.art) motif(1.02, 5.15, 2.8, 1.32);
      else visual(0.78, 5.07, 3.45, 1.4);
      break;
    }
    case "timeline": {
      heading(0.65, 1.28, slide.art && slide.art.role !== "background" ? 8.4 : 11.6, 1.5, 36);
      if (slide.art && slide.art.role !== "background") visual(9.5, 1.28, 2.6, 1.36);
      const count = Math.max(1, slide.body.length);
      const step = 11.82 / count;
      slide.body.forEach((_, i) => {
        const x = 0.7 + i * step;
        const y = 3.0 + (i % 2) * 0.28;
        polygon(x, y, step - 0.15, 0.65, i % 2 ? palette.secondary : palette.accent, [[0, 0], [0.86, 0], [1, 0.5], [0.86, 1], [0, 1]]);
        text(String(i + 1).padStart(2, "0"), x + 0.12, y + 0.1, step - 0.52, 0.43, 20, { bold: true, color: i % 2 ? palette.foreground : palette.background });
        body(i, x, y + 1, step - 0.25, 2.46, 21);
      });
      break;
    }
    case "statement": {
      line(0.7, 1.38, 1.5, 0, palette.accent, 5);
      heading(0.65, 1.78, 11.5, 2.85, style === "kinetic" ? 61 : 49);
      const count = Math.max(1, slide.body.length);
      slide.body.forEach((_, i) => body(i, 0.75, 4.98 + i * (1.5 / count), 8.18, 1.5 / count - 0.04, 20));
      visual(10.05, 5.0, 2.1, 1.45);
      break;
    }
  }
  text(`${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`, 11.25, 7.02, 1.35, 0.25, 10, { color: palette.muted, align: "right" });
  for (const element of elements) {
    const adjustment = element.editKey && slide.adjustments?.find((item) => item.target === element.editKey);
    if (adjustment) {
      const { x, y, w, h } = adjustment;
      Object.assign(element, { x, y, w, h });
      // Tiny user boxes may require sub-9pt text; retain all words and flag QA.
      if (element.type === "text") Object.assign(element, fitText(element.text, element, textSizes.get(element)!, element.fontFace, element.lineHeight, 0.5));
    }
    if (element.type === "text" && element.fontSize < 16 && textSizes.get(element)! >= 18 && !issues.some((issue) => issue.code === "small-text")) {
      issues.push({ slideId: slide.id, code: "small-text", severity: "warning", message: "Teks diperkecil untuk menjaga batas slide. Ringkas isi atau perbesar elemen agar nyaman dibaca saat presentasi." });
    }
  }
  return { width: SLIDE_WIDTH, height: SLIDE_HEIGHT, background: palette.background, elements, issues };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

/** Fixed line breaks and image cropping match the editable PPTX. */
export function renderSlideSvg(scene: SlideScene): string {
  const scale = 96;
  const elements = scene.elements.map((element) => {
    const { x, y, w, h } = element;
    const editAttribute = element.editKey && (EDIT_TARGETS as readonly string[]).includes(element.editKey) ? ` data-edit-key="${element.editKey}"` : "";
    if (element.type === "shape") {
      const common = `fill="#${element.fill}" fill-opacity="${element.opacity ?? 1}" stroke="${element.lineColor ? `#${element.lineColor}` : "none"}" stroke-width="${(element.lineWidth ?? 0) * scale / 72}"`;
      if (element.shape === "polygon") return `<polygon points="${element.points!.map(([a, b]) => `${(x + a * w) * scale},${(y + b * h) * scale}`).join(" ")}" ${common}/>`;
      return element.shape === "ellipse"
        ? `<ellipse cx="${(x + w / 2) * scale}" cy="${(y + h / 2) * scale}" rx="${w * scale / 2}" ry="${h * scale / 2}" ${common}/>`
        : `<rect x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" rx="${element.shape === "roundRect" ? 0.12 * scale : 0}" ${common}/>`;
    }
    if (element.type === "line") return `<line x1="${x * scale}" y1="${(y + (element.flipV ? h : 0)) * scale}" x2="${(x + w) * scale}" y2="${(y + (element.flipV ? 0 : h)) * scale}" stroke="#${element.color}" stroke-opacity="${element.opacity ?? 1}" stroke-width="${element.lineWidth * scale / 72}"/>`;
    if (element.type === "image") {
      return `<svg${editAttribute} x="${x * scale}" y="${y * scale}" width="${w * scale}" height="${h * scale}" overflow="hidden"><image href="/api/files/${escapeXml(encodeURIComponent(element.fileId))}" width="100%" height="100%" preserveAspectRatio="xMidYMid ${element.crop === "cover" ? "slice" : "meet"}" opacity="${element.opacity ?? 1}"><title>${escapeXml(element.alt)}</title></image></svg>`;
    }
    const anchor = element.align === "center" ? "middle" : element.align === "right" ? "end" : "start";
    const tx = (x + (element.align === "center" ? w / 2 : element.align === "right" ? w : 0)) * scale;
    const spans = element.lines.map((value, i) => `<tspan x="${tx}" y="${y * scale + (i * element.lineHeight + 1) * element.fontSize * scale / 72}">${escapeXml(value)}</tspan>`).join("");
    return `<text${editAttribute} font-family="${element.fontFace}" font-size="${element.fontSize * scale / 72}" font-weight="${element.bold ? 700 : 400}" fill="#${element.color}" text-anchor="${anchor}" xml:space="preserve">${spans}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width * scale}" height="${scene.height * scale}" viewBox="0 0 ${scene.width * scale} ${scene.height * scale}" role="img" aria-label="Pratinjau slide"><rect width="100%" height="100%" fill="#${scene.background}"/>${elements}</svg>`;
}
