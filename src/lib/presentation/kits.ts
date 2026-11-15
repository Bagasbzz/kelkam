/**
 * src/lib/presentation/kits.ts
 * -----------------------------------------------------------------------------
 * Renderer template ala Canva. Setiap "kit" meniru satu keluarga template desainer
 * (scrapbook denim, kliping, kertas vintage, korporat, seminar minimal, penelitian modern,
 * geometris, cat air): latar bertekstur, dekorasi khas, bingkai foto, gaya judul, kartu,
 * dan sampul sendiri. Warna dari deck (bisa diganti pengguna) mewarnai tekstur lewat
 * duotone, jadi tampilan tetap utuh untuk warna apa pun. Semua elemen tetap bentuk/teks
 * asli PowerPoint (bisa diedit), tekstur berupa gambar bawaan.
 */
import { contrast, luminance, mix, readableOn } from "./color";
import { noDash, splitLabel } from "./content";
import { builtinFileId, type BuiltinAsset } from "./assets";
import { fitText, SLIDE_HEIGHT as H, SLIDE_WIDTH as W, textWidth, type Bounds, type ShapeElement, type SlideElement, type SlideScene, type TextElement } from "./layout";
import { FONT_PAIRS, inspectSlide, type DeckDesign, type KitId, type PresentationFont, type PresentationSlide, type SlideEditTarget } from "./model";
import * as S from "./kit-shapes";

type Align = TextElement["align"];
type Role = "cover" | "section" | "content" | "closing";

export interface KitTokens {
  primary: string; accent: string; bg: string; surface: string; text: string; muted: string;
  deep: string; soft: string; pale: string; onPrimary: string; onAccent: string; onSurface: string; accentText: string;
  dark: boolean; heading: PresentationFont; body: PresentationFont; headingBold: boolean;
}

function tokens(design: DeckDesign): KitTokens {
  const bg = design.background.toUpperCase(), primary = design.primary.toUpperCase(), accent = design.accent.toUpperCase();
  const dark = luminance(bg) < 0.3;
  const text = readableOn(bg, design.text.toUpperCase());
  let surface = design.surface.toUpperCase();
  if (contrast(text, surface) < 4.5 && contrast(readableOn(surface, text), surface) < 4.5) surface = dark ? mix(bg, "FFFFFF", 0.1) : "FFFFFF";
  const pair = FONT_PAIRS[design.fonts];
  const muted = contrast(mix(text, bg, 0.3), bg) >= 4.5 ? mix(text, bg, 0.3) : text;
  return {
    primary, accent, bg, surface, text, muted,
    deep: mix(primary, "000000", 0.35), soft: mix(primary, bg, 0.55), pale: mix(primary, bg, 0.82),
    onPrimary: readableOn(primary, "FFFFFF"), onAccent: readableOn(accent, "151515"), onSurface: readableOn(surface, text),
    accentText: contrast(accent, bg) >= 3 ? accent : contrast(primary, bg) >= 3 ? primary : text,
    dark, heading: pair.heading, body: pair.body, headingBold: pair.headingBold,
  };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------
// Konteks gambar: primitif + teks yang bisa diedit
// ---------------------------------------------------------------------------

export class KitCtx {
  readonly els: SlideElement[] = [];
  readonly sizes = new Map<TextElement, number>();
  readonly rand: () => number;
  readonly deckRand: () => number;
  constructor(readonly t: KitTokens, readonly slide: PresentationSlide, readonly design: DeckDesign, readonly index: number, readonly total: number, readonly deckTitle: string) {
    this.rand = random(design.seed ^ hashString(slide.id));
    this.deckRand = random(design.seed);
  }
  get art() { return this.slide.art; }
  /** Ganjil/genap per slide untuk membalik posisi dekorasi. */
  get flip() { return this.index % 2 === 1; }

  shape(kind: ShapeElement["shape"], x: number, y: number, w: number, h: number, fill: string, options: Partial<Omit<ShapeElement, "type" | "shape" | "x" | "y" | "w" | "h" | "fill">> = {}) {
    const element: ShapeElement = { type: "shape", shape: kind, x, y, w, h, fill, ...options };
    this.els.push(element);
    return element;
  }
  poly(x: number, y: number, w: number, h: number, fill: string, points: S.Pts, options: Partial<Omit<ShapeElement, "type" | "shape" | "points">> = {}) {
    return this.shape("polygon", x, y, w, h, fill, { points, ...options });
  }
  /** Garis terbuka (coretan, jahitan, ornamen). */
  stroke(x: number, y: number, w: number, h: number, color: string, points: S.Pts, width = 2, options: Partial<Pick<ShapeElement, "dash" | "opacity">> = {}) {
    return this.shape("polygon", x, y, w, h, color, { points, open: true, lineColor: color, lineWidth: width, ...options });
  }
  line(x: number, y: number, w: number, h: number, color: string, width = 1, options: { dash?: "dash" | "dot"; opacity?: number } = {}) {
    this.els.push({ type: "line", x, y, w, h, color, lineWidth: width, ...options });
  }
  /** Tekstur bawaan diwarnai duotone, dipotong bentuk `mask`. */
  texture(asset: BuiltinAsset, b: Bounds, tint: { dark: string; light: string }, options: { mask?: S.Pts | "ellipse"; opacity?: number; rotate?: number } = {}) {
    this.els.push({ type: "image", fileId: builtinFileId(asset), role: "background", alt: "", crop: "cover", ...b, tint, ...options });
  }
  /** Bentuk yang diputar (persegi membulat miring, pita). */
  rotatedPoly(x: number, y: number, w: number, h: number, deg: number, points: S.Pts, fill: string, options: Partial<Omit<ShapeElement, "type" | "shape" | "points">> = {}) {
    const r = S.rotated(points, w, h, deg);
    return this.poly(x + r.dx, y + r.dy, r.w, r.h, fill, r.points, options);
  }

  text(raw: string, b: Bounds, size: number, options: Partial<Omit<TextElement, "type" | "text" | "lines" | "fontSize" | "x" | "y" | "w" | "h">> & { min?: number } = {}) {
    if (!raw) return undefined;
    const value = noDash(raw);
    const { min = 9, ...rest } = options;
    const fontFace = rest.fontFace ?? this.t.body;
    const lineHeight = rest.lineHeight ?? 1.25;
    const bold = rest.bold ?? false;
    const element: TextElement = { type: "text", text: value, ...fitText(value, b, size, fontFace, lineHeight, min, bold, rest.spacing ?? 0), ...b, lineHeight, fontFace, color: this.t.text, bold, align: "left", ...rest };
    this.els.push(element);
    this.sizes.set(element, size);
    return element;
  }
  /** Judul slide; `accent` = judul dua warna (separuh akhir kata). */
  title(b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align" | "outline" | "shadow" | "spacing">> & { accent?: string; upper?: boolean } = {}) {
    const { accent, upper, ...rest } = options;
    const raw = upper ? this.slide.title.toUpperCase() : this.slide.title;
    const words = raw.trim().split(/\s+/).length;
    const element = this.text(raw, b, size, { editKey: "title", fontFace: this.t.heading, bold: this.t.headingBold, lineHeight: 1.04, color: this.t.text, ...rest, min: 14 });
    if (element && accent && words >= 2) element.accent = { from: Math.max(1, Math.floor(words / 2)), color: accent };
    return element;
  }
  eyebrow(b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align" | "bold" | "spacing" | "fontFace">> = {}) {
    if (!this.slide.eyebrow) return undefined;
    return this.text(this.slide.eyebrow, b, size, { editKey: "eyebrow", fontFace: this.t.heading, bold: this.t.headingBold, color: this.t.accentText, lineHeight: 1, ...options });
  }
  body(i: number, b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align" | "bold" | "fontFace" | "lineHeight">> = {}) {
    return this.text(this.slide.body[i], b, size, { editKey: `body-${i}` as SlideEditTarget, ...options });
  }
  /** Isi poin tanpa label "Label:" (label digambar terpisah oleh pemanggil). */
  bodyContent(i: number, b: Bounds, size: number, options: Partial<Pick<TextElement, "color" | "align" | "bold">> = {}) {
    const element = this.body(i, b, size, options);
    const { label, text } = splitLabel(this.slide.body[i] ?? "");
    if (element && label) Object.assign(element, fitText(text, element, size, element.fontFace, element.lineHeight, 9, element.bold), { text });
    return element;
  }
  /** Sisipkan elemen di belakang elemen yang sudah ada (mis. pelat judul di belakang teks). */
  behind(target: SlideElement, ...elements: SlideElement[]) {
    const index = this.els.indexOf(target);
    // Elemen yang baru saja ditambahkan dipindah ke belakang target.
    for (const element of elements) { const at = this.els.indexOf(element); if (at >= 0) this.els.splice(at, 1); }
    this.els.splice(index < 0 ? this.els.length : index, 0, ...elements);
  }
  /** Lebar terukur baris terpanjang sebuah teks. */
  measured(element: TextElement) {
    return Math.max(...element.lines.map((line) => textWidth(line, element.fontSize, element.fontFace, element.bold, element.spacing ?? 0)));
  }
  linesHeight(element: TextElement) { return element.lines.length * element.fontSize / 72 * element.lineHeight; }

  /** Foto slide dalam bingkai; tanpa gambar: bidang tekstur cat air lembut, bukan ikon kosong. */
  photo(b: Bounds, frame: S.Pts | "ellipse", options: { rim?: string; rimWidth?: number; editable?: boolean } = {}) {
    const art = this.art;
    if (options.rim) {
      const pad = options.rimWidth ?? 0.1;
      if (frame === "ellipse") this.shape("ellipse", b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, options.rim);
      else this.poly(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, options.rim, frame);
    }
    if (art && art.role !== "background") {
      this.els.push({ type: "image", ...art, editKey: options.editable === false ? undefined : "art", ...b, crop: art.role === "cutout" ? "contain" : "cover", mask: art.role === "cutout" ? undefined : frame });
    } else {
      // Belum ada gambar (gambar AI menyusul): bidang gradien lembut berbentuk bingkai, bukan ikon kosong.
      const darkPage = contrast(this.t.primary, this.t.bg) < 1.6;
      const from = darkPage ? mix(this.t.bg, "FFFFFF", 0.12) : this.t.pale;
      const to = darkPage ? mix(this.t.bg, this.t.accent, 0.3) : this.t.soft;
      const gradient = { to, angle: 45 };
      if (frame === "ellipse") this.shape("ellipse", b.x, b.y, b.w, b.h, from, { gradient });
      else this.poly(b.x, b.y, b.w, b.h, from, frame, { gradient });
      this.texture("kertas-kusut", b, { dark: mix(to, "000000", 0.1), light: from }, { mask: frame, opacity: 0.35 });
    }
  }
}

// ---------------------------------------------------------------------------
// Spesifikasi kit
// ---------------------------------------------------------------------------

interface CardStyle { inner: Bounds; label: string; text: string }
interface KitSpec {
  /** Latar + dekorasi; mengembalikan area aman untuk isi. */
  page(c: KitCtx, role: Role): Bounds;
  /** Judul slide isi di dalam area aman; mengembalikan batas bawah judul. */
  heading(c: KitCtx, area: Bounds, align?: Align): number;
  /** `plain`: kartu tanpa tab/nomor bawaan (agenda, alur, angka) karena komposisi sudah memberi nomor sendiri. */
  card(c: KitCtx, b: Bounds, i: number, kind?: "label" | "plain"): CardStyle;
  frame(c: KitCtx, b: Bounds): S.Pts | "ellipse";
  cover(c: KitCtx, closing: boolean): void;
  section(c: KitCtx): void;
  /** Penanda poin (bullets). */
  marker(c: KitCtx, x: number, y: number, i: number): void;
}

const info = (c: KitCtx) => c.slide.body.slice(1, 4);

// --- 1. Scrapbook denim -------------------------------------------------------
const denim: KitSpec = {
  page(c, role) {
    const { t } = c;
    const denimTint = { dark: mix(t.primary, "000000", 0.45), light: mix(t.primary, "FFFFFF", 0.4) };
    const ginghamTint = { dark: mix(t.primary, t.bg, 0.3), light: t.bg };
    const blotTint = { dark: mix(t.primary, t.bg, 0.25), light: t.bg };
    const big = role !== "content";
    const f = c.flip;
    // Noda cat air di satu sudut, pita kotak-kotak di sudut lain.
    c.texture(f ? "catair-2" : "catair-1", { x: f ? -1.6 : W - 4.6, y: -1.4, w: 6.2, h: 5.4 }, blotTint, { opacity: 0.9 });
    const bw = big ? 7.5 : 5.2, bh = big ? 1.7 : 1.3;
    const band = S.rotated(S.roundRect(bw, bh, 0), bw, bh, f ? 32 : -28);
    c.texture("gingham", { x: (f ? W - (big ? 5.2 : 3.3) : (big ? -1.6 : -2.0)) + band.dx, y: H - (big ? 2.3 : 1.55) + band.dy, w: band.w, h: band.h }, ginghamTint, { mask: band.points });
    if (big) {
      const band2 = S.rotated(S.roundRect(6.5, 1.5, 0), 6.5, 1.5, f ? -30 : 34);
      c.texture("gingham", { x: (f ? -1.2 : W - 4.6) + band2.dx, y: -0.6 + band2.dy, w: band2.w, h: band2.h }, ginghamTint, { mask: band2.points });
    }
    // Potongan denim bertepi zig-zag menempel di sudut.
    const patch = (x: number, y: number, w: number, h: number) => c.texture("denim", { x, y, w, h }, denimTint, { mask: S.tornRect(c.rand, w, h, 0.18, 0.22) });
    if (big || !f) patch(-0.5, -0.5, big ? 3.9 : 2.7, big ? 2.9 : 2.0);
    if (big || f) patch(W - (big ? 3.4 : 2.4), H - (big ? 2.6 : 1.9), big ? 3.9 : 2.7, big ? 3.1 : 2.2);
    // Bintang halftone dan kancing.
    const starAt = (x: number, y: number, s: number) => {
      c.poly(x, y, s, s, t.soft, S.star(5, 0.55), { opacity: 0.9 });
      c.poly(x + s * 0.18, y + s * 0.2, s * 0.64, s * 0.64, t.bg, S.star(5, 0.55), { open: false, opacity: 0, lineColor: "FFFFFF", lineWidth: 1.5, dash: "dot" });
    };
    starAt(f ? W - 1.6 : 0.4, f ? 0.35 : H - 1.5, big ? 1.25 : 0.9);
    if (big) starAt(f ? 0.7 : W - 2.2, f ? H - 1.6 : 0.5, 0.8);
    const button = (x: number, y: number, s: number) => {
      c.shape("ellipse", x, y, s, s, t.deep);
      c.shape("ellipse", x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, t.deep, { lineColor: mix(t.primary, "FFFFFF", 0.35), lineWidth: 1.2, dash: "dash" });
      for (const [dx, dy] of [[0.36, 0.36], [0.56, 0.36], [0.36, 0.56], [0.56, 0.56]]) c.shape("ellipse", x + s * dx - s * 0.04, y + s * dy - s * 0.04, s * 0.12, s * 0.12, mix(t.primary, "FFFFFF", 0.5));
    };
    if (big) { button(f ? 0.5 : W - 2.6, f ? 2.6 : H - 1.05, 0.95); button(f ? W - 3.3 : 2.4, f ? 0.25 : H - 1.3, 0.75); }
    else button(f ? 0.35 : W - 1.25, f ? 0.3 : H - 1.2, 0.8);
    // Bingkai jahitan putus-putus di area isi.
    const area = { x: 0.9, y: 0.75, w: W - 1.8, h: H - 1.4 };
    if (role === "content") c.shape("roundRect", area.x, area.y, area.w, area.h, t.bg, { opacity: 0, lineColor: mix(t.primary, t.bg, 0.35), lineWidth: 1.6, dash: "dash" });
    return { x: area.x + 0.35, y: area.y + 0.25, w: area.w - 0.7, h: area.h - 0.45 };
  },
  heading(c, a) {
    const { t } = c;
    // Judul putih bergaris tepi di atas label bertepi perangko bertekstur denim.
    const title = c.title({ x: a.x + 0.3, y: a.y + 0.18, w: Math.min(a.w * 0.7, 8.4), h: 1.3 }, 34, { color: "FFFFFF", outline: { color: t.deep, width: 1.25 }, upper: true });
    if (!title) return a.y + 0.8;
    const w = c.measured(title) + 0.7, h = c.linesHeight(title) + 0.42;
    c.texture("denim", { x: title.x - 0.35, y: title.y - 0.2, w, h }, { dark: mix(t.primary, "000000", 0.4), light: mix(t.primary, "FFFFFF", 0.35) }, { mask: S.stampRect(w, h, 0.12) });
    c.behind(title, c.els[c.els.length - 1]);
    return title.y + h + 0.15;
  },
  card(c, b) {
    const { t } = c;
    c.shape("roundRect", b.x, b.y, b.w, b.h, t.surface, { lineColor: mix(t.primary, t.bg, 0.55), lineWidth: 1 });
    c.shape("roundRect", b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, t.surface, { opacity: 0, lineColor: mix(t.primary, t.bg, 0.3), lineWidth: 1.2, dash: "dash" });
    return { inner: { x: b.x + 0.28, y: b.y + 0.25, w: b.w - 0.56, h: b.h - 0.45 }, label: t.deep, text: t.onSurface };
  },
  frame(c, b) { return S.tornRect(c.rand, b.w, b.h, 0.12, 0.2); },
  cover(c, closing) {
    const { t } = c;
    const box = { x: 2.3, y: closing ? 2.5 : 2.05, w: W - 4.6, h: closing ? 1.8 : 2.5 };
    c.eyebrow({ x: box.x, y: box.y - 0.55, w: box.w, h: 0.5 }, 20, { align: "center", color: t.primary });
    const title = c.title(box, closing ? 72 : 66, { color: t.deep, align: "center", upper: true });
    const bottom = title ? title.y + c.linesHeight(title) + 0.25 : box.y + box.h;
    c.body(0, { x: box.x, y: bottom, w: box.w, h: 0.7 }, 22, { color: t.primary, align: "center", bold: true });
    info(c).forEach((_, i) => c.body(i + 1, { x: box.x + 1, y: bottom + 0.75 + i * 0.36, w: box.w - 2, h: 0.36 }, 14, { align: "center", color: t.text }));
  },
  section(c) {
    const { t } = c;
    c.texture("denim", { x: -0.3, y: -0.3, w: 6.6, h: H + 0.6 }, { dark: mix(t.primary, "000000", 0.45), light: mix(t.primary, "FFFFFF", 0.35) }, { mask: S.zigzagRect(6.6, H + 0.6, 0.45, { right: true }) });
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 0.9, y: 1.3, w: 4.8, h: 1.6 }, 96, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: "FFFFFF", outline: { color: t.deep, width: 1.5 } });
    c.title({ x: 0.9, y: 3.1, w: 4.9, h: 2.4 }, 44, { color: "FFFFFF", outline: { color: t.deep, width: 1.25 }, upper: true });
    c.body(0, { x: 7.0, y: 3.0, w: 5.2, h: 2.0 }, 22, { color: t.text });
  },
  marker(c, x, y, i) { c.poly(x, y, 0.3, 0.3, i % 2 ? c.t.soft : c.t.primary, S.star(5, 0.55)); },
};

// --- 2. Kliping kertas (merah muda) ------------------------------------------------
const kliping: KitSpec = {
  page(c, role) {
    const { t } = c;
    // Kolase tepi: koran, kertas kotak, glitter; lalu lembar kertas kusut sobek di tengah.
    const torn = (w: number, h: number) => S.tornRect(c.rand, w, h, 0.22, 0.25);
    c.texture("koran", { x: -0.3, y: -0.3, w: 5.2, h: 3.4 }, { dark: "4A4A4A", light: "F3EEE6" }, { mask: torn(5.2, 3.4) });
    c.texture("kertas-kotak", { x: W - 5.2, y: H - 3.2, w: 5.5, h: 3.5 }, { dark: "7F8794", light: "FFFFFF" }, { mask: torn(5.5, 3.5) });
    c.texture("glitter", { x: c.flip ? W - 1.3 : -0.2, y: -0.2, w: 1.5, h: H * 0.62 }, { dark: t.primary, light: mix(t.primary, "FFFFFF", 0.75) }, { mask: torn(1.5, H * 0.62) });
    c.texture("glitter", { x: c.flip ? -0.2 : W - 1.3, y: H * 0.45, w: 1.5, h: H * 0.6 }, { dark: mix(t.accent, t.primary, 0.3), light: mix(t.accent, "FFFFFF", 0.7) }, { mask: torn(1.5, H * 0.6) });
    const sheet = { x: 0.55, y: 0.5, w: W - 1.1, h: H - 1.0 };
    c.poly(sheet.x - 0.08, sheet.y - 0.08, sheet.w + 0.16, sheet.h + 0.16, "FBF7F2", torn(sheet.w + 0.16, sheet.h + 0.16));
    c.texture("kertas-kusut", sheet, { dark: mix(t.primary, "000000", 0.05), light: mix(t.primary, "FFFFFF", 0.6) }, { mask: torn(sheet.w, sheet.h) });
    // Kilau putih dan kupu-kupu.
    const sp = (x: number, y: number, s: number) => c.poly(x, y, s, s, "FFFFFF", S.sparkle(), { opacity: 0.95 });
    sp(c.flip ? W - 2.2 : 1.4, 1.0, 0.5); sp(c.flip ? 1.2 : W - 1.9, H - 1.7, 0.42);
    if (role !== "content") sp(W / 2 + 3.2, 1.3, 0.32);
    if (role !== "content" || c.index % 3 === 0) {
      const bx = c.flip ? W - 2.1 : 0.4, by = c.flip ? H - 1.9 : 0.2;
      c.poly(bx, by, 1.5, 1.4, mix(t.primary, "FFFFFF", 0.25), S.butterfly(), { lineColor: t.deep, lineWidth: 1 });
    }
    return { x: sheet.x + 0.6, y: sheet.y + 0.35, w: sheet.w - 1.2, h: sheet.h - 0.7 };
  },
  heading(c, a, align = "center") {
    const { t } = c;
    const title = c.title({ x: a.x, y: a.y + 0.05, w: a.w, h: 1.2 }, 42, { color: t.deep, align, shadow: { color: "FBF4EC", dx: 0.03, dy: 0.04 } });
    return title ? title.y + c.linesHeight(title) + 0.3 : a.y + 1;
  },
  card(c, b, i) {
    const { t } = c;
    const torn = S.tornRect(c.rand, b.w, b.h, 0.08, 0.18);
    c.poly(b.x + 0.06, b.y + 0.08, b.w, b.h, mix(t.primary, "000000", 0.2), torn, { opacity: 0.25 });
    c.poly(b.x, b.y, b.w, b.h, "FBF6EF", torn);
    // Selotip washi di atas kartu.
    c.rotatedPoly(b.x + b.w / 2 - 0.55, b.y - 0.18, 1.1, 0.34, i % 2 ? 6 : -5, S.roundRect(1.1, 0.34, 0), mix(t.accent, "FFFFFF", 0.3), { opacity: 0.85 });
    return { inner: { x: b.x + 0.3, y: b.y + 0.3, w: b.w - 0.6, h: b.h - 0.5 }, label: t.deep, text: mix(t.deep, "000000", 0.2) };
  },
  frame() { return S.flower(4, 0.16); },
  cover(c, closing) {
    const { t } = c;
    // Judul huruf tempel: tiap huruf di atas ubin bulat/kotak krem.
    c.eyebrow({ x: 1.8, y: 1.15, w: W - 3.6, h: 0.5 }, 20, { align: "center", color: t.deep });
    const spacing = closing ? 14 : 12;
    const title = c.title({ x: 1.4, y: 1.75, w: W - 2.8, h: 3.0 }, closing ? 76 : 70, { color: t.deep, align: "center", spacing });
    if (title) {
      const tiles: SlideElement[] = [];
      const size = title.fontSize / 72;
      title.lines.forEach((line, li) => {
        const width = textWidth(line, title.fontSize, title.fontFace, title.bold, spacing);
        let x = title.x + (title.w - width) / 2;
        const baseline = title.y + (li * title.lineHeight + 1) * size;
        [...line].forEach((ch, k) => {
          const advance = textWidth(ch, title.fontSize, title.fontFace, title.bold, spacing);
          if (ch.trim()) {
            const s = size * 1.02, cx = x + (advance - spacing / 72) / 2;
            const kind = k % 2 ? "ellipse" : "polygon";
            const element: ShapeElement = kind === "ellipse"
              ? { type: "shape", shape: "ellipse", x: cx - s / 2, y: baseline - size * 0.36 - s / 2, w: s, h: s, fill: "FBF4EC", lineColor: mix(t.primary, "FFFFFF", 0.5), lineWidth: 1 }
              : { type: "shape", shape: "polygon", x: cx - s / 2, y: baseline - size * 0.36 - s / 2, w: s, h: s, fill: "FBF4EC", points: S.roundRect(s, s, s * 0.18), lineColor: mix(t.primary, "FFFFFF", 0.5), lineWidth: 1 };
            tiles.push(element);
          }
          x += advance;
        });
      });
      c.els.push(...tiles);
      c.behind(title, ...tiles);
    }
    const bottom = title ? title.y + c.linesHeight(title) + 0.35 : 4.6;
    c.body(0, { x: 2, y: bottom, w: W - 4, h: 0.6 }, 24, { color: t.deep, align: "center", bold: true });
    info(c).forEach((_, i) => c.body(i + 1, { x: 3, y: bottom + 0.7 + i * 0.36, w: W - 6, h: 0.36 }, 14, { align: "center", color: t.deep }));
  },
  section(c) {
    const { t } = c;
    const n = c.slide.eyebrow || String(c.index + 1).padStart(2, "0");
    c.shape("ellipse", W / 2 - 1.05, 1.15, 2.1, 2.1, "FBF4EC", { lineColor: mix(t.primary, "FFFFFF", 0.4), lineWidth: 1.2 });
    c.text(n, { x: W / 2 - 1.05, y: 1.5, w: 2.1, h: 1.4 }, 72, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: t.deep, align: "center", lineHeight: 1 });
    c.title({ x: 1.6, y: 3.55, w: W - 3.2, h: 1.6 }, 50, { color: t.deep, align: "center", shadow: { color: "FBF4EC", dx: 0.04, dy: 0.05 } });
    c.body(0, { x: 2.5, y: 5.25, w: W - 5, h: 1.0 }, 20, { color: t.deep, align: "center" });
  },
  marker(c, x, y) { c.poly(x - 0.02, y - 0.02, 0.36, 0.36, "FFFFFF", S.sparkle()); },
};

// --- 3. Kertas tua vintage ---------------------------------------------------------
const vintage: KitSpec = {
  page(c, role) {
    const { t } = c;
    c.texture("kertas-kusut", { x: 0, y: 0, w: W, h: H }, { dark: mix(t.primary, "000000", 0.35), light: mix(t.primary, "FFFFFF", 0.4) });
    // Lapisan kertas sobek lebih terang di atas dan bawah (kolase).
    c.poly(-0.2, -0.3, W + 0.4, 1.3, mix(t.primary, "FFFFFF", 0.55), S.tornRect(c.rand, W + 0.4, 1.3, 0.35, 0.3, { bottom: true }), { opacity: 0.75 });
    c.poly(-0.2, H - 1.0, W + 0.4, 1.3, mix(t.primary, "FFFFFF", 0.5), S.tornRect(c.rand, W + 0.4, 1.3, 0.35, 0.3, { top: true }), { opacity: 0.7 });
    if (role !== "content") return { x: 0.8, y: 0.7, w: W - 1.6, h: H - 1.4 };
    // Kartu kertas tua bertepi perangko.
    const card = { x: 0.85, y: 0.6, w: W - 1.7, h: H - 1.2 };
    c.texture("kertas-tua", card, { dark: mix(t.text, "FFFFFF", 0.55), light: t.surface }, { mask: S.stampRect(card.w, card.h, 0.13) });
    c.stroke(card.x + (c.flip ? card.w - 2.0 : 0.3), card.y + card.h - 0.8, 1.6, 0.6, t.primary, S.spiral(1.6), 2.2, { opacity: 0.85 });
    const sp = (x: number, y: number, s: number) => c.poly(x, y, s, s, t.accent, S.sparkle());
    sp(c.flip ? card.x + 0.2 : card.x + card.w - 1.2, card.y + card.h - 1.3, 0.75); sp(c.flip ? card.x + 0.85 : card.x + card.w - 0.55, card.y + card.h - 0.75, 0.42);
    return { x: card.x + 0.75, y: card.y + 0.45, w: card.w - 1.5, h: card.h - 0.9 };
  },
  heading(c, a) {
    const title = c.title({ x: a.x, y: a.y, w: a.w, h: 1.2 }, 44, { color: c.t.text, align: "center" });
    return title ? title.y + c.linesHeight(title) + 0.25 : a.y + 1;
  },
  card(c, b) {
    const { t } = c;
    c.shape("roundRect", b.x, b.y, b.w, b.h, mix(t.surface, "FFFFFF", 0.5), { lineColor: t.accent, lineWidth: 1.5 });
    return { inner: { x: b.x + 0.25, y: b.y + 0.22, w: b.w - 0.5, h: b.h - 0.4 }, label: t.primary, text: t.text };
  },
  frame(c, b) { return S.wobbleRect(c.rand, b.w, b.h, Math.min(b.w, b.h) * 0.05, 7); },
  cover(c, closing) {
    const { t } = c;
    // Kartu buku catatan bergaris kotak dengan cincin spiral, klip kertas, ekor balon bicara.
    const card = { x: 0.9, y: 0.9, w: 7.6, h: 5.0 };
    c.poly(card.x + 0.9, card.y + card.h - 0.05, 0.9, 0.9, "D9A441", [[0, 0], [1, 0], [0.35, 1]]);
    c.poly(card.x - 0.12, card.y - 0.12, card.w + 0.24, card.h + 0.24, "D9A441", S.roundRect(card.w + 0.24, card.h + 0.24, 0.3));
    c.texture("kertas-kotak", card, { dark: mix(t.primary, "FFFFFF", 0.35), light: "FFFFFF" }, { mask: S.roundRect(card.w, card.h, 0.25) });
    for (let i = 0; i < 8; i++) c.shape("ellipse", card.x + 0.45 + i * 0.95, card.y - 0.32, 0.38, 0.5, "D9A441", { lineColor: mix("D9A441", "000000", 0.3), lineWidth: 1 });
    c.stroke(card.x + 1.4, card.y - 0.55, 0.45, 1.1, "8A9BA8", S.paperclip(), 2.2);
    c.stroke(card.x + card.w - 1.6, card.y - 0.55, 0.45, 1.1, "8A9BA8", S.paperclip(), 2.2);
    // Segel bundar dengan foto/ilustrasi di kanan.
    const seal = { x: 8.6, y: 1.6, w: 4.2, h: 4.2 };
    c.shape("ellipse", seal.x - 0.25, seal.y - 0.25, seal.w + 0.5, seal.h + 0.5, mix(t.primary, "000000", 0.15));
    c.shape("ellipse", seal.x - 0.12, seal.y - 0.12, seal.w + 0.24, seal.h + 0.24, "F4EBDD");
    c.photo(seal, "ellipse");
    const sp = (x: number, y: number, s: number) => c.poly(x, y, s, s, t.accent, S.sparkle());
    sp(card.x + card.w - 0.9, card.y + card.h - 0.4, 1.1); sp(card.x + card.w - 1.5, card.y + card.h + 0.35, 0.6);
    c.eyebrow({ x: card.x + 0.6, y: card.y + 0.55, w: card.w - 1.2, h: 0.5 }, 20, { color: t.primary, align: "center" });
    const title = c.title({ x: card.x + 0.45, y: card.y + (c.slide.eyebrow ? 1.1 : 0.8), w: card.w - 0.9, h: closing ? 2.6 : 2.7 }, closing ? 66 : 58, { color: t.text, align: "center" });
    const bottom = title ? title.y + c.linesHeight(title) + 0.2 : card.y + 3.6;
    c.body(0, { x: card.x + 0.6, y: bottom, w: card.w - 1.2, h: 0.6 }, 18, { color: t.primary, align: "center", bold: true });
    info(c).forEach((_, i) => c.body(i + 1, { x: 0.9, y: 6.2 + i * 0.32, w: 7.6, h: 0.32 }, 13, { color: "FFFFFF", align: "center", bold: i === 0 }));
  },
  section(c) {
    const { t } = c;
    const card = { x: 1.0, y: 1.2, w: 6.8, h: 4.8 };
    c.texture("kertas-tua", card, { dark: mix(t.text, "FFFFFF", 0.55), light: t.surface }, { mask: S.stampRect(card.w, card.h, 0.13) });
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: card.x + 0.6, y: card.y + 0.5, w: 3, h: 1.3 }, 72, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: t.accent, outline: { color: t.text, width: 1.5 } });
    c.title({ x: card.x + 0.6, y: card.y + 1.9, w: card.w - 1.2, h: 1.8 }, 44, { color: t.text });
    c.body(0, { x: card.x + 0.6, y: card.y + 3.7, w: card.w - 1.2, h: 0.9 }, 18, { color: t.text });
    c.photo({ x: 8.6, y: 1.7, w: 3.9, h: 3.9 }, "ellipse", { rim: "F4EBDD", rimWidth: 0.12 });
  },
  marker(c, x, y) { c.poly(x, y, 0.3, 0.3, c.t.accent, S.sparkle()); },
};

// --- 4. Korporat navy-oranye ------------------------------------------------------
const korporat: KitSpec = {
  page(c, role) {
    const { t } = c;
    // Grid titik 4x4 dan blok "daun" aksen di sudut.
    const dots = (x: number, y: number) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c.shape("ellipse", x + i * 0.17, y + j * 0.17, 0.07, 0.07, mix(t.text, t.bg, 0.1)); };
    if (role === "content") {
      dots(W - 1.25, 0.45);
      c.poly(c.flip ? -0.7 : W - 1.6, H - 1.5, 2.3, 2.3, t.accent, S.roundRect(2.3, 2.3, c.flip ? [0, 0, 0, 0] : [1.15, 0, 0, 0]));
      c.poly(c.flip ? W - 0.35 : -1.0, 2.2, 1.35, 2.2, t.accent, S.roundRect(1.35, 2.2, 0.35), { opacity: 0.95 });
    }
    return { x: 0.85, y: 0.6, w: W - 1.7, h: H - 1.2 };
  },
  heading(c, a) {
    const title = c.title({ x: a.x, y: a.y, w: a.w * 0.62, h: 1.6 }, 40, { color: c.t.text, accent: c.t.accentText, upper: true });
    return title ? title.y + c.linesHeight(title) + 0.3 : a.y + 1.2;
  },
  card(c, b) {
    const { t } = c;
    c.shape("polygon", b.x, b.y, b.w, b.h, "FFFFFF", { points: S.roundRect(b.w, b.h, 0.28) });
    // Lingkaran panah di sudut kanan bawah.
    const s = 0.62, x = b.x + b.w - s * 0.8, y = b.y + b.h - s * 0.8;
    c.shape("ellipse", x - 0.05, y - 0.05, s + 0.1, s + 0.1, t.bg);
    c.shape("ellipse", x, y, s, s, t.accent);
    c.stroke(x + s * 0.28, y + s * 0.28, s * 0.44, s * 0.44, t.bg, [[0.95, 0.95], [0.05, 0.05], [0.05, 0.6], [0.05, 0.05], [0.6, 0.05]], 2.4);
    return { inner: { x: b.x + 0.28, y: b.y + 0.25, w: b.w - 0.56, h: b.h - 0.75 }, label: t.bg, text: mix(t.bg, "FFFFFF", 0.15) };
  },
  frame(_c, b) { return S.roundRect(b.w, b.h, 0.4); },
  cover(c, closing) {
    const { t } = c;
    // Foto penuh di kanan dipotong diagonal, segitiga aksen di depannya.
    const px = 6.3;
    c.photo({ x: px, y: 0, w: W - px, h: H }, [[0.16, 0], [1, 0], [1, 1], [0, 1]]);
    c.poly(px - 0.4, H - 3.2, 3.2, 3.2, t.accent, [[0, 1], [1, 1], [0.15, 0]], { opacity: 0.95 });
    c.poly(W - 2.4, 0, 2.4, 3.0, t.accent, [[1, 0], [1, 1], [0, 0]], { opacity: 0.9 });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) c.shape("ellipse", 4.9 + i * 0.17, 5.55 + j * 0.17, 0.07, 0.07, mix(t.text, t.bg, 0.1));
    if (c.design.logo) c.els.push({ type: "image", fileId: c.design.logo, role: "cutout", alt: "Logo", x: 0.85, y: 0.6, w: 0.55, h: 0.55, crop: "contain" });
    if (c.design.institution) c.text(c.design.institution, { x: c.design.logo ? 1.5 : 0.85, y: 0.72, w: 4.8, h: 0.35 }, 13, { bold: true, color: t.text });
    c.eyebrow({ x: 0.85, y: 1.45, w: 5.3, h: 0.45 }, 16, { color: t.text, fontFace: t.body, bold: true });
    const title = c.title({ x: 0.85, y: 1.9, w: 5.4, h: closing ? 2.6 : 3.1 }, closing ? 66 : 54, { color: t.text, accent: t.accentText, upper: true });
    const bottom = title ? title.y + c.linesHeight(title) + 0.3 : 5;
    c.body(0, { x: 0.85, y: bottom, w: 5.2, h: 0.75 }, 16, { color: t.text });
    info(c).forEach((_, i) => c.body(i + 1, { x: 0.85, y: Math.min(bottom + 0.85 + i * 0.32, H - 0.7), w: 5.2, h: 0.32 }, 12, { color: t.text, bold: i === 0 }));
  },
  section(c) {
    const { t } = c;
    c.poly(-0.6, 0.9, 5.6, 5.7, t.accent, S.roundRect(5.6, 5.7, [0, 2.8, 0, 0]));
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 0.85, y: 2.2, w: 3.8, h: 2.0 }, 120, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: t.bg, lineHeight: 1 });
    c.title({ x: 5.8, y: 2.3, w: 6.6, h: 2.2 }, 48, { color: t.text, accent: t.accentText, upper: true });
    c.body(0, { x: 5.8, y: 4.6, w: 6.4, h: 1.2 }, 18, { color: t.text });
  },
  marker(c, x, y) { c.shape("ellipse", x + 0.03, y + 0.05, 0.22, 0.22, c.t.accent); },
};

// --- 5. Seminar minimal ----------------------------------------------------------
const seminar: KitSpec = {
  page(c, role) {
    const { t } = c;
    // Tab di tepi kiri-kanan, garis tipis atas, catatan kaki "JUDUL | 04".
    c.poly(-0.25, H / 2 - 0.9, 0.55, 1.8, t.primary, S.roundRect(0.55, 1.8, 0.27));
    c.poly(W - 0.3, H / 2 - 0.9, 0.55, 1.8, t.primary, S.roundRect(0.55, 1.8, 0.27));
    if (role === "content") {
      c.text(c.deckTitle.toUpperCase(), { x: W - 4.6, y: H - 0.6, w: 3.2, h: 0.3 }, 10, { fontFace: t.heading, bold: true, color: t.text, align: "right", spacing: 1 });
      c.line(W - 1.32, H - 0.62, 0, 0.32, t.text, 1);
      c.text(String(c.index + 1).padStart(2, "0"), { x: W - 1.22, y: H - 0.6, w: 0.6, h: 0.3 }, 11, { color: t.text, bold: true });
    }
    return { x: 0.9, y: 0.6, w: W - 1.8, h: H - 1.35 };
  },
  heading(c, a) {
    const { t } = c;
    // Kotak judul gelap di kanan atas, tersambung garis berujung bulatan ke isi.
    const title = c.title({ x: a.x + a.w - 5.6, y: a.y + 0.15, w: 5.2, h: 1.3 }, 30, { color: t.onPrimary, align: "right", upper: true });
    if (!title) return a.y + 1;
    const h = c.linesHeight(title) + 0.5, w = Math.min(a.w, c.measured(title) + 0.8);
    const box = c.shape("rect", a.x + a.w - w, title.y - 0.25, w, h, t.primary);
    c.behind(title, box);
    title.x = box.x + 0.4; title.w = w - 0.8;
    c.line(a.x + 0.3, box.y + h / 2, box.x - a.x - 0.3, 0, t.primary, 2.5);
    c.shape("ellipse", a.x + 0.1, box.y + h / 2 - 0.16, 0.32, 0.32, t.primary);
    return box.y + h + 0.3;
  },
  card(c, b, i, kind = "label") {
    const { t } = c;
    c.shape("rect", b.x, b.y, b.w, b.h, t.surface);
    if (kind === "plain") return { inner: { x: b.x + 0.25, y: b.y + 0.2, w: b.w - 0.5, h: b.h - 0.4 }, label: t.text, text: t.text };
    c.text(`${String(i + 1).padStart(2, "0")}.`, { x: b.x + 0.25, y: b.y + 0.2, w: 1.2, h: 0.6 }, 26, { fontFace: t.heading, bold: true, color: t.text });
    return { inner: { x: b.x + 0.25, y: b.y + 0.85, w: b.w - 0.5, h: b.h - 1.05 }, label: t.text, text: t.text };
  },
  frame(_c, b) { return S.roundRect(b.w, b.h, 0); },
  cover(c, closing) {
    const { t } = c;
    c.shape("rect", 0, 1.25, W, 4.0, t.surface);
    // Bingkai garis dengan bulatan di ujung.
    const fx = 7.0, fy = 0.75, fw = 4.9, fh = 4.75;
    c.line(fx, fy, fw, 0, t.primary, 3); c.line(fx + fw, fy, 0, fh, t.primary, 3); c.line(fx, fy + fh, fw, 0, t.primary, 3); c.line(fx, fy + fh - 0.45, 0, 0.45, t.primary, 3);
    c.shape("ellipse", fx - 0.2, fy + fh - 0.65, 0.4, 0.4, t.primary);
    if (c.design.logo) c.els.push({ type: "image", fileId: c.design.logo, role: "cutout", alt: "Logo", x: 0.85, y: 0.35, w: 0.6, h: 0.6, crop: "contain" });
    if (c.design.institution) c.text(c.design.institution.toUpperCase(), { x: c.design.logo ? 1.55 : 0.85, y: 0.48, w: 5, h: 0.4 }, 14, { fontFace: t.heading, bold: true, color: t.text });
    c.eyebrow({ x: 3.3, y: 1.7, w: 7.2, h: 0.5 }, 24, { align: "right", color: t.text });
    c.title({ x: 1.6, y: 2.3, w: 8.9, h: 2.6 }, closing ? 64 : 58, { color: t.text, align: "right", upper: true, spacing: 4 });
    c.body(0, { x: 3.0, y: 4.5, w: 7.5, h: 0.5 }, 16, { color: t.text, align: "right" });
    const rows = info(c);
    if (rows.length) {
      const bh = rows.length * 0.36 + 0.5;
      c.poly(-0.4, H - bh - 0.5, 6.4, bh, t.primary, S.roundRect(6.4, bh, [0, bh / 2, bh / 2, 0]));
      rows.forEach((_, i) => c.body(i + 1, { x: 0.85, y: H - bh - 0.25 + i * 0.36, w: 5, h: 0.36 }, 14, { color: t.onPrimary, bold: i === 0 }));
    }
  },
  section(c) {
    const { t } = c;
    c.shape("rect", 0, 0, W, H, t.primary);
    c.poly(-0.25, H / 2 - 0.9, 0.55, 1.8, t.surface, S.roundRect(0.55, 1.8, 0.27));
    c.poly(W - 0.3, H / 2 - 0.9, 0.55, 1.8, t.surface, S.roundRect(0.55, 1.8, 0.27));
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 1.4, y: 1.6, w: 3, h: 1.1 }, 54, { editKey: "eyebrow", fontFace: t.heading, bold: true, color: t.surface });
    c.title({ x: 1.4, y: 2.8, w: W - 2.8, h: 2.0 }, 50, { color: t.onPrimary, upper: true, spacing: 3 });
    c.body(0, { x: 1.4, y: 4.9, w: 8, h: 1.0 }, 18, { color: t.onPrimary });
  },
  marker(c, x, y) { c.shape("rect", x + 0.04, y + 0.06, 0.2, 0.2, c.t.primary); },
};

// --- 6. Penelitian modern -----------------------------------------------------------
const penelitian: KitSpec = {
  page(c, role) {
    const { t } = c;
    // Garis kontur bergelombang di kanan, garis tipis atas-bawah, kapsul merek dan kapsul gradien.
    const lines = role === "content" ? 9 : 14;
    for (let i = 0; i < lines; i++) c.stroke(W * 0.48, 0.9 + i * 0.36, W * 0.55, 2.4, mix(t.primary, t.bg, 0.78), S.wave(1.3, i * 0.32, 0.6), 0.9);
    c.line(0, 0.62, W - 3.0, 0, t.text, 1.2);
    c.line(1.8, H - 0.62, W - 1.8, 0, t.text, 1.2);
    c.shape("polygon", W - 2.9, 0.35, 3.2, 0.55, t.primary, { points: S.roundRect(3.2, 0.55, 0.27), gradient: { to: t.accent, angle: 0 } });
    if (c.design.institution) c.text(c.design.institution.toUpperCase(), { x: W - 2.6, y: 0.47, w: 2.4, h: 0.3 }, 11, { color: "FFFFFF", bold: true });
    c.shape("polygon", -0.4, H - 0.82, 2.4, 0.42, t.primary, { points: S.roundRect(2.4, 0.42, 0.21), gradient: { to: t.accent, angle: 0 } });
    return { x: 0.9, y: 0.95, w: W - 1.8, h: H - 1.85 };
  },
  heading(c, a) {
    const title = c.title({ x: a.x, y: a.y, w: a.w * 0.6, h: 1.6 }, 40, { color: c.t.primary, upper: true });
    return title ? title.y + c.linesHeight(title) + 0.3 : a.y + 1.2;
  },
  card(c, b, _i, kind = "label") {
    const { t } = c;
    if (kind === "plain" || b.h < 1.6) {
      c.shape("polygon", b.x, b.y, b.w, b.h, t.primary, { points: S.roundRect(b.w, b.h, Math.min(0.35, b.h / 2)), gradient: { to: t.accent, angle: 90 } });
      return { inner: { x: b.x + 0.3, y: b.y + 0.2, w: b.w - 0.6, h: b.h - 0.35 }, label: "FFFFFF", text: "FFFFFF" };
    }
    c.shape("polygon", b.x, b.y + 0.2, b.w, b.h - 0.2, t.primary, { points: S.roundRect(b.w, b.h - 0.2, 0.35), gradient: { to: t.accent, angle: 90 } });
    // Tab kapsul yang menumpang di tepi atas kartu; label poin ditulis di dalamnya.
    c.shape("polygon", b.x + 0.2, b.y, b.w - 0.4, 0.46, "FFFFFF", { points: S.roundRect(b.w - 0.4, 0.46, 0.23), lineColor: t.primary, lineWidth: 1.5 });
    return { inner: { x: b.x + 0.3, y: b.y + 0.06, w: b.w - 0.6, h: b.h - 0.3 }, label: t.primary, text: "FFFFFF" };
  },
  frame(_c, b) { return S.roundRect(b.w, b.h, 0.45); },
  cover(c, closing) {
    const { t } = c;
    if (c.art) c.els.push({ type: "image", ...c.art, editKey: "art", x: 5.5, y: 0.7, w: W - 5.5, h: H - 1.4, crop: "cover", opacity: 0.3 });
    c.eyebrow({ x: 0.9, y: 1.3, w: 8, h: 0.45 }, 16, { color: t.text, fontFace: t.body, bold: true });
    const title = c.title({ x: 0.9, y: 1.8, w: 9.5, h: closing ? 2.4 : 2.8 }, closing ? 70 : 64, { color: t.primary, upper: true });
    const bottom = title ? title.y + c.linesHeight(title) + 0.25 : 4.6;
    c.body(0, { x: 0.9, y: bottom, w: 9, h: 0.7 }, 18, { color: t.text, bold: true });
    const rows = info(c);
    if (rows.length) {
      c.shape("polygon", 0.6, H - 1.55, 6.2, 0.62, t.primary, { points: S.roundRect(6.2, 0.62, 0.31), gradient: { to: t.accent, angle: 0 } });
      c.body(1, { x: 0.95, y: H - 1.43, w: 5.6, h: 0.38 }, 15, { color: "FFFFFF", bold: true });
      rows.slice(1).forEach((_, i) => c.body(i + 2, { x: 7.1, y: H - 1.5 + i * 0.32, w: 4.5, h: 0.32 }, 12, { color: t.text }));
    }
  },
  section(c) {
    const { t } = c;
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 0.9, y: 1.3, w: 4, h: 1.6 }, 96, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: mix(t.primary, t.bg, 0.6) });
    c.title({ x: 0.9, y: 2.9, w: 8, h: 2 }, 54, { color: t.primary, upper: true });
    c.body(0, { x: 0.9, y: 4.95, w: 8, h: 1 }, 18, { color: t.text });
  },
  marker(c, x, y) { c.shape("polygon", x, y + 0.04, 0.3, 0.22, c.t.primary, { points: S.roundRect(0.3, 0.22, 0.11), gradient: { to: c.t.accent, angle: 0 } }); },
};

// --- 7. Geometris ---------------------------------------------------------------------
const BEIGE = "D9C3A0";
const geometris: KitSpec = {
  page(c, role) {
    const { t } = c;
    const steel = mix(t.accent, t.bg, 0.2);
    const sq = (x: number, y: number, s: number, fill: string, outline = false) => {
      c.rotatedPoly(x, y, s, s, 45, S.roundRect(s, s, s * 0.18), fill);
      if (outline) c.rotatedPoly(x + 0.25, y + 0.25, s, s, 45, S.roundRect(s, s, s * 0.18), t.bg, { opacity: 0, lineColor: mix(t.text, t.bg, 0.3), lineWidth: 1 });
    };
    const big = role !== "content";
    const f = c.flip;
    sq(f ? -2.0 : W - 2.6, -2.6, big ? 4.6 : 3.6, t.primary, true);
    sq(f ? W - 2.4 : -2.4, H - 2.0, big ? 4.2 : 3.3, steel, true);
    if (big) { sq(-2.5, -2.4, 4.0, steel); sq(W - 2.0, H - 2.4, 3.8, t.primary, true); }
    c.shape("ellipse", f ? W - 1.6 : -0.9, f ? 4.6 : 3.4, 2.0, 2.0, BEIGE);
    const dots = (x: number, y: number) => { for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) c.shape("ellipse", x + i * 0.17, y + j * 0.17, 0.06, 0.06, t.accent); };
    dots(f ? W - 1.9 : 1.0, f ? H - 1.1 : 0.45);
    // Chevron ">>>" kecil.
    for (let i = 0; i < 3; i++) c.stroke((f ? 0.8 : W - 2.2) + i * 0.24, f ? 0.6 : H - 0.95, 0.18, 0.32, t.accent, [[0, 0], [1, 0.5], [0, 1]], 2.2);
    return { x: 1.2, y: 0.55, w: W - 2.4, h: H - 1.1 };
  },
  heading(c, a) {
    const { t } = c;
    const title = c.title({ x: 2.6, y: a.y, w: W - 5.2, h: 1.2 }, 40, { color: t.primary, align: "center" });
    const y = title ? title.y + c.linesHeight(title) + 0.2 : a.y + 1;
    c.line(W / 2 - 2.3, y + 0.08, 1.7, 0, t.primary, 1.5); c.line(W / 2 + 0.6, y + 0.08, 1.7, 0, t.primary, 1.5);
    for (let i = 0; i < 3; i++) c.shape("ellipse", W / 2 - 0.36 + i * 0.26, y - 0.03, 0.2, 0.2, mix(t.primary, t.bg, 0.4));
    return y + 0.4;
  },
  card(c, b, i, kind = "label") {
    const { t } = c;
    if (kind === "plain") {
      c.shape("polygon", b.x, b.y, b.w, b.h, "FFFFFF", { points: S.roundRect(b.w, b.h, 0.2), lineColor: t.primary, lineWidth: 1.25 });
      return { inner: { x: b.x + 0.3, y: b.y + 0.22, w: b.w - 0.6, h: b.h - 0.4 }, label: t.primary, text: t.text };
    }
    c.shape("polygon", b.x, b.y + 0.3, b.w, b.h - 0.3, "FFFFFF", { points: S.roundRect(b.w, b.h - 0.3, 0.2), lineColor: t.primary, lineWidth: 1.25 });
    c.shape("ellipse", b.x + b.w / 2 - 0.32, b.y, 0.64, 0.64, t.primary);
    c.text(String(i + 1), { x: b.x + b.w / 2 - 0.32, y: b.y + 0.13, w: 0.64, h: 0.4 }, 18, { color: t.onPrimary, bold: true, align: "center", lineHeight: 1 });
    return { inner: { x: b.x + 0.3, y: b.y + 0.8, w: b.w - 0.6, h: b.h - 1.0 }, label: t.primary, text: t.text };
  },
  frame(_c, b) { return S.roundRect(b.w, b.h, 0.35); },
  cover(c, closing) {
    const { t } = c;
    c.eyebrow({ x: 2, y: 1.4, w: W - 4, h: 0.5 }, 20, { align: "center", color: t.accentText });
    const title = c.title({ x: 1.9, y: 1.95, w: W - 3.8, h: 2.7 }, closing ? 70 : 66, { color: t.primary, align: "center", accent: mix(t.accent, t.primary, 0.35) });
    const y = title ? title.y + c.linesHeight(title) + 0.25 : 4.6;
    c.line(W / 2 - 3.0, y + 0.08, 2.3, 0, t.primary, 1.8); c.line(W / 2 + 0.7, y + 0.08, 2.3, 0, t.primary, 1.8);
    for (let i = 0; i < 3; i++) c.shape("ellipse", W / 2 - 0.4 + i * 0.28, y - 0.04, 0.22, 0.22, mix(t.primary, t.bg, 0.35));
    c.body(0, { x: 2.5, y: y + 0.4, w: W - 5, h: 0.6 }, 22, { color: t.primary, align: "center", bold: true });
    info(c).forEach((_, i) => c.body(i + 1, { x: 3, y: y + 1.05 + i * 0.34, w: W - 6, h: 0.34 }, 15, { color: t.text, align: "center" }));
  },
  section(c) {
    const { t } = c;
    c.rotatedPoly(-1.5, 0.6, 6.2, 6.2, 45, S.roundRect(6.2, 6.2, 1.0), t.primary);
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 0.6, y: 2.8, w: 3.6, h: 1.6 }, 90, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: t.onPrimary, align: "center", lineHeight: 1 });
    c.title({ x: 6.2, y: 2.4, w: 6.2, h: 2.0 }, 48, { color: t.primary, accent: mix(t.accent, t.primary, 0.35) });
    c.body(0, { x: 6.2, y: 4.5, w: 6, h: 1.2 }, 18, { color: t.text });
  },
  marker(c, x, y) { c.rotatedPoly(x, y, 0.24, 0.24, 45, S.roundRect(0.24, 0.24, 0.05), c.t.primary); },
};

// --- 8. Cat air ------------------------------------------------------------------------
const catair: KitSpec = {
  page(c, role) {
    const { t } = c;
    const strong = role !== "content";
    if (strong) c.shape("rect", 0, 0, W, H, mix(t.primary, "FFFFFF", 0.45));
    const tint = (k: number) => ({ dark: mix(t.primary, "000000", (strong ? 0.25 : 0.05) + k * 0.05), light: mix(t.primary, "FFFFFF", strong ? 0.35 : 0.82) });
    c.texture("catair-1", { x: -3.0, y: -2.6, w: 10, h: 9 }, tint(0));
    c.texture("catair-2", { x: W - 7.5, y: -2.0, w: 10, h: 9 }, tint(1), { opacity: 0.9 });
    c.texture("catair-3", { x: 1.5, y: H - 4.2, w: 11, h: 7 }, tint(0), { opacity: 0.85 });
    // Coretan doodle: bintang laut, kilau, spiral, garis gelombang.
    const doodle = mix(t.primary, "FFFFFF", 0.7);
    c.stroke(c.flip ? W - 1.8 : 0.5, 0.4, 1.0, 1.0, doodle, S.star(5, 0.4), 2);
    c.stroke(c.flip ? 0.6 : W - 1.5, H - 1.4, 0.9, 0.9, doodle, S.spiral(1.8), 2);
    c.stroke(c.flip ? 1.6 : W - 3.4, 0.35, 1.6, 0.35, doodle, S.wave(2, 0, 0.8), 2);
    if (role !== "content") return { x: 1.0, y: 0.8, w: W - 2, h: H - 1.6 };
    const card = { x: 1.15, y: 0.75, w: W - 2.3, h: H - 1.5 };
    c.poly(card.x, card.y, card.w, card.h, t.surface, S.wobbleRect(c.rand, card.w, card.h, 0.12, 11), { opacity: 0.96 });
    return { x: card.x + 0.6, y: card.y + 0.4, w: card.w - 1.2, h: card.h - 0.75 };
  },
  heading(c, a) {
    const title = c.title({ x: a.x, y: a.y, w: a.w, h: 1.2 }, 50, { color: c.t.primary, align: "center" });
    return title ? title.y + c.linesHeight(title) + 0.2 : a.y + 1;
  },
  card(c, b) {
    const { t } = c;
    c.poly(b.x, b.y, b.w, b.h, mix(t.primary, "FFFFFF", 0.86), S.wobbleRect(c.rand, b.w, b.h, 0.06, 6));
    return { inner: { x: b.x + 0.25, y: b.y + 0.22, w: b.w - 0.5, h: b.h - 0.4 }, label: t.primary, text: t.text };
  },
  frame(c, b) { return S.wobbleRect(c.rand, b.w, b.h, Math.min(b.w, b.h) * 0.05, 8); },
  cover(c, closing) {
    const { t } = c;
    const ink = mix(t.primary, "000000", 0.35);
    c.eyebrow({ x: 2, y: 1.5, w: W - 4, h: 0.6 }, 26, { align: "center", color: "FFFFFF" });
    const title = c.title({ x: 1.2, y: 2.0, w: W - 2.4, h: 2.6 }, closing ? 92 : 88, { color: "FFFFFF", align: "center", outline: { color: ink, width: 2 }, shadow: { color: ink, dx: 0.04, dy: 0.05 } });
    const y = title ? title.y + c.linesHeight(title) + 0.2 : 4.6;
    c.body(0, { x: 2, y, w: W - 4, h: 0.7 }, 28, { color: "FFFFFF", align: "center", bold: true, fontFace: t.heading });
    info(c).forEach((_, i) => c.body(i + 1, { x: 3, y: y + 0.8 + i * 0.34, w: W - 6, h: 0.34 }, 15, { color: "FFFFFF", align: "center", bold: true }));
  },
  section(c) {
    const { t } = c;
    const ink = mix(t.primary, "000000", 0.35);
    c.text(c.slide.eyebrow || String(c.index + 1).padStart(2, "0"), { x: 1, y: 1.4, w: W - 2, h: 1.6 }, 96, { editKey: "eyebrow", fontFace: t.heading, bold: t.headingBold, color: "FFFFFF", align: "center", outline: { color: ink, width: 2 }, lineHeight: 1 });
    c.title({ x: 1.5, y: 3.1, w: W - 3, h: 1.8 }, 64, { color: "FFFFFF", align: "center", outline: { color: ink, width: 2 } });
    c.body(0, { x: 2.5, y: 5.0, w: W - 5, h: 1 }, 20, { color: ink, align: "center", bold: true });
  },
  marker(c, x, y) { c.poly(x, y, 0.3, 0.3, c.t.primary, S.star(5, 0.5)); },
};

export const KITS: Record<KitId, KitSpec> = { denim, kliping, vintage, korporat, seminar, penelitian, geometris, catair };

// ---------------------------------------------------------------------------
// Komposisi isi bersama (memakai kait kit)
// ---------------------------------------------------------------------------

interface CardSizes { label: number; text: number }

/** Ukuran label diperkecil bila kata terpanjang tidak muat satu baris (mencegah kata terpotong per huruf). */
function wordFitSize(text: string, width: number, size: number, font: PresentationFont, bold: boolean) {
  const longest = Math.max(0, ...text.split(/\s+/).map((word) => textWidth(word, size, font, bold)));
  return longest > width ? Math.max(11, Math.floor(size * width / longest)) : size;
}

/** Tinggi isi kartu (label + teks) pada lebar tertentu, untuk menyamakan tinggi kartu satu baris dengan isinya. */
function contentHeight(c: KitCtx, i: number, width: number, sizes: CardSizes) {
  const { label, text } = splitLabel(c.slide.body[i] ?? "");
  const t = c.t;
  const big = { x: 0, y: 0, w: width, h: 50 };
  const labelSize = label ? wordFitSize(label, width, sizes.label, t.heading, t.headingBold) : sizes.label;
  const labelH = label ? fitText(label, big, labelSize, t.heading, 1.05, 9, t.headingBold).lines.length * labelSize / 72 * 1.05 + 0.15 : 0;
  return labelH + fitText(text, big, sizes.text, t.body, 1.25).lines.length * sizes.text / 72 * 1.25;
}

/** Kartu kit berisi label (huruf judul) dan teks poin; label "Label: isi" dipisah agar terbaca sebagai judul kecil. */
function cardLabelText(c: KitCtx, kit: KitSpec, b: Bounds, i: number, sizes: CardSizes, align: Align = "left", kind: "label" | "plain" = "label") {
  const style = kit.card(c, b, i, kind);
  const { label } = splitLabel(c.slide.body[i] ?? "");
  const t = c.t;
  let y = style.inner.y;
  if (label) {
    const size = wordFitSize(label, style.inner.w, sizes.label, t.heading, t.headingBold);
    const element = c.text(label, { x: style.inner.x, y, w: style.inner.w, h: 1.0 }, size, { fontFace: t.heading, bold: t.headingBold, color: style.label, align, lineHeight: 1.05 });
    y += element ? c.linesHeight(element) + 0.15 : 0.6;
  }
  c.bodyContent(i, { x: style.inner.x, y, w: style.inner.w, h: style.inner.y + style.inner.h - y }, sizes.text, { color: style.text, align });
}

/** Satu baris kartu dengan tinggi mengikuti isi terpanjang (tidak lagi kartu tinggi kosong), dipusatkan di ruang tersisa. */
function cardRow(c: KitCtx, kit: KitSpec, items: number[], area: Bounds, top: number, sizes: CardSizes, options: { align?: Align; kind?: "label" | "plain"; pad?: number; bottom?: number } = {}) {
  const gap = 0.35, n = Math.max(items.length, 1);
  const w = (area.w - gap * (n - 1)) / n;
  const pad = options.pad ?? 1.0;
  const room = (options.bottom ?? area.y + area.h) - top;
  const need = Math.max(...items.map((i) => contentHeight(c, i, w - 0.6, sizes))) + pad;
  const h = Math.min(room, Math.max(need, Math.min(room, 1.9)));
  const y = top + Math.max(0, (room - h) * 0.35);
  items.forEach((i, k) => cardLabelText(c, kit, { x: area.x + k * (w + gap), y, w, h }, i, sizes, options.align, options.kind));
  return y + h;
}

export function layoutKitSlide(slide: PresentationSlide, design: DeckDesign, index = 0, total = 1, deckTitle = ""): SlideScene {
  const kit = KITS[design.kit!];
  const t = tokens(design);
  const c = new KitCtx(t, slide, design, index, total, deckTitle);
  const layout = ({ title: "cover", split: "bullets", timeline: "process", statement: "quote" } as Record<string, PresentationSlide["layout"]>)[slide.layout] ?? slide.layout;
  const role: Role = layout === "cover" ? "cover" : layout === "closing" ? "closing" : layout === "section" ? "section" : "content";
  const issues = inspectSlide(slide);
  const area = kit.page(c, role);

  if (art(slide) === "background" && role === "content") {
    // Gambar latar pengguna/AI: tampil samar di belakang isi.
    c.els.push({ type: "image", ...slide.art!, editKey: "art", x: 0, y: 0, w: W, h: H, crop: "cover", opacity: 0.18 });
    c.els.unshift(c.els.pop()!);
  }

  switch (layout) {
    case "cover": kit.cover(c, false); break;
    case "closing": kit.cover(c, true); break;
    case "section": kit.section(c); break;
    case "agenda": {
      const top = kit.heading(c, area);
      const count = Math.max(slide.body.length, 1);
      const gap = 0.22, rowH = Math.min(1.05, (area.y + area.h - top - gap * (count - 1)) / count);
      slide.body.forEach((_, i) => {
        const b = { x: area.x + 0.6, y: top + i * (rowH + gap), w: area.w - 1.2, h: rowH };
        const style = kit.card(c, b, i, "plain");
        c.text(String(i + 1).padStart(2, "0"), { x: style.inner.x, y: b.y + (rowH - 0.5) / 2, w: 0.9, h: 0.55 }, 26, { fontFace: t.heading, bold: t.headingBold, color: style.label, lineHeight: 1 });
        c.body(i, { x: style.inner.x + 1.0, y: b.y + (rowH - 0.5) / 2, w: style.inner.w - 1.0, h: Math.max(0.5, rowH - 0.2) }, 20, { color: style.text });
      });
      break;
    }
    case "bullets": {
      const top = kit.heading(c, area);
      const withPhoto = !!slide.art && slide.art.role !== "background";
      const textW = withPhoto ? area.w * 0.56 : area.w;
      const count = Math.max(slide.body.length, 1);
      const step = (area.y + area.h - top) / count;
      slide.body.forEach((_, i) => {
        const y = top + i * step;
        kit.marker(c, area.x, y + 0.06, i);
        c.body(i, { x: area.x + 0.55, y, w: textW - 0.55, h: step - 0.1 }, 21, { color: t.text });
      });
      if (withPhoto) {
        const b = { x: area.x + area.w * 0.6, y: top - 0.1, w: area.w * 0.4, h: Math.min(area.y + area.h - top + 0.1, area.w * 0.4 * 1.05) };
        c.photo(b, kit.frame(c, b));
      }
      break;
    }
    case "cards":
    case "compare": {
      const top = kit.heading(c, area);
      const count = Math.min(Math.max(slide.body.length, 1), 4);
      const items = Array.from({ length: count }, (_, i) => i);
      if (layout === "compare" && count > 2) {
        const mid = top + (area.y + area.h - top) / 2;
        cardRow(c, kit, items.slice(0, 2), area, top, { label: 20, text: 16 }, { bottom: mid - 0.15 });
        cardRow(c, kit, items.slice(2), area, mid + 0.15, { label: 20, text: 16 });
      } else {
        cardRow(c, kit, items, area, top, count > 3 ? { label: 20, text: 16 } : count === 3 ? { label: 23, text: 18 } : { label: 26, text: 20 });
      }
      break;
    }
    case "stats": {
      const top = kit.heading(c, area);
      const count = Math.max(slide.body.length, 1);
      const gap = 0.35, cw = (area.w - gap * (count - 1)) / count, ch = area.y + area.h - top;
      const need = Math.max(...slide.body.map((_, i) => contentHeight(c, i, cw - 0.6, { label: 0.1, text: 18 }))) + 2.0;
      const h = Math.min(ch, Math.max(need, Math.min(ch, 2.6)));
      const y0 = top + Math.max(0, (ch - h) * 0.35);
      slide.body.forEach((value, i) => {
        const b = { x: area.x + i * (cw + gap), y: y0, w: cw, h };
        const style = kit.card(c, b, i, "plain");
        const { label } = splitLabel(value);
        c.text(label || String(i + 1).padStart(2, "0"), { x: style.inner.x, y: style.inner.y + 0.05, w: style.inner.w, h: 1.25 }, 56, { fontFace: t.heading, bold: t.headingBold, color: style.label, lineHeight: 1, align: "center" });
        c.bodyContent(i, { x: style.inner.x, y: style.inner.y + 1.35, w: style.inner.w, h: style.inner.h - 1.35 }, 18, { color: style.text, align: "center" });
      });
      break;
    }
    case "process": {
      const top = kit.heading(c, area);
      const count = Math.max(slide.body.length, 1);
      const stepW = area.w / count, node = 0.8, nodeY = top + node / 2 + 0.05;
      if (count > 1) c.line(area.x + stepW / 2, nodeY, stepW * (count - 1), 0, t.accentText, 3, { dash: "dash" });
      // Pada latar gelap yang sewarna warna utama, lingkaran memakai warna permukaan agar tetap terlihat.
      const nodeFill = contrast(t.primary, t.bg) < 1.6 ? t.surface : t.primary;
      slide.body.forEach((_, i) => {
        const cx = area.x + stepW * (i + 0.5);
        const fill = i % 2 ? t.accent : nodeFill;
        c.shape("ellipse", cx - node / 2, nodeY - node / 2, node, node, fill, { lineColor: t.bg, lineWidth: 3 });
        c.text(String(i + 1), { x: cx - node / 2, y: nodeY - 0.21, w: node, h: 0.5 }, 22, { fontFace: t.heading, bold: t.headingBold, color: readableOn(fill, t.text), align: "center", lineHeight: 1 });
      });
      cardRow(c, kit, slide.body.map((_, i) => i), { ...area, x: area.x + 0.12, w: area.w - 0.24 }, nodeY + node / 2 + 0.3, count > 3 ? { label: 18, text: 15 } : { label: 21, text: 17 }, { align: "center", kind: "plain", pad: 0.8 });
      break;
    }
    case "quote": {
      const b = { x: area.x + 0.8, y: area.y + 0.6, w: area.w - 1.6, h: area.h - 1.8 };
      c.text("“", { x: b.x - 0.2, y: b.y - 0.7, w: 1.4, h: 1.6 }, 130, { fontFace: t.heading, bold: true, color: t.accentText, lineHeight: 1 });
      const quote = c.title({ x: b.x + 0.4, y: b.y + 0.4, w: b.w - 0.4, h: b.h - 0.6 }, 40, { color: t.text, align: "center" });
      const after = quote ? quote.y + c.linesHeight(quote) + 0.35 : b.y + b.h;
      c.body(0, { x: b.x, y: after, w: b.w, h: 0.5 }, 16, { color: t.muted, bold: true, align: "center" });
      break;
    }
    case "photo": {
      const pb = { x: area.x, y: area.y + 0.1, w: area.w * 0.46, h: area.h - 0.2 };
      c.photo(pb, kit.frame(c, pb));
      const tx = area.x + area.w * 0.52, tw = area.w * 0.48;
      const title = c.title({ x: tx, y: area.y + 0.3, w: tw, h: 2.0 }, 40, { color: t.text });
      const y = title ? title.y + c.linesHeight(title) + 0.3 : area.y + 2.4;
      const count = Math.max(slide.body.length, 1);
      const step = (area.y + area.h - y) / count;
      slide.body.forEach((_, i) => c.body(i, { x: tx, y: y + i * step, w: tw, h: step - 0.1 }, 17, { color: i ? t.muted : t.text }));
      break;
    }
    case "figure": {
      const top = kit.heading(c, area);
      const card = { x: area.x, y: top, w: area.w * 0.64, h: area.y + area.h - top - 0.5 };
      c.shape("roundRect", card.x, card.y, card.w, card.h, "FFFFFF", { lineColor: mix(t.text, "FFFFFF", 0.75), lineWidth: 0.75 });
      const inner = { x: card.x + 0.15, y: card.y + 0.15, w: card.w - 0.3, h: card.h - 0.3 };
      if (slide.art) c.els.push({ type: "image", ...slide.art, editKey: "art", ...inner, crop: "contain" });
      else c.text("Gambar dari laporan akan tampil di sini.", { x: inner.x, y: inner.y + inner.h / 2 - 0.2, w: inner.w, h: 0.4 }, 14, { color: "6B6B6B", align: "center" });
      c.body(0, { x: card.x, y: card.y + card.h + 0.08, w: card.w, h: 0.42 }, 12, { color: t.muted, align: "center" });
      slide.body.slice(1).forEach((_, i) => cardLabelText(c, kit, { x: area.x + area.w * 0.68, y: top + i * 1.75, w: area.w * 0.32, h: 1.55 }, i + 1, { label: 17, text: 15 }));
      break;
    }
    default: {
      const top = kit.heading(c, area);
      slide.body.forEach((_, i) => c.body(i, { x: area.x, y: top + i * 0.9, w: area.w, h: 0.8 }, 18, { color: t.text }));
    }
  }

  // Penyesuaian manual pengguna (geser/ubah ukuran) dan pemeriksaan teks terlalu kecil.
  for (const element of c.els) {
    const adjustment = element.editKey && slide.adjustments?.find((item) => item.target === element.editKey);
    if (adjustment) {
      const { x, y, w, h } = adjustment;
      Object.assign(element, { x, y, w, h });
      if (element.type === "text") Object.assign(element, fitText(element.text, element, c.sizes.get(element) ?? element.fontSize, element.fontFace, element.lineHeight, 0.5, element.bold, element.spacing ?? 0));
    }
    if (element.type === "text" && element.editKey && element.fontSize < 14 && (c.sizes.get(element) ?? 0) >= 18 && !issues.some((issue) => issue.code === "small-text")) {
      issues.push({ slideId: slide.id, code: "small-text", severity: "warning", message: "Teks diperkecil agar muat. Ringkas isi atau perbesar kotaknya agar nyaman dibaca." });
    }
  }
  return { width: W, height: H, background: t.bg, elements: c.els, issues };
}

function art(slide: PresentationSlide) { return slide.art?.role; }

/** Template yang ditawarkan ke pengguna dan AI: kit + warna + font bawaan (warna bisa diganti). */
export const KIT_TEMPLATES: readonly { id: string; kit: KitId; label: string; description: string; group: "rapi" | "estetik"; design: Omit<DeckDesign, "seed" | "institution" | "logo"> }[] = [
  { id: "scrapbook-denim", kit: "denim", group: "estetik", label: "Scrapbook Denim", description: "Potongan kain denim, kotak-kotak cat air, kancing, bintang, bingkai jahitan. Cocok tugas kelompok dan kelas.", design: { kit: "denim", primary: "2F4F8F", accent: "8FB3E6", background: "F8F6F1", surface: "FFFFFF", text: "1E3460", frame: "halftone", fonts: "ceria" } },
  { id: "kliping-kertas", kit: "kliping", group: "estetik", label: "Kliping Kertas", description: "Kertas kusut sobek, glitter, potongan koran, kertas kotak, kupu-kupu, judul huruf tempel.", design: { kit: "kliping", primary: "C76B80", accent: "EBA9B8", background: "F3E7E1", surface: "FBF6EF", text: "8A2E45", frame: "halftone", fonts: "kertas" } },
  { id: "kertas-vintage", kit: "vintage", group: "estetik", label: "Kertas Vintage", description: "Kertas biru kusut, buku catatan berspiral, klip kertas, kilau emas, kartu tepi perangko.", design: { kit: "vintage", primary: "2E6E8E", accent: "E3B04B", background: "DDE7EC", surface: "FBFAF5", text: "1D4B63", frame: "wave", fonts: "vintage" } },
  { id: "cat-air", kit: "catair", group: "estetik", label: "Cat Air", description: "Latar cat air lembut, coretan doodle, kartu bertepi bergelombang, judul tulisan tangan.", design: { kit: "catair", primary: "5B7FD1", accent: "A9C4F2", background: "EEF2FB", surface: "FFFFFF", text: "2C4A8F", frame: "blob", fonts: "tulisan" } },
  { id: "korporat-navy", kit: "korporat", group: "rapi", label: "Korporat Navy", description: "Navy dan oranye, foto dipotong diagonal, grid titik, kartu putih dengan lingkaran panah, judul dua warna.", design: { kit: "korporat", primary: "0E2A5C", accent: "F7A41D", background: "0E2A5C", surface: "FFFFFF", text: "FFFFFF", frame: "diagonal", fonts: "modern" } },
  { id: "seminar-minimal", kit: "seminar", group: "rapi", label: "Seminar Minimal", description: "Putih dan biru muda, huruf kapital klasik, bingkai garis berujung bulatan, tab di tepi. Cocok sidang dan seminar.", design: { kit: "seminar", primary: "27384F", accent: "BFD9EF", background: "FFFFFF", surface: "E3F0FA", text: "27384F", frame: "minimal", fonts: "formal" } },
  { id: "penelitian-modern", kit: "penelitian", group: "rapi", label: "Penelitian Modern", description: "Abu terang, garis kontur bergelombang, kapsul gradien biru, kartu dengan tab kapsul.", design: { kit: "penelitian", primary: "123E8C", accent: "2F6FD6", background: "F3F4F6", surface: "FFFFFF", text: "123E8C", frame: "grid", fonts: "modern" } },
  { id: "geometris-biru", kit: "geometris", group: "rapi", label: "Geometris Biru", description: "Persegi membulat miring di sudut, lingkaran krem, grid titik, judul tengah dua warna.", design: { kit: "geometris", primary: "17375E", accent: "7E9CC0", background: "F4F4F4", surface: "FFFFFF", text: "17375E", frame: "geometric", fonts: "bulat" } },
];
