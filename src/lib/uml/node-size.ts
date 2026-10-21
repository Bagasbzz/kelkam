/**
 * Ukuran node terminator (start/end) yang dijamin memuat labelnya.
 * -----------------------------------------------------------------------------
 * Oval hanya punya area teks efektif ≈ 70% lebar × 70% tinggi bounding box
 * (sudut kotak teks terjauh berada di 1/√2 radius). Kalau lebar oval dibuat
 * tetap, label panjang seperti "Selesai - Peminjaman Ditolak" keluar garis.
 * Maka: label di-wrap per ~18 karakter, lalu oval diperbesar sesuai lebar
 * teks pada font target. Ukuran font akhirnya ditentukan auto-fit (text-fit.ts).
 * -----------------------------------------------------------------------------
 */

import { measureText } from "@/lib/uml/text-fit";

/** Font target label terminator (px), selaras dengan FIT_MAX_FONT. */
const TERMINATOR_TARGET_FONT = 17;

/**
 * 18 karakter/baris → label umum ("Selesai - Peminjaman Ditolak") jadi 2 baris
 * dan oval tetap pipih (±200×68), bukan hampir bulat.
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

/** Ukuran oval minimum agar semua baris label muat di dalam garis elips. */
export function terminatorSize(lines: string[]): { width: number; height: number } {
  // Ukur dengan metrik yang sama dengan auto-fit (text-fit.ts) pada font target,
  // supaya label terminator tampil sebesar label node lain (tidak mengecil).
  const textWidth = Math.max(...lines.map((l) => measureText(l, TERMINATOR_TARGET_FONT)), TERMINATOR_TARGET_FONT);
  const textHeight = Math.max(lines.length, 1) * TERMINATOR_TARGET_FONT * 1.2;
  // Kotak teks w×h muat di elips bila a = w/2·√2 dan b = h/2·√2 (luas minimum).
  return {
    width: Math.round(Math.max(96, textWidth * Math.SQRT2 + 16)),
    height: Math.round(Math.max(52, textHeight * Math.SQRT2 + 10)),
  };
}

/**
 * Untuk diagram LAMA (tersimpan dengan oval tetap 110×56 dan label 1 baris):
 * hitung ulang baris + perbesar oval dari titik pusat bila label tidak muat.
 * Node non-terminator / yang sudah muat dikembalikan apa adanya (referensi sama).
 */
export function fitTerminator<T extends { type: string; text: string; lines: string[]; x: number; y: number; width: number; height: number }>(node: T): T {
  if (node.type !== "start" && node.type !== "end") return node;
  const tooLong = node.lines.some((l) => l.length > TERMINATOR_CHARS_PER_LINE);
  const lines = tooLong ? wrapTerminatorText(node.text || node.lines.join(" ")) : node.lines;
  const need = terminatorSize(lines);
  if (!tooLong && node.width >= need.width && node.height >= need.height) return node;
  const width = Math.max(node.width, need.width);
  const height = Math.max(node.height, need.height);
  return {
    ...node,
    lines,
    x: node.x - (width - node.width) / 2,
    y: node.y - (height - node.height) / 2,
    width,
    height,
  };
}

export function fitTerminators<T extends { type: string; text: string; lines: string[]; x: number; y: number; width: number; height: number }>(nodes: T[]): T[] {
  return nodes.map(fitTerminator);
}
