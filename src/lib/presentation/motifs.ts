/**
 * src/lib/presentation/motifs.ts
 * -----------------------------------------------------------------------------
 * Generative decoration per deck. The deck seed picks a motif family, a backdrop and
 * small style "genes", then every parameter (count, size, phase, placement, colors)
 * is drawn from the seed. Two generates therefore never share the same decoration,
 * even with the same palette. Only native shapes are produced, so the PPTX export
 * stays editable and identical to the preview.
 */
import type { LineElement, ShapeElement } from "./layout";

export type Points = readonly (readonly [number, number])[];
type Box = { x: number; y: number; w: number; h: number };
type Element = ShapeElement | LineElement;

export const MOTIF_FAMILIES = ["contour", "confetti", "rings", "mosaic", "terrain", "stripes", "orbit", "grain", "arcs"] as const;
export type MotifFamily = (typeof MOTIF_FAMILIES)[number];
export const BACKDROPS = ["plain", "split", "glow", "band", "corner"] as const;
export type Backdrop = (typeof BACKDROPS)[number];

export interface StyleGenes {
  motif: MotifFamily;
  backdrop: Backdrop;
  /** Card rendering for "cards"/"compare": colored tiles, open columns, or staggered cut-corner panels. */
  cards: "tiles" | "columns" | "stagger";
  /** List markers for bullets: motif glyph, short bar, outline ring, or bold lead-in only. */
  marker: "glyph" | "bar" | "ring" | "lead";
  /** Eyebrow treatment: spaced caps, caps after a short rule, or a filled tag. */
  eyebrow: "caps" | "rule" | "tag";
  /** Agenda treatment: ruled list, stacked large items, or outlined numerals. */
  agenda: "rule" | "stack" | "outline";
  /** 0..1 corner the motif favors (0 = top-right/bottom-left, 1 = top-left/bottom-right). */
  corner: 0 | 1;
  /** How strongly the background leans toward the primary color (0..0.08). */
  tint: number;
  /** Glyph used for markers and small accents. */
  glyph: "diamond" | "triangle" | "square" | "dot" | "plus";
}

const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length];
const r3 = (value: number) => Math.round(value * 1000) / 1000;

/** Frame hint from the AI biases, but never fixes, the motif family. */
const FRAME_BIAS: Record<string, readonly MotifFamily[]> = {
  diagonal: ["stripes", "mosaic", "confetti"], blob: ["contour", "orbit", "grain"], wave: ["terrain", "contour", "arcs"],
  geometric: ["mosaic", "arcs", "confetti"], grid: ["mosaic", "rings", "grain"], halftone: ["grain", "confetti", "contour"],
  minimal: ["rings", "orbit", "arcs"], gradient: ["stripes", "orbit", "terrain"],
};

export function styleGenes(seed: number, frame: string, random: (seed: number) => () => number): StyleGenes {
  const rand = random(seed ^ 0x5bd1e995);
  const bias = FRAME_BIAS[frame] ?? MOTIF_FAMILIES;
  return {
    motif: rand() < 0.55 ? pick(rand, bias) : pick(rand, MOTIF_FAMILIES),
    backdrop: pick(rand, BACKDROPS),
    cards: pick(rand, ["tiles", "columns", "stagger"] as const),
    marker: pick(rand, ["glyph", "bar", "ring", "lead"] as const),
    eyebrow: pick(rand, ["caps", "rule", "tag"] as const),
    agenda: pick(rand, ["rule", "stack", "outline"] as const),
    corner: rand() < 0.5 ? 0 : 1,
    tint: r3(0.02 + rand() * 0.06),
    glyph: pick(rand, ["diamond", "triangle", "square", "dot", "plus"] as const),
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers (normalized 0..1 polygons)
// ---------------------------------------------------------------------------

export function ngon(sides: number, rotation = 0): Points {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (Math.PI * 2 * i) / sides - Math.PI / 2;
    points.push([r3(0.5 + 0.5 * Math.cos(angle)), r3(0.5 + 0.5 * Math.sin(angle))]);
  }
  return points;
}

/** Ring segment (thick arc) between radii r0..r1 (fractions of half size) and angles a0..a1. */
function arcBand(r0: number, r1: number, a0: number, a1: number, cx = 0.5, cy = 0.5): Points {
  const outer: [number, number][] = [];
  const inner: [number, number][] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    outer.push([r3(cx + r1 * Math.cos(a)), r3(cy + r1 * Math.sin(a))]);
    inner.push([r3(cx + r0 * Math.cos(a)), r3(cy + r0 * Math.sin(a))]);
  }
  return [...outer, ...inner.reverse()];
}

function wobble(rand: () => number, roughness: number): Points {
  const a = rand() * Math.PI * 2, b = rand() * Math.PI * 2, k = 2 + Math.floor(rand() * 3);
  const points: [number, number][] = [];
  for (let i = 0; i < 40; i++) {
    const t = (Math.PI * 2 * i) / 40;
    const r = 0.5 * (1 - roughness + roughness * (0.5 + 0.35 * Math.sin(k * t + a) + 0.15 * Math.sin((k + 2) * t + b)));
    points.push([r3(0.5 + r * Math.cos(t)), r3(0.5 + r * Math.sin(t))]);
  }
  return points;
}

export function glyphPoints(glyph: StyleGenes["glyph"]): Points | "ellipse" {
  switch (glyph) {
    case "diamond": return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case "triangle": return ngon(3);
    case "square": return [[0, 0], [1, 0], [1, 1], [0, 1]];
    case "plus": return [[0.36, 0], [0.64, 0], [0.64, 0.36], [1, 0.36], [1, 0.64], [0.64, 0.64], [0.64, 1], [0.36, 1], [0.36, 0.64], [0, 0.64], [0, 0.36], [0.36, 0.36]];
    default: return "ellipse";
  }
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface MotifColors { primary: string; accent: string; text: string; surface: string; background: string }

function make() {
  const out: Element[] = [];
  const fill = (x: number, y: number, w: number, h: number, color: string, points: Points | "ellipse" | "rect", opacity = 1) => {
    if (w <= 0 || h <= 0) return;
    out.push(points === "ellipse" ? { type: "shape", shape: "ellipse", x, y, w, h, fill: color, opacity }
      : points === "rect" ? { type: "shape", shape: "rect", x, y, w, h, fill: color, opacity }
        : { type: "shape", shape: "polygon", x, y, w, h, fill: color, opacity, points });
  };
  const outline = (x: number, y: number, w: number, h: number, color: string, points: Points | "ellipse", width = 1.2) => {
    out.push(points === "ellipse"
      ? { type: "shape", shape: "ellipse", x, y, w, h, fill: color, opacity: 0, lineColor: color, lineWidth: width }
      : { type: "shape", shape: "polygon", x, y, w, h, fill: color, opacity: 0, lineColor: color, lineWidth: width, points });
  };
  const line = (x: number, y: number, w: number, h: number, color: string, width = 1, opacity = 1, flipV = false) => out.push({ type: "line", x, y, w, h, color, lineWidth: width, opacity, flipV });
  return { out, fill, outline, line };
}

/**
 * Draws the family into a box. `scale` ~1 for slide margins, larger for cover art.
 * Shapes stay inside the box so nothing overlaps the content area of the slide.
 */
export function drawMotif(family: MotifFamily, box: Box, rand: () => number, c: MotifColors, scale = 1): Element[] {
  const { out, fill, outline, line } = make();
  const { x, y, w, h } = box;
  const palette = [c.primary, c.accent, c.text];
  const size = Math.min(w, h);
  switch (family) {
    case "contour": {
      const rings = 4 + Math.floor(rand() * 4);
      const cx = x + w * (0.35 + rand() * 0.3), cy = y + h * (0.35 + rand() * 0.3);
      const base = wobble(rand, 0.35 + rand() * 0.3);
      for (let i = 0; i < rings; i++) {
        const s = size * (0.25 + (0.75 * (i + 1)) / rings);
        outline(cx - s / 2, cy - s / 2, s, s * (0.8 + rand() * 0.25), i % 3 === 1 ? c.accent : c.primary, base, 1 + scale * 0.4);
      }
      fill(cx - size * 0.06, cy - size * 0.06, size * 0.12, size * 0.12, c.accent, "ellipse");
      break;
    }
    case "confetti": {
      const count = Math.round((10 + rand() * 10) * Math.min(2, scale));
      for (let i = 0; i < count; i++) {
        const s = (0.08 + rand() * 0.18) * Math.max(1, scale * 0.8);
        const px = x + rand() * (w - s), py = y + rand() * (h - s);
        const kind = Math.floor(rand() * 4);
        const color = pick(rand, palette);
        if (kind === 0) fill(px, py, s, s, color, "ellipse", 0.9);
        else if (kind === 1) fill(px, py, s, s, color, ngon(3, rand() * Math.PI), 0.9);
        else if (kind === 2) fill(px, py, s * 0.9, s * 0.9, color, ngon(4, rand() * Math.PI), 0.85);
        else line(px, py + s / 2, s * 1.4, 0, color, 2.2, 0.9);
      }
      break;
    }
    case "rings": {
      const cx = x + w * (0.3 + rand() * 0.4), cy = y + h * (0.3 + rand() * 0.4);
      const count = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < count; i++) {
        const s = size * (0.3 + (0.7 * (i + 1)) / count);
        outline(cx - s / 2, cy - s / 2, s, s, i === count - 2 ? c.accent : c.primary, "ellipse", 1 + (i % 2) * scale);
      }
      const dot = size * (0.08 + rand() * 0.08);
      fill(cx + size * 0.28 - dot / 2, cy - size * 0.32, dot, dot, c.accent, "ellipse");
      break;
    }
    case "mosaic": {
      const cell = Math.max(0.32, Math.min(0.7, (0.42 + rand() * 0.2) * scale));
      const cols = Math.max(1, Math.floor(w / cell)), rows = Math.max(1, Math.floor(h / cell));
      const density = 0.45 + rand() * 0.35;
      for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
        if (rand() > density) continue;
        const px = x + col * cell, py = y + r * cell;
        const color = pick(rand, palette);
        const kind = Math.floor(rand() * 5);
        const corner = Math.floor(rand() * 4);
        const a0 = (Math.PI / 2) * corner;
        const [ox, oy] = [[0, 0], [1, 0], [1, 1], [0, 1]][corner];
        if (kind === 0) fill(px, py, cell, cell, color, arcBand(0, 1, a0, a0 + Math.PI / 2, ox, oy));
        else if (kind === 1) fill(px, py, cell, cell, color, "ellipse");
        else if (kind === 2) fill(px, py, cell, cell, color, corner % 2 ? [[0, 0], [1, 0], [0, 1]] : [[1, 0], [1, 1], [0, 1]]);
        else if (kind === 3) fill(px, py, cell, cell, color, arcBand(0.25, 0.5, a0, a0 + Math.PI));
        else fill(px + cell * 0.15, py + cell * 0.15, cell * 0.7, cell * 0.7, color, "rect");
      }
      break;
    }
    case "terrain": {
      const layers = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < layers; i++) {
        const phase = rand() * Math.PI * 2, freq = 1.2 + rand() * 2.2, depth = 0.25 + rand() * 0.4;
        const points: [number, number][] = [];
        for (let k = 0; k <= 28; k++) {
          const px = k / 28;
          points.push([r3(px), r3(depth * (0.5 + 0.5 * Math.sin(phase + px * Math.PI * freq)))]);
        }
        const top = y + (h * i) / (layers + 1);
        fill(x, top, w, y + h - top, i === layers - 1 ? c.primary : i % 2 ? c.accent : c.surface, [...points, [1, 1], [0, 1]], 0.55 + (0.45 * i) / layers);
      }
      break;
    }
    case "stripes": {
      const count = 5 + Math.floor(rand() * 6);
      const gap = w / (count * 1.6);
      const slope = 0.4 + rand() * 0.8;
      for (let i = 0; i < count; i++) {
        const bx = x + i * gap * 1.6;
        const bw = gap * (0.6 + rand() * 0.6);
        fill(bx, y, Math.min(bw + h * slope * 0.3, x + w - bx), h, i % 3 === 2 ? c.accent : c.primary, [[slope * 0.3, 0], [1, 0], [1 - slope * 0.3, 1], [0, 1]], 0.85);
      }
      break;
    }
    case "orbit": {
      const s = size * (0.85 + rand() * 0.3);
      const cx = x + w / 2, cy = y + h / 2;
      outline(cx - s / 2, cy - s / 2, s, s, c.primary, "ellipse", 1.4 + scale);
      outline(cx - s * 0.32, cy - s * 0.32, s * 0.64, s * 0.64, c.accent, "ellipse", 1);
      const planets = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < planets; i++) {
        const a = rand() * Math.PI * 2, rr = i % 2 ? s * 0.32 : s / 2, d = size * (0.07 + rand() * 0.09);
        fill(cx + rr * Math.cos(a) - d / 2, cy + rr * Math.sin(a) - d / 2, d, d, i % 2 ? c.primary : c.accent, "ellipse");
      }
      break;
    }
    case "grain": {
      const step = 0.16 + rand() * 0.08;
      const cols = Math.floor(w / step), rows = Math.floor(h / step);
      const fx = rand(), fy = rand();
      for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
        const dx = col / Math.max(cols - 1, 1) - fx, dy = r / Math.max(rows - 1, 1) - fy;
        const d = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 1.4) * step * 0.85;
        if (d < 0.02) continue;
        fill(x + col * step + (step - d) / 2, y + r * step + (step - d) / 2, d, d, c.accent, "ellipse", 0.9);
      }
      break;
    }
    case "arcs": {
      const count = 3 + Math.floor(rand() * 3);
      const ox = rand() < 0.5 ? 0 : 1, oy = rand() < 0.5 ? 0 : 1;
      const start = Math.atan2(0.5 - oy, 0.5 - ox) - Math.PI / 4;
      for (let i = 0; i < count; i++) {
        const r0 = Math.min(0.9, 0.18 + i * 0.8 / count), r1 = Math.min(1, r0 + 0.8 / count * (0.45 + rand() * 0.35));
        fill(x, y, size, size, pick(rand, palette), arcBand(r0, r1, start, start + Math.PI / 2, ox, oy), 0.9);
      }
      break;
    }
  }
  return out;
}

/** Backdrop layer under everything: splits, glows and bands that change the page itself. */
export function drawBackdrop(kind: Backdrop, W: number, H: number, rand: () => number, c: MotifColors, tone: string, mirror: boolean): Element[] {
  const { out, fill } = make();
  const fx = (x: number, w: number) => mirror ? W - x - w : x;
  switch (kind) {
    case "split": {
      const a = 0.45 + rand() * 0.25, b = a + (rand() - 0.5) * 0.3;
      fill(0, 0, W, H, tone, mirror ? [[0, 0], [1 - a, 0], [1 - b, 1], [0, 1]] : [[a, 0], [1, 0], [1, 1], [b, 1]]);
      break;
    }
    case "glow": {
      const cx = mirror ? W * 0.12 : W * 0.88, cy = rand() < 0.5 ? H * 0.15 : H * 0.85;
      for (let i = 0; i < 6; i++) {
        const s = 9 - i * 1.3;
        fill(cx - s / 2, cy - s / 2, s, s, c.primary, "ellipse", 0.018 + i * 0.008);
      }
      break;
    }
    case "band": {
      const bw = 2.2 + rand() * 1.6;
      fill(fx(W - bw, bw), 0, bw, H, tone, "rect");
      break;
    }
    case "corner": {
      const s = 3.5 + rand() * 2;
      fill(fx(W - s, s), H - s, s, s, tone, [[1, 0], [1, 1], [0, 1]]);
      fill(fx(0, s * 0.6), 0, s * 0.6, s * 0.6, tone, [[0, 0], [1, 0], [0, 1]]);
      break;
    }
    default:
      break;
  }
  return out;
}
