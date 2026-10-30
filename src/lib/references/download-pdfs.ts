import type { VerifiedSource } from "./find-sources";

export const MAX_PDF_DOWNLOADS = 10;
export const MAX_PDF_BATCH_BYTES = 45 * 1024 * 1024;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

export function referencePdfName(source: Pick<VerifiedSource, "title" | "year">, index: number) {
  const title = source.title.replace(/[^a-zA-Z0-9 ._-]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "referensi";
  return `${String(index + 1).padStart(2, "0")}-${source.year || "tanpa-tahun"}-${title}.pdf`;
}

/** Only server-stored sources may supply URLs; the route never accepts a client URL. */
export async function collectReferencePdfs(
  sources: VerifiedSource[],
  download: (url: string) => Promise<Buffer | null>,
  options: { maxBytes?: number; deadlineMs?: number } = {},
) {
  if (sources.length > MAX_PDF_DOWNLOADS) throw new Error(`Maksimal ${MAX_PDF_DOWNLOADS} PDF sekali unduh.`);
  const files: { path: string; bytes: Buffer }[] = [];
  const skipped: { id: string; title: string; reason: string }[] = [];
  const deadline = Date.now() + (options.deadlineMs ?? 60_000);
  let total = 0;
  for (const [index, source] of sources.entries()) {
    const skip = (reason: string) => skipped.push({ id: source.id, title: source.title, reason });
    if (source.pdfStatus !== "verified" || !source.pdfUrl) { skip("PDF terbuka belum tersedia."); continue; }
    if (Date.now() >= deadline) { skip("Batas waktu unduhan tercapai."); continue; }
    const bytes = await download(source.pdfUrl).catch(() => null);
    if (!bytes || !bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      skip("Penerbit tidak mengirim PDF yang dapat diunduh. Coba buka halaman artikel.");
      continue;
    }
    if (bytes.length > MAX_PDF_BYTES || total + bytes.length > (options.maxBytes ?? MAX_PDF_BATCH_BYTES)) {
      skip("Batas ukuran unduhan tercapai."); continue;
    }
    total += bytes.length;
    files.push({ path: referencePdfName(source, index), bytes });
  }
  return { files, skipped };
}
