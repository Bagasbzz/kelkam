import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import { ProviderPaper, SearchOptions } from "./types";
import { getErrorMessage } from "@/lib/errors";

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

export async function verifyCrossrefDoi(doi: string) {
  const normalized = normalizeDoi(doi);
  if (!normalized) {
    return { verified: false, canonicalDoi: null, publisherUrl: null, pdfUrl: null, venue: null };
  }

  try {
    const encoded = encodeURIComponent(normalized);
    const json = await fetchWithRetryAndCache(`${CROSSREF_BASE}/${encoded}`, {
      headers: { Accept: "application/json" },
    });
    const payload = isRecord(json) ? json : {};
    const item = isRecord(payload.message) ? payload.message : null;
    if (!item) return { verified: false, canonicalDoi: normalized, publisherUrl: null, pdfUrl: null, venue: null };

    return {
      verified: true,
      canonicalDoi: normalizeDoi(item.DOI) || normalized,
      publisherUrl: item.URL ? String(item.URL) : null,
      pdfUrl: inferPdfUrl(item),
      venue: reconstructVenue(item),
    };
  } catch {
    return { verified: false, canonicalDoi: normalized, publisherUrl: null, pdfUrl: null, venue: null };
  }
}

export async function searchCrossref(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const rows = Math.min(Number(options.limit || 6), 20);
  const url = new URL(CROSSREF_BASE);
  url.searchParams.set("query.bibliographic", String(query || ""));
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("select", "DOI,title,author,issued,container-title,URL,is-referenced-by-count,link,publisher");

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
          abstract: null,
          url: item.URL ? String(item.URL) : null,
          pdfUrl,
          doi,
          citationCount: Number(item["is-referenced-by-count"] || 0),
          isOpenAccess: Boolean(pdfUrl),
          source: "crossref",
          sourceProviders: ["crossref"],
          pdfStatus: pdfUrl ? "verified" : "unknown",
          doiVerified: Boolean(doi),
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
