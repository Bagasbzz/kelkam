/**
 * src/lib/uml/node-size.ts
 * -----------------------------------------------------------------------------
 * Ukuran node yang DIJAMIN memuat labelnya pada font target (theme.ts).
 *
 * Kenapa: auto-fit (text-fit.ts) memilih font terbesar yang muat di dalam
 * bentuk; kalau node dibuat terlalu kecil, font ikut mengecil dan tidak
 * terbaca di laporan Word. Maka ukuran node dicari dengan aturan yang SAMA
 * dengan auto-fit (fitBoxFor + fitsAtFont), bukan perkiraan jumlah karakter.
 *
 * Strategi per bentuk:
 *   - kotak (process/activity/system): jumlah baris sesedikit mungkin dalam
 *     lebar maksimum (tinggi diagram adalah batas utama di halaman A4), lalu
 *     lebar terkecil untuk jumlah baris itu.
 *   - oval & belah ketupat: grid search luas minimum dengan rasio tinggi/lebar
 *     dibatasi supaya bentuk tetap pipih.
 * -----------------------------------------------------------------------------
 */
import {
  LIFELINE_MIN_WIDTH,
  LIFELINE_TARGET_FONT,
  NODE_MAX_WIDTH,
  NODE_MIN,
  NODE_SLACK,
  NODE_TARGET_FONT,
  UNIFORM_FLOOR,
  USECASE_MAX_WIDTH,
} from "./theme";
import { fitBoxFor, fitsAtFont } from "./text-fit";

export interface NodeSize {
  width: number;
  height: number;
}

const STEP = 4;
const MAX_HEIGHT = 200;

/**
 * 18 karakter/baris → label umum ("Selesai - Peminjaman Ditolak") jadi 2 baris.
 * Hanya untuk field `lines` (data lama); tampilan memakai auto-fit.
 */
export const TERMINATOR_CHARS_PER_LINE = 18;
const MAX_TERMINATOR_LINES = 3;

/** Wrap per kata; kata yang lebih panjang dari batas tetap utuh di barisnya sendiri. */
export function wrapTerminatorText(text: string, maxChars = TERMINATOR_CHARS_PER_LINE): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = words.shift() as string;
  for (const word of words) {
    if (`${line} ${word}`.length <= maxChars) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  if (lines.length <= MAX_TERMINATOR_LINES) return lines;
  // Terlalu panjang: gabungkan sisa ke baris terakhir lalu potong dengan elipsis.
  const kept = lines.slice(0, MAX_TERMINATOR_LINES);
  const last = lines.slice(MAX_TERMINATOR_LINES - 1).join(" ");
  kept[MAX_TERMINATOR_LINES - 1] = last.length > maxChars + 4 ? `${last.slice(0, maxChars + 1)}…` : last;
  return kept;
}

const fits = (type: string, text: string, width: number, height: number, font: number) => {
  const box = fitBoxFor(type, width, height);
  return !box || fitsAtFont(text, box, font);
};

/**
 * Tinggi minimum (kelipatan STEP) agar teks muat pada lebar `width`; null bila tidak mungkin.
 * Muat/tidak bersifat monoton terhadap tinggi (bentuk makin tinggi → lebar tersedia
 * per baris tidak menyempit) → binary search, bukan scan linear.
 */
function minHeightFor(type: string, text: string, width: number, minH: number, maxH: number, font: number): number | null {
  if (maxH < minH || !fits(type, text, width, maxH - ((maxH - minH) % STEP), font)) return null;
  let lo = 0;
  let hi = Math.floor((maxH - minH) / STEP);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(type, text, width, minH + mid * STEP, font)) hi = mid;
    else lo = mid + 1;
  }
  return minH + lo * STEP;
}

/** Lebar minimum (kelipatan STEP) agar teks muat pada tinggi `height` (monoton terhadap lebar). */
function minWidthFor(type: string, text: string, height: number, minW: number, maxW: number, font: number): number | null {
  if (maxW < minW || !fits(type, text, maxW - ((maxW - minW) % STEP), height, font)) return null;
  let lo = 0;
  let hi = Math.floor((maxW - minW) / STEP);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(type, text, minW + mid * STEP, height, font)) hi = mid;
    else lo = mid + 1;
  }
  return minW + lo * STEP;
}

/** Kotak: jumlah baris paling sedikit dulu (diagram pendek), lalu lebar terkecil. */
function sizeRect(type: string, text: string, maxWidth: number, font: number): NodeSize | null {
  const { width: minW, height: minH } = NODE_MIN.rect;
  const maxW = Math.max(minW, maxWidth - NODE_SLACK.x);
  // Tinggi minimum pada lebar maksimum = jumlah baris terkecil yang mungkin.
  const bestH = minHeightFor(type, text, maxW, minH, MAX_HEIGHT, font);
  if (bestH === null) return null;
  const w = minWidthFor(type, text, bestH, minW, maxW, font);
  if (w === null) return { width: maxWidth, height: bestH + NODE_SLACK.y };
  return { width: Math.min(maxWidth, w + NODE_SLACK.x), height: bestH + NODE_SLACK.y };
}

/** Oval / belah ketupat: luas minimum dengan h ≤ aspect × w. */
function sizeCurved(type: string, text: string, min: NodeSize, maxW: number, aspect: number, font: number): NodeSize | null {
  let best: NodeSize | null = null;
  for (let w = min.width; w <= maxW; w += STEP) {
    // Pruning: tinggi minimum pun sudah tidak bisa mengalahkan luas terbaik → w lebih besar juga tidak.
    if (best && w * min.height >= best.width * best.height) break;
    const areaCap = best ? Math.floor((best.width * best.height) / w) : MAX_HEIGHT;
    const maxH = Math.min(MAX_HEIGHT, Math.floor(w * aspect), areaCap);
    const h = minHeightFor(type, text, w, min.height, maxH, font);
    if (h !== null && (!best || w * h < best.width * best.height)) best = { width: w, height: h };
  }
  if (!best) return null;
  return { width: Math.min(maxW + NODE_SLACK.x, best.width + NODE_SLACK.x), height: best.height + NODE_SLACK.y };
}

/** Cache: editor memanggil nodeSizeFor tiap ketikan; hasilnya deterministik per (tipe, teks, batas). */
const sizeCache = new Map<string, NodeSize>();
const SIZE_CACHE_LIMIT = 500;

function cached(key: string, compute: () => NodeSize): NodeSize {
  const hit = sizeCache.get(key);
  if (hit) return { ...hit };
  const value = compute();
  if (sizeCache.size >= SIZE_CACHE_LIMIT) sizeCache.delete(sizeCache.keys().next().value as string);
  sizeCache.set(key, value);
  return { ...value };
}

/**
 * Ukuran node agar label `text` muat pada NODE_TARGET_FONT.
 * `maxWidth` membatasi lebar (mis. lebar lane − padding); bila teks terlalu
 * panjang, node mentok di batas dan auto-fit akan mengecilkan font secukupnya.
 */
export function nodeSizeFor(type: string, text: string, maxWidth = NODE_MAX_WIDTH): NodeSize {
  const label = text.replace(/\s+/g, " ").trim() || " ";
  return cached(`${type}|${maxWidth}|${label}`, () => computeNodeSize(type, label, maxWidth));
}

function computeNodeSize(type: string, label: string, maxWidth: number): NodeSize {
  switch (type) {
    case "actor":
      return { width: 60, height: 80 };
    case "fork":
    case "join":
      return { width: 120, height: 10 };
    case "start":
    case "end":
      return sizeCurved(type, label, NODE_MIN.terminator, Math.min(maxWidth, NODE_MAX_WIDTH) - NODE_SLACK.x, 0.62, NODE_TARGET_FONT)
        ?? { width: Math.min(maxWidth, NODE_MAX_WIDTH), height: 96 };
    case "usecase":
      return sizeCurved(type, label, NODE_MIN.usecase, Math.min(maxWidth, USECASE_MAX_WIDTH) - NODE_SLACK.x, 0.6, NODE_TARGET_FONT)
        ?? { width: USECASE_MAX_WIDTH, height: 120 };
    case "decision":
      return sizeCurved(type, label, NODE_MIN.decision, maxWidth - NODE_SLACK.x, 0.62, NODE_TARGET_FONT)
        ?? { width: maxWidth, height: 136 };
    default:
      return sizeRect(type, label, maxWidth, NODE_TARGET_FONT) ?? { width: maxWidth, height: 96 };
  }
}

/** Lebar kepala lifeline agar nama participant muat (bold) pada LIFELINE_TARGET_FONT. */
export function lifelineWidth(name: string, maxWidth: number): number {
  const label = name.replace(/\s+/g, " ").trim() || " ";
  const cap = Math.max(LIFELINE_MIN_WIDTH, maxWidth);
  return minWidthFor("lifeline", label, 0, LIFELINE_MIN_WIDTH, cap, LIFELINE_TARGET_FONT) ?? cap;
}

/** Ukuran oval terminator untuk label (baris digabung, dibungkus ulang oleh auto-fit). */
export function terminatorSize(lines: string[]): NodeSize {
  return nodeSizeFor("start", lines.join(" "));
}

type TerminatorLike = { type: string; text: string; lines: string[]; x: number; y: number; width: number; height: number };

/**
 * Untuk diagram LAMA (oval tetap 110×56 / label 1 baris): bila label tidak muat
 * bahkan pada UNIFORM_FLOOR, perbesar oval dari titik pusat. Node yang sudah
 * muat dikembalikan apa adanya (referensi sama) → geometri lama tidak berubah.
 */
export function fitTerminator<T extends TerminatorLike>(node: T): T {
  if (node.type !== "start" && node.type !== "end") return node;
  const text = (node.text || node.lines.join(" ")).trim();
  const tooLong = node.lines.some((l) => l.length > TERMINATOR_CHARS_PER_LINE);
  const lines = tooLong ? wrapTerminatorText(text) : node.lines;
  if (!tooLong && fits(node.type, text, node.width, node.height, UNIFORM_FLOOR)) return node;
  const need = nodeSizeFor(node.type, text);
  const width = Math.max(node.width, need.width);
  const height = Math.max(node.height, need.height);
  if (width === node.width && height === node.height && lines === node.lines) return node;
  return {
    ...node,
    lines,
    x: node.x - (width - node.width) / 2,
    y: node.y - (height - node.height) / 2,
    width,
    height,
  };
}

export function fitTerminators<T extends TerminatorLike>(nodes: T[]): T[] {
  return nodes.map(fitTerminator);
}
