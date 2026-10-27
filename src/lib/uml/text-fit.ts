/**
 * src/lib/uml/text-fit.ts
 * -----------------------------------------------------------------------------
 * Auto-fit label node diagram: pilih font TERBESAR yang masih muat di dalam
 * bentuknya (kotak, oval, belah ketupat), lalu wrap ulang teks untuk ukuran itu.
 *
 * Prinsip:
 *   - Ukuran & posisi node TIDAK diubah → layout/edge tetap, tidak ada tabrakan.
 *   - Teks dijamin di dalam bentuk: lebar baris diukur per karakter, dan lebar
 *     tersedia dihitung dari geometri bentuk:
 *       oval        : (x/a)² + (y/b)² ≤ 1   → lebar menyempit di atas/bawah
 *       belah ketupat: |x|/a + |y|/b ≤ 1    → lebar menyempit linear
 *   - Tabel lebar glyph memakai metrik DejaVu Sans (font rasterisasi DOCX di
 *     server, paling lebar di antara font yang dipakai) → teks yang muat di PNG
 *     laporan pasti juga muat di editor (Inter/Segoe lebih sempit).
 *   - Deterministik & tanpa DOM → hasil editor (Node.tsx) = hasil ekspor SVG/DOCX
 *     (render-svg.ts, juga dipakai server).
 * -----------------------------------------------------------------------------
 */
import {
  FIT_MAX_FONT,
  FIT_MIN_FONT,
  LANE_TITLE_FONT,
  LANE_TITLE_MIN_FONT,
  LIFELINE_HEADER_HEIGHT,
  LIFELINE_MAX_FONT,
  OUTSIDE_FONT,
  OUTSIDE_LABEL_GAP,
  OUTSIDE_LINE_HEIGHT,
  UNIFORM_FLOOR,
} from "./theme";

// Re-export agar import lama (`@/lib/uml/text-fit`) tetap berfungsi.
export { FIT_MAX_FONT, FIT_MIN_FONT, LIFELINE_HEADER_HEIGHT };

const FONT_STEP = 0.5;
export const LINE_HEIGHT_RATIO = 1.2;
const MAX_LINES = 6;
/** Faktor aman pengukuran (pembulatan hinting / kerning). */
const MEASURE_SAFETY = 1.03;
/** DejaVu Sans Bold ±10% lebih lebar dari Regular. */
const BOLD_FACTOR = 1.1;

/** Lebar advance DejaVu Sans (satuan em) untuk huruf/angka umum. */
const GLYPH_EM: Record<string, number> = {
  a: 0.613, b: 0.635, c: 0.55, d: 0.635, e: 0.615, f: 0.352, g: 0.635, h: 0.634, i: 0.278, j: 0.278,
  k: 0.579, l: 0.278, m: 0.974, n: 0.634, o: 0.612, p: 0.635, q: 0.635, r: 0.411, s: 0.521, t: 0.392,
  u: 0.634, v: 0.592, w: 0.818, x: 0.592, y: 0.592, z: 0.525,
  A: 0.684, B: 0.686, C: 0.698, D: 0.77, E: 0.632, F: 0.575, G: 0.775, H: 0.752, I: 0.295, J: 0.295,
  K: 0.656, L: 0.557, M: 0.863, N: 0.748, O: 0.787, P: 0.603, Q: 0.787, R: 0.695, S: 0.635, T: 0.611,
  U: 0.732, V: 0.684, W: 0.989, X: 0.685, Y: 0.611, Z: 0.685,
  " ": 0.318, ".": 0.318, ",": 0.318, ":": 0.337, ";": 0.337, "'": 0.275, "\"": 0.46, "!": 0.4,
  "?": 0.531, "-": 0.361, "/": 0.337, "\\": 0.337, "(": 0.39, ")": 0.39, "[": 0.39, "]": 0.39,
  "&": 0.78, "%": 0.95, "@": 1.0, "+": 0.838, "=": 0.838, "_": 0.5, "…": 1.0,
};

function charEm(ch: string): number {
  const known = GLYPH_EM[ch];
  if (known !== undefined) return known;
  if (/[0-9]/.test(ch)) return 0.636;
  return 0.7;
}

/** Lebar teks (px) pada `fontSize`; `bold` untuk weight ≥ 600 (dirender Bold). */
export function measureText(text: string, fontSize: number, bold = false): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * fontSize * MEASURE_SAFETY * (bold ? BOLD_FACTOR : 1);
}

/**
 * Wrap greedy per kata dengan lebar maksimum (px).
 * `breakWords=false` → return null kalau ada kata yang lebih lebar dari maxWidth
 * (tanda font perlu diperkecil). `true` → kata dipotong per karakter.
 */
export function wrapToWidth(text: string, maxWidth: number, fontSize: number, breakWords: boolean, bold = false): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureText(candidate, fontSize, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (measureText(word, fontSize, bold) <= maxWidth) {
      line = word;
      continue;
    }
    if (!breakWords) return null;
    // Kata sangat panjang (mis. URL): potong per karakter.
    let chunk = "";
    for (const ch of word) {
      if (measureText(chunk + ch, fontSize, bold) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export type FitShape = "rect" | "ellipse" | "diamond";

export interface FitBox {
  shape: FitShape;
  width: number;
  height: number;
  /** Jarak aman dari garis (px). */
  padX: number;
  padY: number;
  /** Label dirender tebal (lifeline). */
  bold?: boolean;
}

/** Lebar horizontal yang tersedia untuk blok teks setinggi `blockH` di tengah bentuk. */
export function availableWidth(box: FitBox, blockH: number): number {
  const a = box.width / 2 - box.padX;
  const b = box.height / 2 - box.padY;
  const hh = blockH / 2;
  if (a <= 0 || b <= 0 || hh > b) return 0;
  switch (box.shape) {
    case "ellipse":
      return 2 * a * Math.sqrt(1 - (hh / b) ** 2);
    case "diamond":
      return 2 * a * (1 - hh / b);
    default:
      return 2 * a;
  }
}

export interface FittedText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
}

/** Baris hasil wrap bila `clean` muat di `box` pada font `fs`; null bila tidak muat. */
function tryFit(clean: string, box: FitBox, fs: number): string[] | null {
  const lh = fs * LINE_HEIGHT_RATIO;
  // Coba jumlah baris 1..N: makin banyak baris, lebar tersedia (oval/ketupat) makin sempit.
  for (let n = 1; n <= MAX_LINES; n++) {
    const avail = availableWidth(box, n * lh);
    if (avail <= 0) break;
    const lines = wrapToWidth(clean, avail, fs, false, Boolean(box.bold));
    if (lines && lines.length <= n) return lines;
  }
  return null;
}

/** Apakah teks muat utuh (tanpa memotong kata) di dalam `box` pada font `fs`. */
export function fitsAtFont(text: string, box: FitBox, fs: number): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  return !clean || tryFit(clean, box, fs) !== null;
}

/** Cari font terbesar (FIT_MIN..max) yang membuat teks muat di dalam bentuk. */
export function fitText(text: string, box: FitBox, maxFont = FIT_MAX_FONT): FittedText {
  const clean = text.replace(/\s+/g, " ").trim();
  const bold = Boolean(box.bold);
  if (!clean) return { lines: [], fontSize: maxFont, lineHeight: maxFont * LINE_HEIGHT_RATIO };

  for (let fs = maxFont; fs >= FIT_MIN_FONT; fs -= FONT_STEP) {
    const lines = tryFit(clean, box, fs);
    if (lines) return { lines, fontSize: fs, lineHeight: fs * LINE_HEIGHT_RATIO };
  }

  // Fallback (teks sangat panjang untuk bentuknya): font minimum, potong kata,
  // dan pangkas baris terakhir dengan elipsis supaya tetap di dalam garis.
  const fs = FIT_MIN_FONT;
  const lh = fs * LINE_HEIGHT_RATIO;
  const innerH = box.height - 2 * box.padY;
  const maxLines = Math.max(1, Math.min(MAX_LINES, Math.floor(innerH / lh)));
  const avail = Math.max(availableWidth(box, maxLines * lh), (box.width - 2 * box.padX) * 0.5, fs * 2);
  const wrapped = wrapToWidth(clean, avail, fs, true, bold) ?? [clean];
  if (wrapped.length <= maxLines) return { lines: wrapped, fontSize: fs, lineHeight: lh };
  const kept = wrapped.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && measureText(last, fs, bold) > avail) last = `${last.slice(0, -2)}…`;
  kept[maxLines - 1] = last;
  return { lines: kept, fontSize: fs, lineHeight: lh };
}

// ---------------------------------------------------------------------------
// Layout label per tipe node (dipakai Node.tsx, render-svg.ts, node-size.ts)
// ---------------------------------------------------------------------------

interface NodeLike {
  type: string;
  text: string;
  lines?: string[];
  width: number;
  height: number;
}

export interface NodeTextLayout {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** Koordinat y baris pertama (absolut). */
  firstLineY: number;
  baseline: "middle" | "hanging";
  fontWeight: number;
}

/**
 * Kotak area teks untuk tipe node (null = label di luar bentuk).
 * Diekspor agar node-size.ts menghitung ukuran node dengan aturan yang sama.
 */
export function fitBoxFor(type: string, width: number, height: number): FitBox | null {
  switch (type) {
    case "start":
    case "end":
    case "usecase":
      return { shape: "ellipse", width, height, padX: 6, padY: 4 };
    case "decision":
      return { shape: "diamond", width, height, padX: 4, padY: 3 };
    case "activity":
      // Sudut membulat rx=20 → beri ruang horizontal lebih.
      return { shape: "rect", width, height, padX: 12, padY: 5 };
    case "lifeline":
      return { shape: "rect", width, height: LIFELINE_HEADER_HEIGHT, padX: 8, padY: 4, bold: true };
    case "actor":
    case "fork":
    case "join":
      return null;
    default:
      return { shape: "rect", width, height, padX: 9, padY: 5 };
  }
}

/** Plafon font per tipe (lifeline sedikit lebih kecil karena tebal). */
export function maxFontFor(type: string): number {
  return type === "lifeline" ? LIFELINE_MAX_FONT : FIT_MAX_FONT;
}

/**
 * Hitung baris, ukuran font, dan posisi label node.
 * `x`, `y` = pojok kiri atas node (sudah termasuk offset drag).
 * `maxFont` = plafon font seragam diagram (lihat diagramFontCap).
 */
export function layoutNodeText(node: NodeLike, x: number, y: number, maxFont = FIT_MAX_FONT): NodeTextLayout {
  const label = (node.text || node.lines?.join(" ") || "").trim();
  const box = fitBoxFor(node.type, node.width, node.height);

  if (!box) {
    // Label di bawah bentuk (actor / fork / join): wrap biasa, tidak dibatasi bentuk.
    const lines = node.lines?.length ? node.lines : label ? [label] : [];
    return {
      lines,
      fontSize: OUTSIDE_FONT,
      lineHeight: OUTSIDE_LINE_HEIGHT,
      firstLineY: y + node.height + OUTSIDE_LABEL_GAP,
      baseline: node.type === "actor" ? "hanging" : "middle",
      fontWeight: node.type === "actor" ? 600 : 500,
    };
  }

  const fitted = fitText(label, box, Math.min(maxFont, maxFontFor(node.type)));
  const blockOffset = ((fitted.lines.length - 1) * fitted.lineHeight) / 2;
  const centerY = node.type === "lifeline" ? y + LIFELINE_HEADER_HEIGHT / 2 : y + node.height / 2;
  return {
    lines: fitted.lines,
    fontSize: fitted.fontSize,
    lineHeight: fitted.lineHeight,
    firstLineY: centerY - blockOffset,
    baseline: "middle",
    fontWeight: node.type === "lifeline" ? 600 : 500,
  };
}

/**
 * Plafon font SERAGAM untuk satu diagram: font hasil fit terkecil di antara
 * node-node berlabel di dalam bentuk, tapi tidak lebih kecil dari UNIFORM_FLOOR.
 * Node yang butuh lebih kecil dari floor tetap mengecil sendiri (tidak menyeret
 * seluruh diagram jadi mini). Hasil: teks besar, padat, dan konsisten.
 */
export function diagramFontCap(nodes: NodeLike[]): number {
  let cap = FIT_MAX_FONT;
  for (const node of nodes) {
    const box = fitBoxFor(node.type, node.width, node.height);
    if (!box) continue;
    const label = (node.text || node.lines?.join(" ") || "").trim();
    if (!label) continue;
    const { fontSize } = fitText(label, box, maxFontFor(node.type));
    cap = Math.min(cap, Math.max(fontSize, UNIFORM_FLOOR));
  }
  return cap;
}

// ---------------------------------------------------------------------------
// Label bebas (edge, judul lane)
// ---------------------------------------------------------------------------

/** Wrap label bebas ke lebar `maxWidth` (kata panjang dipotong, tidak pernah dibuang). */
export function wrapLabel(text: string, maxWidth: number, fontSize: number, bold = false): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  return wrapToWidth(clean, Math.max(maxWidth, fontSize), fontSize, true, bold) ?? [clean];
}

/** Font judul lane: LANE_TITLE_FONT, mengecil bila nama lane lebih lebar dari lane. */
export function laneTitleFont(name: string, laneWidth: number): number {
  const avail = laneWidth - 16;
  for (let fs = LANE_TITLE_FONT; fs > LANE_TITLE_MIN_FONT; fs -= FONT_STEP) {
    if (measureText(name, fs, true) <= avail) return fs;
  }
  return LANE_TITLE_MIN_FONT;
}
