import { getErrorMessage } from "@/lib/errors";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import { ProviderPaper, SearchOptions } from "./types";
import { normalizeJournalDoi, normalizeJournalIssns, safeReferenceUrl } from "./journal-check";

const CROSSREF_BASE = "https://api.crossref.org/works";

function normalizeDoi(value: unknown) {
  if (!value) return null;
  return String(value)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function extractYear(value: unknown) {
  const item = isRecord(value) ? value : {};
  const issued = isRecord(item.issued) ? item.issued : {};
  const parts = issued["date-parts"];
  if (Array.isArray(parts) && Array.isArray(parts[0]) && parts[0][0]) return Number(parts[0][0]);
  return null;
}

function reconstructTitle(value: unknown) {
  const item = isRecord(value) ? value : {};
  return Array.isArray(item.title) ? String(item.title[0] || "") : String(item.title || "");
}

function reconstructVenue(value: unknown) {
  const item = isRecord(value) ? value : {};
  if (Array.isArray(item["container-title"]) && item["container-title"][0]) return String(item["container-title"][0]);
  if (item.publisher) return String(item.publisher);
  return null;
}

function reconstructPublisher(value: unknown) {
  const item = isRecord(value) ? value : {};
  return item.publisher ? String(item.publisher) : null;
}

function reconstructAuthors(value: unknown) {
  const item = isRecord(value) ? value : {};
  return Array.isArray(item.author)
    ? item.author
        .filter(isRecord)
        .map((author) => [author.given, author.family].filter(Boolean).join(" ").trim())
        .filter(Boolean)
    : [];
}

function inferPdfUrl(value: unknown) {
  const item = isRecord(value) ? value : {};
  const links = Array.isArray(item.link) ? item.link.filter(isRecord) : [];
  const pdf = links.find((link) => /pdf/i.test(String(link["content-type"] || "")));
  return pdf?.URL ? String(pdf.URL) : null;
}

function reconstructIssn(value: unknown): string[] {
  const item = isRecord(value) ? value : {};
  const values = [item.ISSN, item["issn-type"]].flatMap((entry) => {
    if (Array.isArray(entry)) return entry.map((part) => isRecord(part) ? part.value : part);
    return [entry];
  });
  return normalizeJournalIssns(values);
}

export async function verifyCrossrefDoi(doi: string) {
  const normalized = normalizeJournalDoi(doi);
  const empty = { verified: false, canonicalDoi: null, publisherUrl: null, pdfUrl: null, venue: null, title: null, publisher: null, type: null, issn: [] as string[] };
  if (!normalized) return { ...empty, status: "not_found" as const };
  const url = `${CROSSREF_BASE}/${encodeURIComponent(normalized)}`;
  const result = await fetchVerificationJson(url);
  if (result.status !== "ok") return { ...empty, status: result.status, url };
  const item = isRecord(result.data) && isRecord(result.data.message) ? result.data.message : null;
  const canonicalDoi = item && normalizeJournalDoi(item.DOI);
  if (!item || !canonicalDoi) return { ...empty, status: "unavailable" as const, url };
  if (canonicalDoi !== normalized) return { ...empty, status: "conflict" as const, canonicalDoi, url };
  const bounded = (value: string | null) => value?.replace(/\u0000/g, "").slice(0, 400) || null;
  return {
    verified: true,
    status: "verified" as const,
    canonicalDoi,
    url,
    publisherUrl: safeReferenceUrl(item.URL),
    pdfUrl: safeReferenceUrl(inferPdfUrl(item)),
    venue: Array.isArray(item["container-title"]) && typeof item["container-title"][0] === "string" ? bounded(item["container-title"][0]) : null,
    title: bounded(reconstructTitle(item)),
    publisher: bounded(reconstructPublisher(item)),
    type: typeof item.type === "string" ? bounded(item.type) : null,
    issn: reconstructIssn(item),
  };
}

/** Exact checks never follow redirects, retry, cache, or contact caller-supplied hosts. */
export async function fetchVerificationJson(url: string): Promise<
  { status: "ok"; data: unknown } | { status: "not_found" | "unavailable" }
> {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.port || target.username || target.password || !["api.crossref.org", "api.openalex.org", "doaj.org"].includes(target.hostname)) {
    throw new Error("Unsupported verification provider");
  }
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Verification timed out"));
    }, 4000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetch(target.href, { headers: { Accept: "application/json" }, redirect: "error", cache: "no-store", signal: controller.signal });
      if (response.status === 404) return { status: "not_found" as const };
      if (!response.ok || Number(response.headers.get("content-length")) > 512 * 1024 || !response.body) return { status: "unavailable" as const };
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024) return { status: "unavailable" as const };
        parts.push(decoder.decode(value, { stream: true }));
      }
      parts.push(decoder.decode());
      return { status: "ok" as const, data: JSON.parse(parts.join("")) as unknown };
    })()]);
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
    controller.abort();
    void reader?.cancel().catch(() => undefined);
  }
}

export async function searchCrossref(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const rows = Math.min(Number(options.limit || 6), 40);
  const url = new URL(CROSSREF_BASE);
  url.searchParams.set("query.bibliographic", String(query || ""));
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("select", "DOI,title,author,issued,container-title,URL,is-referenced-by-count,link,publisher,ISSN,type");

  try {
    const json = await fetchWithRetryAndCache(url.toString(), {
      headers: { Accept: "application/json" },
    });

    const payload = isRecord(json) ? json : {};
    const message = isRecord(payload.message) ? payload.message : {};
    const items = Array.isArray(message.items) ? message.items.filter(isRecord) : [];
    return items
      .map((item) => {
        const year = extractYear(item);
        const doi = normalizeDoi(item?.DOI);
        const pdfUrl = inferPdfUrl(item);
        return {
          id: doi || String(item.URL || "") || reconstructTitle(item).slice(0, 80),
          title: reconstructTitle(item),
          authors: reconstructAuthors(item),
          year,
          venue: reconstructVenue(item),
          publisher: reconstructPublisher(item),
          publicationType: typeof item.type === "string" ? item.type : null,
          issn: reconstructIssn(item),
          abstract: null,
          url: item.URL ? String(item.URL) : null,
          pdfUrl,
          doi,
          citationCount: Number(item["is-referenced-by-count"] || 0),
          isOpenAccess: Boolean(pdfUrl),
          source: "crossref",
          sourceProviders: ["crossref"],
          pdfStatus: "unknown",
          doiVerified: false,
          raw: item,
        } as ProviderPaper;
      })
      .filter((paper: ProviderPaper) => {
        if (!paper.title) return false;
        if (options.yearFrom && paper.year && paper.year < options.yearFrom) return false;
        if (options.yearTo && paper.year && paper.year > options.yearTo) return false;
        if (options.openAccessOnly && !paper.isOpenAccess) return false;
        return true;
      });
  } catch (error: unknown) {
    console.error("searchCrossref error:", getErrorMessage(error, "Unknown provider error"));
    return [];
  }
}
