/**
 * src/lib/references/verify-pdf.ts
 * -----------------------------------------------------------------------------
 * Cek nyata apakah sebuah URL "PDF" benar-benar PDF (bukan landing page/paywall),
 * dan bila ternyata halaman artikel, coba temukan link PDF aslinya.
 *
 * Strategi:
 *   1. GET yang hanya membaca 16 KB pertama (peekBytes), follow redirect.
 *   2. Body diawali "%PDF-" → verified (tidak percaya content-type saja: banyak
 *      server mengirim PDF sebagai application/octet-stream, dan sebaliknya).
 *   3. Bila HTML: cari <meta name="citation_pdf_url"> (standar Google Scholar,
 *      dipakai OJS/Elsevier/Springer/IEEE), atau pola OJS /article/view/x/y →
 *      /article/download/x/y, lalu probe kandidat itu sekali.
 * Hasil di-cache 1 jam per URL.
 *
 * Status:
 *   - "verified"     : file benar-benar PDF (url = link PDF yang bisa diunduh)
 *   - "landing_page" : 2xx tapi HTML dan link PDF tidak ditemukan
 *   - "closed"       : 401/403/402 (paywall/anti-bot)
 *   - "broken"       : 404/5xx/timeout/network error
 *   - "unknown"      : tidak ada URL
 * -----------------------------------------------------------------------------
 */

import { safeFetch, type SafeFetchResult } from "@/lib/server/safe-fetch";

export type PdfStatus = "verified" | "landing_page" | "closed" | "broken" | "unknown";

export interface PdfCheck {
  status: PdfStatus;
  /** URL PDF final yang bisa diunduh (hanya terisi bila verified). */
  url: string | null;
}

/** UA mirip browser: banyak OJS/penerbit memblokir UA bot (403) padahal PDF-nya OA. */
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 keluhkampus-reference-checker";

const TIMEOUT_MS = 6000;
const PEEK_BYTES = 16 * 1024;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; check: PdfCheck }>();

function looksLikePdf(resp: SafeFetchResult) {
  return resp.body.subarray(0, 1024).toString("latin1").includes("%PDF-");
}

function classify(resp: SafeFetchResult): PdfStatus {
  if (resp.status === 401 || resp.status === 402 || resp.status === 403) return "closed";
  if (!resp.ok) return "broken";
  if (looksLikePdf(resp)) return "verified";
  const type = (resp.headers.get("content-type") || "").toLowerCase();
  // Body kosong tapi header PDF (server yang tidak mengirim body pada Range) → percaya header.
  if (!resp.body.length && (type.includes("application/pdf") || type.includes("application/x-pdf"))) return "verified";
  return "landing_page";
}

/** Probe lewat safeFetch (anti SSRF: IP privat & redirect ke jaringan internal ditolak). */
async function probe(url: string): Promise<SafeFetchResult> {
  return safeFetch(url, {
    timeoutMs: TIMEOUT_MS,
    peekBytes: PEEK_BYTES,
    headers: {
      Accept: "application/pdf,text/html;q=0.9,*/*;q=0.8",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
}

/** Cari kandidat link PDF di halaman artikel HTML. */
export function findPdfLinkInHtml(html: string, pageUrl: string): string | null {
  const candidates: string[] = [];
  // <meta name="citation_pdf_url" content="..."> (urutan atribut bisa terbalik).
  const meta = /<meta[^>]+name=["']citation_pdf_url["'][^>]*>/i.exec(html)?.[0];
  const content = meta ? /content=["']([^"']+)["']/i.exec(meta)?.[1] : null;
  if (content) candidates.push(content);
  // OJS: halaman viewer /article/view/{id}/{galley} → unduh langsung /article/download/{id}/{galley}.
  const ojs = /(\/article\/)view(\/\d+\/\d+)/.exec(pageUrl);
  if (ojs) candidates.push(pageUrl.replace(ojs[0], `${ojs[1]}download${ojs[2]}`));
  // Link OJS di dalam halaman (tombol "PDF").
  const ojsLink = /href=["']([^"']*\/article\/(?:download|view)\/\d+\/\d+[^"']*)["'][^>]*>\s*(?:<[^>]+>\s*)*PDF/i.exec(html)?.[1];
  if (ojsLink) candidates.push(ojsLink.replace(/\/article\/view\//, "/article/download/"));
  for (const c of candidates) {
    try {
      const abs = new URL(c.replace(/&amp;/g, "&"), pageUrl).toString();
      if (abs !== pageUrl) return abs;
    } catch {
      // abaikan URL rusak
    }
  }
  return null;
}

/** Cek URL + coba temukan PDF asli dari landing page. */
export async function checkPdfUrl(url: string | null | undefined): Promise<PdfCheck> {
  if (!url || !/^https?:\/\//i.test(url)) return { status: "unknown", url: null };

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.check;

  let check: PdfCheck = { status: "broken", url: null };
  try {
    const resp = await probe(url);
    const status = classify(resp);
    check = { status, url: status === "verified" ? resp.finalUrl : null };
    if (status === "landing_page") {
      const next = findPdfLinkInHtml(resp.body.toString("utf8"), resp.finalUrl);
      if (next) {
        const second = await probe(next).catch(() => null);
        if (second && classify(second) === "verified") check = { status: "verified", url: second.finalUrl };
      }
    }
  } catch {
    check = { status: "broken", url: null };
  }

  cache.set(url, { ts: Date.now(), check });
  return check;
}

export async function verifyPdfUrl(url: string | null | undefined): Promise<PdfStatus> {
  return (await checkPdfUrl(url)).status;
}

/** Cek banyak URL dengan concurrency terbatas (hasil lengkap: status + URL PDF final). */
export async function checkPdfUrls(urls: Array<string | null | undefined>, concurrency = 4) {
  const results: PdfCheck[] = new Array(urls.length).fill(null).map(() => ({ status: "unknown" as PdfStatus, url: null }));
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await checkPdfUrl(urls[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}

/** Kompatibilitas lama: hanya status. */
export async function verifyPdfUrls(urls: Array<string | null | undefined>, concurrency = 4) {
  return (await checkPdfUrls(urls, concurrency)).map((c) => c.status);
}
