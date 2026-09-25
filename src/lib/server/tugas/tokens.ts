/**
 * src/lib/server/tugas/tokens.ts
 * -----------------------------------------------------------------------------
 * Generator token pendek untuk akses course Tugas.
 *
 * Token dipakai mahasiswa untuk buka halaman course tanpa login.
 * Format: 8 char alphanumeric TANPA karakter membingungkan
 * (0/O, 1/I/L, U/V/Y) supaya mudah dibaca & diketik.
 *
 * Pakai `crypto.randomBytes` (built-in Node) — tidak butuh dependency
 * tambahan seperti nanoid.
 *
 * Catatan: alphabet di sini exclude chars yang sering bikin ambigu
 * (0/O/1/I/L/U/V/Y). Sisanya ≈ 23 char uppercase + 8 digit = 31 char.
 * Entropy ≈ log2(31^8) = 39.7 bits — cukup untuk shared link + rate-limit.
 * -----------------------------------------------------------------------------
 */

import { randomBytes } from "crypto";

/** Alphabet tanpa karakter ambigu: tidak ada 0/O/1/I/L/U/V/Y. */
const ALPHABET = "ABCDEFGHJKMNPQRSTWXZ23456789";

/** Panjang token (8 char default). */
const TOKEN_LENGTH = 8;

/**
 * Generate token random sepanjang TOKEN_LENGTH dari ALPHABET.
 *
 * Implementasi:
 *   - Ambil byte random dari crypto.
 *   - Modulo dengan panjang alphabet (31) → index aman karena 31 <= 256.
 *   - Fallback `index % alphabet.length` jalan untuk semua byte value.
 *
 * @returns token string (mis. "G7K2NP4X")
 */
export function generateCourseToken(): string {
  // Ambil 2x byte supaya aman walaupun modulo.
  const bytes = randomBytes(TOKEN_LENGTH * 2);
  let out = "";
  for (let i = 0; i < bytes.length && out.length < TOKEN_LENGTH; i += 1) {
    // Skip byte yang >= 248 (biar modulo 31 adil) — rare (< 3% byte).
    if (bytes[i] >= 248) continue;
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  // Kalau entah kenapa byte di-filter semua (sangat langka), retry 1x.
  if (out.length < TOKEN_LENGTH) {
    out += generateCourseTokenFallback(out.length);
  }
  return out;
}

function generateCourseTokenFallback(existing: number): string {
  const need = TOKEN_LENGTH - existing;
  const bytes = randomBytes(need);
  let out = "";
  for (let i = 0; i < need; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}