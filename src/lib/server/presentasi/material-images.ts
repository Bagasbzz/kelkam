/**
 * src/lib/server/presentasi/material-images.ts
 * -----------------------------------------------------------------------------
 * Gambar yang tertanam di bahan (DOCX/PPTX/PDF), terutama logo kampus di sampul
 * laporan. Disimpan sebagai file milik pengguna agar bisa dipakai di slide dan
 * diekspor ke PPTX. Hanya PNG/JPEG; EMF/WMF dilewati.
 */
import { extractImagesFromFile } from "@/lib/server/extract-text";
import { inspectImage } from "@/lib/server/image-convert";
import { readUpload, saveUpload } from "@/lib/storage/upload";

export const LOGO_MARKER = "(kemungkinan logo kampus)";
const MAX_IMAGES = 6;
const MAX_BYTES = 4 * 1024 * 1024;

export interface MaterialImage { fileId: string; title: string; logo?: boolean }

/** Urutan dokumen: image1, image2, ... (urutan nama ZIP tidak selalu numerik). */
function order(path: string) {
  const match = /(\d+)\.\w+$/.exec(path);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export async function extractMaterialImages(ownerId: string, fileId: string, fileName: string): Promise<MaterialImage[]> {
  if (!/\.(docx|pptx|pdf)$/i.test(fileName)) return [];
  const buffer = await readUpload(fileId, ownerId).catch(() => null);
  if (!buffer) return [];
  const { images } = await extractImagesFromFile(buffer, fileName, { maxImages: 16, maxPdfPages: 2, maxTotalBytes: 24 * 1024 * 1024 });
  const candidates = images
    .filter((image) => (image.mime === "image/png" || image.mime === "image/jpeg") && image.bytes.length >= 1024 && image.bytes.length <= MAX_BYTES)
    .map((image, i) => ({ image, rank: /\.pdf#/i.test(image.path) ? i : order(image.path) }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_IMAGES);

  const out: MaterialImage[] = [];
  let logoFound = false;
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 40) || "bahan";
  for (const [i, { image }] of candidates.entries()) {
    let width = image.width ?? 0, height = image.height ?? 0;
    try { ({ width, height } = inspectImage(image.bytes)); } catch { continue; }
    // A campus logo is usually the first, roughly square, modest-size picture on the cover.
    const ratio = width / Math.max(height, 1);
    const logo = !logoFound && i < 3 && ratio >= 0.5 && ratio <= 2.2 && Math.max(width, height) <= 2000;
    if (logo) logoFound = true;
    try {
      const saved = await saveUpload({ ownerId, buffer: image.bytes, originalName: `${base}-gambar-${i + 1}.${image.mime === "image/png" ? "png" : "jpg"}`, mime: image.mime });
      out.push({ fileId: saved.id, title: `Gambar ${i + 1} dari ${fileName.slice(0, 120)}${logo ? ` ${LOGO_MARKER}` : ""}`, ...(logo ? { logo: true } : {}) });
    } catch { /* An image that cannot be stored is skipped. */ }
  }
  return out;
}
