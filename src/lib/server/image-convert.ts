/**
 * Konversi gambar server-side (JPEG/GIF/WebP/PNG → PNG) memakai @napi-rs/canvas.
 * Dipakai untuk menyisipkan gambar dari bahan user ke DOCX (exporter hanya PNG)
 * dan memperkecil gambar besar sebelum dikirim ke model vision.
 */
import { detectImageMime } from "@/lib/server/extract-text";

export interface PngResult {
  bytes: Buffer;
  width: number;
  height: number;
}

/**
 * Ubah gambar apa pun yang didukung menjadi PNG dengan lebar maks `maxWidth`.
 * PNG yang sudah cukup kecil dikembalikan apa adanya (tanpa decode ulang).
 */
export async function toPng(input: Buffer, options: { maxWidth?: number; maxBytesPassthrough?: number } = {}): Promise<PngResult> {
  const mime = detectImageMime(input);
  if (!mime) throw new Error("Bukan gambar PNG/JPEG/GIF/WebP yang valid.");
  const maxWidth = Math.max(64, options.maxWidth ?? 1600);
  const passthrough = options.maxBytesPassthrough ?? 3 * 1024 * 1024;

  if (mime === "image/png" && input.length <= passthrough) {
    const width = input.readUInt32BE(16);
    const height = input.readUInt32BE(20);
    if (width > 0 && height > 0 && width <= maxWidth) return { bytes: input, width, height };
  }

  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const img = await loadImage(input);
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  // Latar putih: gambar transparan (logo/screenshot) tetap terbaca saat dicetak.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return { bytes: await canvas.encode("png"), width, height };
}
