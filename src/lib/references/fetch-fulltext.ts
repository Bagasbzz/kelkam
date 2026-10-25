/**
 * src/lib/references/fetch-fulltext.ts
 * -----------------------------------------------------------------------------
 * Unduh PDF open access yang sudah terverifikasi (pdfStatus=verified) lalu
 * ekstrak teksnya supaya AI membaca ISI jurnal, bukan hanya abstrak.
 *
 * Batasan (agar muat di segmen agent ~90 detik dan payload job tidak meledak):
 *  - hanya URL yang lolos verify-pdf ("verified")
 *  - ukuran maks 15 MB, timeout unduh 20 detik, concurrency 3
 *  - teks disimpan maksimal FULLTEXT_MAX_CHARS per sumber
 *  - seluruh batch dibatasi `deadlineMs` (sisa dilewati, tetap abstrak)
 *
 * Hanya sumber legal (OA dari penerbit/repositori/Unpaywall). Tidak memakai
 * situs bajakan.
 * -----------------------------------------------------------------------------
 */
import { extractPdf, hasPdfSignature } from "@/lib/server/extract-text";
import { safeFetch } from "@/lib/server/safe-fetch";
import type { VerifiedSource } from "./find-sources";

export const FULLTEXT_MAX_CHARS = 45_000;
const MAX_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const CONCURRENCY = 3;

async function downloadPdf(url: string): Promise<Buffer | null> {
  try {
    // safeFetch: tolak IP privat & cek ulang setiap redirect (anti SSRF).
    const resp = await safeFetch(url, {
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      headers: {
        Accept: "application/pdf,*/*;q=0.8",
        "User-Agent": "keluhkampus-reference-reader/1.0 (+https://keluhkampus.my.id)",
      },
    });
    if (!resp.ok) return null;
    if (!hasPdfSignature(resp.body)) return null;
    return resp.body;
  } catch {
    return null;
  }
}

/** Ambil teks penuh satu sumber; null bila gagal/tidak tersedia. */
export async function fetchSourceFullText(source: VerifiedSource): Promise<{ text: string; chars: number } | null> {
  if (source.pdfStatus !== "verified" || !source.pdfUrl) return null;
  const buffer = await downloadPdf(source.pdfUrl);
  if (!buffer) return null;
  try {
    const result = await extractPdf(buffer, FULLTEXT_MAX_CHARS);
    // Teks terlalu pendek biasanya PDF hasil scan (tanpa layer teks).
    if (result.content.length < 1_500) return null;
    return { text: result.content, chars: result.charCount };
  } catch {
    return null;
  }
}

/**
 * Isi `fullText` untuk daftar sumber (mutasi salinan, bukan input). Sumber yang
 * sudah punya fullText dilewati. Berhenti menerima tugas baru saat deadline lewat.
 */
export async function enrichSourcesWithFullText(
  sources: VerifiedSource[],
  options: { deadlineMs?: number; onProgress?: (text: string) => void } = {},
): Promise<{ sources: VerifiedSource[]; read: number; skipped: number }> {
  const startedAt = Date.now();
  const deadline = options.deadlineMs ?? 45_000;
  const progress = options.onProgress ?? (() => {});
  const out = sources.map((s) => ({ ...s }));
  const queue = out
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => !s.fullText && s.pdfStatus === "verified" && s.pdfUrl);
  if (!queue.length) return { sources: out, read: 0, skipped: 0 };

  let cursor = 0;
  let read = 0;
  async function worker() {
    while (cursor < queue.length) {
      if (Date.now() - startedAt > deadline) return;
      const item = queue[cursor++];
      const result = await fetchSourceFullText(item.s);
      if (!result) continue;
      out[item.index] = {
        ...item.s,
        fullText: result.text,
        fullTextChars: result.chars,
        readLevel: "fulltext",
        qualitySignals: Array.from(new Set([...item.s.qualitySignals, "Teks penuh dibaca AI"])),
      };
      read += 1;
      progress(`Teks penuh terbaca: ${item.s.authors[0] || "?"} ${item.s.year || ""} (${Math.round(result.chars / 1000)}k karakter)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return { sources: out, read, skipped: queue.length - read };
}
