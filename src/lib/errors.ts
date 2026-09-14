/**
 * src/lib/errors.ts
 * -----------------------------------------------------------------------------
 * Helper error universal.
 *
 * `getErrorMessage`: ambil pesan error dari unknown type dengan fallback.
 *   - Error instance → .message
 *   - Object dengan .message → string
 *   - Else → fallback
 *
 * `isAbortLikeError`: detect error yang mirip abort (timeout, dll) supaya
 *   caller bisa decide: tampilkan pesan "koneksi terputus" atau retry.
 *
 * Pakai:
 *   } catch (err: unknown) {
 *     setError(getErrorMessage(err, "Gagal memuat data"));
 *   }
 * -----------------------------------------------------------------------------
 */

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object"
    && error !== null
    && "message" in error
    && typeof error.message === "string"
    && error.message.trim()
  ) {
    return error.message;
  }
  return fallback;
}

export function isAbortLikeError(error: unknown) {
  return /timeout|timed out|aborted|deadline/i.test(getErrorMessage(error, ""));
}