/**
 * src/lib/errors.ts
 * -----------------------------------------------------------------------------
 * Helper error universal — SEMUA pesan yang tampil ke user lewat sini.
 *
 * `getErrorMessage(error, fallback)` mengembalikan pesan yang AMAN untuk
 * ditampilkan: error teknis (network, HTTP 5xx, Prisma, provider AI, nama
 * model, path file) dipetakan ke kalimat ramah; pesan yang memang ditulis
 * untuk user (ApiRequestError / throw new Error("Sesi tidak ditemukan.")) lolos
 * apa adanya.
 *
 * `toPublicErrorMessage(error)` versi server untuk event/log yang dikirim ke
 * klien (agent run, job laporan, stream UML).
 * -----------------------------------------------------------------------------
 */

const MODEL_NAME_RE = /\b(gpt|o[1-4]|claude|gemini|llama|mistral|mixtral|qwen|deepseek|grok|sonnet|opus|haiku)[\w.:-]*/gi;

/** Pola error teknis → pesan user. Urutan penting (lebih spesifik dulu). */
const TECHNICAL_PATTERNS: Array<[RegExp, string]> = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|connection error/i, "Koneksi ke server terputus. Periksa internet Anda lalu coba lagi."],
  [/\b(502|503|504)\b|bad gateway|service unavailable|gateway time-?out|upstream/i, "Server sedang sibuk atau dimuat ulang. Coba lagi beberapa saat."],
  [/\b429\b|rate ?limit|too many requests|quota|insufficient_quota|kuota/i, "Layanan AI sedang penuh. Tunggu sebentar lalu coba lagi."],
  [/timeout|timed out|deadline|aborted|abort(ed)?error|terlalu lama/i, "Proses memakan waktu terlalu lama. Coba lagi atau persempit permintaan."],
  [/\b(401|403)\b|unauthorized|forbidden|tidak terautentikasi|belum login/i, "Sesi Anda berakhir. Silakan masuk kembali."],
  [/\b413\b|payload too large|request entity too large|terlalu besar/i, "Data yang dikirim terlalu besar."],
  [/\b(500|HTTP 5\d\d)\b|internal server error/i, "Terjadi gangguan di server. Coba lagi beberapa saat."],
  [/prisma|P2\d{3}|unique constraint|foreign key|relation .* does not exist|column .* does not exist|database|postgres|connection pool/i, "Terjadi gangguan penyimpanan data. Coba lagi beberapa saat."],
  [/openai|anthropic|api[_ -]?key|invalid_api_key|incorrect api key|model .* (not found|does not exist)|context_length|maximum context|content_policy|content management policy/i, "Layanan AI sedang bermasalah. Coba lagi beberapa saat."],
  [/ENOENT|EACCES|EPERM|ENOSPC|no such file|permission denied/i, "Terjadi gangguan penyimpanan berkas. Coba lagi beberapa saat."],
  [/unexpected token|json\.parse|is not valid json|syntaxerror/i, "Respons server tidak valid. Coba lagi."],
  [/undefined is not|cannot read propert|is not a function|null is not an object|typeerror|referenceerror|rangeerror/i, "Terjadi kesalahan tak terduga. Coba muat ulang halaman."],
];

function rawMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return "";
}

/** True bila pesan terlihat seperti stack/trace/teknis (bukan kalimat untuk user). */
function looksTechnical(message: string) {
  return (
    /\bat\s+\S+\s+\(.+:\d+:\d+\)/.test(message) // stack frame
    || /[A-Za-z]:\\|\/(home|var|usr|srv)\//.test(message) // path OS
    || /\{"|\[object |<html|<!doctype/i.test(message)
    || message.length > 300
  );
}

/**
 * Pesan error aman untuk user. Pesan "manusiawi" (Bahasa Indonesia, pendek,
 * tanpa jejak teknis) diteruskan; sisanya dipetakan ke fallback ramah.
 */
export function getErrorMessage(error: unknown, fallback = "Terjadi kesalahan. Coba lagi."): string {
  const raw = rawMessage(error).trim();
  if (!raw) return fallback;
  for (const [pattern, friendly] of TECHNICAL_PATTERNS) {
    if (pattern.test(raw)) return friendly;
  }
  if (looksTechnical(raw)) return fallback;
  // Jangan pernah tampilkan nama model/provider.
  return raw.replace(MODEL_NAME_RE, "AI").slice(0, 300);
}

/** Alias server-side untuk pesan yang masuk ke event/log yang dilihat klien. */
export const toPublicErrorMessage = getErrorMessage;

/** Pesan mentah (untuk console/log server saja — JANGAN dikirim ke klien). */
export function getRawErrorMessage(error: unknown, fallback = "unknown error") {
  return rawMessage(error) || fallback;
}

export function isAbortLikeError(error: unknown) {
  return /timeout|timed out|aborted|deadline/i.test(rawMessage(error));
}

export function isNetworkError(error: unknown) {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up/i.test(rawMessage(error));
}