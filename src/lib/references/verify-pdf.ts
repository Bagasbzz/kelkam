/**
 * src/lib/references/verify-pdf.ts
 * -----------------------------------------------------------------------------
 * Cek nyata apakah sebuah URL "PDF" benar-benar PDF (bukan landing page/paywall).
 *
 * Strategi: HEAD (fallback GET range 0-0) dengan timeout 5s, follow redirect,
 * lihat Content-Type. Hasil di-cache 1 jam per URL supaya pencarian berulang
 * tidak memukul publisher.
 *
 * Status:
 *   - "verified"     : content-type application/pdf
 *   - "landing_page" : 2xx tapi HTML (halaman artikel, bukan file)
 *   - "closed"       : 401/403/402 (paywall)
 *   - "broken"       : 404/5xx/timeout/network error
 *   - "unknown"      : tidak ada URL
 * -----------------------------------------------------------------------------
 */

export type PdfStatus = "verified" | "landing_page" | "closed" | "broken" | "unknown";

const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ts: number; status: PdfStatus }>();

function classify(resp: Response): PdfStatus {
  if (resp.status === 401 || resp.status === 402 || resp.status === 403) return "closed";
  if (!resp.ok) return "broken";
  const type = (resp.headers.get("content-type") || "").toLowerCase();
  if (type.includes("application/pdf") || type.includes("application/x-pdf")) return "verified";
  return "landing_page";
}

async function probe(url: string, method: "HEAD" | "GET"): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "application/pdf,*/*;q=0.8",
        "User-Agent": "keluhkampus-reference-checker/1.0 (+https://keluhkampus.my.id)",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyPdfUrl(url: string | null | undefined): Promise<PdfStatus> {
  if (!url || !/^https?:\/\//i.test(url)) return "unknown";

  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.status;

  let status: PdfStatus = "broken";
  try {
    let resp = await probe(url, "HEAD");
    // Banyak server menolak HEAD (405) atau tidak kirim content-type → coba GET ringan.
    if (resp.status === 405 || resp.status === 501 || !resp.headers.get("content-type")) {
      resp = await probe(url, "GET");
      // Range request bisa balas 206.
    }
    status = classify(resp);
  } catch {
    status = "broken";
  }

  cache.set(url, { ts: Date.now(), status });
  return status;
}

/** Verifikasi banyak URL dengan concurrency terbatas. */
export async function verifyPdfUrls(urls: Array<string | null | undefined>, concurrency = 4) {
  const results: PdfStatus[] = new Array(urls.length).fill("unknown");
  let cursor = 0;
  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await verifyPdfUrl(urls[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return results;
}
