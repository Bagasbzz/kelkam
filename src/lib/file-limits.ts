/**
 * src/lib/file-limits.ts
 * -----------------------------------------------------------------------------
 * Konstanta batas ukuran file yang dipakai di server DAN client.
 *
 * PENTING: Satu sumber kebenaran (single source of truth).
 * Kalau nilainya perlu diubah, edit di sini — JANGAN hardcode 12 * 1024 * 1024
 * di route handler / form / test.
 *
 * Constraint terkait:
 *   - JKC cPanel: LiteSpeed default body limit ~10-12MB. Kalau dinaikkan
 *     pastikan `.htaccess` atau `LimitRequestBody` di cPanel cukup.
 *   - Browser: standarnya tidak ada limit, tapi UX-nya tetep lebih baik
 *     kasih pesan sebelum upload gagal 413.
 * -----------------------------------------------------------------------------
 */

/** 12 MB — batas aman untuk LiteSpeed JKC + headroom untuk SHA256 hashing. */
export const MAX_FILE_BYTES = 12 * 1024 * 1024;

/** Batas bytes yang ditampilkan manusia. */
export const MAX_FILE_LABEL = `${MAX_FILE_BYTES / 1024 / 1024} MB`;

/**
 * Convert bytes → label readable (B / KB / MB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}