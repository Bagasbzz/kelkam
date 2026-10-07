/**
 * Helper kecil untuk modul Tugas: tebak nomor pertemuan dari judul &
 * normalisasi NIM (dipakai saat mencocokkan roster ↔ submission).
 */

/** Tebak nomor pertemuan dari judul, mis. "Tugas Pertemuan 3" / "Minggu ke-4" / "P5". */
export function guessPertemuan(title: string): number | null {
  const m =
    /(?:pertemuan|minggu|week|sesi|meeting)\s*(?:ke)?[-\s]*(\d{1,2})/i.exec(title) ||
    /\bP(\d{1,2})\b/.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 99 ? n : null;
}

/** Normalisasi NIM: buang spasi/titik/strip, huruf besar. */
export function normalizeNim(nim: string): string {
  return nim.replace(/[\s.\-_]/g, "").toUpperCase();
}
