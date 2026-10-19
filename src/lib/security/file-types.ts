/**
 * src/lib/security/file-types.ts
 * -----------------------------------------------------------------------------
 * Kebijakan tipe file upload (dipakai server):
 *   - Denylist ekstensi berbahaya (executable / script yang jalan saat diklik).
 *   - MIME "aktif" (HTML/SVG/JS/XML) dinormalisasi ke octet-stream supaya tidak
 *     pernah di-render browser dari origin kita (anti stored-XSS).
 *   - Deteksi signature (magic bytes) gambar & video. Hanya tipe yang lolos
 *     signature yang boleh di-serve inline.
 * -----------------------------------------------------------------------------
 */

/** Ekstensi yang ditolak untuk SEMUA user (termasuk admin). */
const BLOCKED_EXTENSIONS_RE =
  /\.(exe|dll|msi|msp|msix|appx|bat|cmd|com|scr|pif|cpl|hta|vbs|vbe|jse|wsf|wsh|ps1|psm1|psd1|lnk|reg|inf|scf|gadget|jar|apk|app|dmg|pkg|deb|rpm|run|bin|elf|so|dylib|sys|drv|ocx)$/i;

export function isBlockedFileName(name: string): boolean {
  return BLOCKED_EXTENSIONS_RE.test(name.trim());
}

export const BLOCKED_FILE_MESSAGE =
  "Tipe file ini diblokir demi keamanan (program/skrip yang bisa dieksekusi). Kompres ke ZIP bila memang perlu dibagikan.";

/** MIME yang bisa dieksekusi/di-render browser; disimpan sebagai octet-stream. */
const ACTIVE_MIME_RE =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|text\/javascript|application\/(x-)?javascript|application\/ecmascript|text\/ecmascript|application\/x-shockwave-flash|application\/x-msdownload|application\/x-sh|application\/x-msdos-program)$/i;

/** Normalisasi MIME dari klien: kosong/aktif → application/octet-stream. */
export function sanitizeMime(mime: string | null | undefined): string {
  const base = (mime || "").split(";")[0].trim().toLowerCase();
  if (!base || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(base)) return "application/octet-stream";
  if (ACTIVE_MIME_RE.test(base)) return "application/octet-stream";
  if (base === "image/jpg" || base === "image/pjpeg") return "image/jpeg";
  return base;
}

/** Gambar yang boleh tampil inline (dan dikirim ke model vision). */
export const SAFE_IMAGE_MIME_RE = /^image\/(png|jpeg|webp|gif)$/i;
/** Video yang bisa diputar browser. */
export const SAFE_VIDEO_MIME_RE = /^video\/(mp4|webm|ogg|quicktime|x-matroska|x-msvideo|3gpp)$/i;

/** Deteksi MIME gambar dari magic bytes. null kalau bukan PNG/JPEG/WebP/GIF. */
export function detectImageMime(head: Buffer): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString("latin1"))) return "image/gif";
  return null;
}

/** Cek magic bytes container video (MP4/MOV/3GP, WebM/MKV, AVI, OGG). */
export function looksLikeVideo(head: Buffer): boolean {
  if (head.length < 12) return false;
  const ascii = (start: number, end: number) => head.subarray(start, end).toString("latin1");
  if (["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(ascii(4, 8))) return true;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return true;
  if (ascii(0, 4) === "OggS") return true;
  return false;
}

const VIDEO_EXT_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
};

const IMAGE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * Tentukan MIME final: pakai MIME klien yang sudah disanitasi; kalau kosong /
 * octet-stream, tebak gambar/video dari ekstensi (MKV/AVI sering MIME kosong).
 */
export function resolveMime(name: string, provided: string | null | undefined): string {
  const mime = sanitizeMime(provided);
  if (mime !== "application/octet-stream") return mime;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return VIDEO_EXT_MIME[ext] ?? IMAGE_EXT_MIME[ext] ?? mime;
}

/**
 * Validasi isi vs MIME yang diklaim untuk tipe yang di-serve inline.
 * Tipe lain selalu di-serve sebagai unduhan (attachment), jadi tidak perlu cek.
 */
export function headMatchesMime(mime: string, head: Buffer): boolean {
  if (SAFE_IMAGE_MIME_RE.test(mime)) {
    const detected = detectImageMime(head);
    return detected !== null && detected === mime.toLowerCase();
  }
  if (SAFE_VIDEO_MIME_RE.test(mime)) return looksLikeVideo(head);
  return true;
}
