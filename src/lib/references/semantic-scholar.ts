import { ProviderPaper, SearchOptions } from "./types";
import { fetchWithRetryAndCache } from "./provider-client";

const SEMANTIC_SCHOLAR_BASE = "https://api.semanticscholar.org/graph/v1/paper/search";

/**
 * Search Semantic Scholar and normalize results into ProviderPaper[]
 * - query: search string (boolean/keywords)
 * - options: limit, yearFrom/yearTo, openAccessOnly
 */
export async function searchSemanticScholar(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const limit = Math.min(Number(options.limit || 6), 20);
  const fields = [
    "title",
    "authors",
    "year",
    "venue",
    "url",
    "abstract",
    "openAccessPdf",
    "isOpenAccess",
    "externalIds",
    "citationCount",
    "publicationVenue",
  ].join(",");

  const url = new URL(SEMANTIC_SCHOLAR_BASE);
  url.searchParams.set("query", String(query || ""));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", fields);

  try {
    // use fetchWithRetryAndCache to handle retries, backoff, and caching
    const json = await fetchWithRetryAndCache(url.toString(), {
      headers: { Accept: "application/json" },
    });

    const data = Array.isArray(json.data) ? json.data : [];

    const papers: ProviderPaper[] = data.map((p: any) => ({
      id: p.paperId || p.paper_id || String(p.paperId || p.paper_id || ""),
      title: p.title || "",
      authors: Array.isArray(p.authors) ? p.authors.map((a: any) => a.name).filter(Boolean) : [],
      year: p.year || null,
      venue: p.venue || p.publicationVenue?.name || null,
      abstract: p.abstract || null,
      url: p.url || null,
      pdfUrl: p.openAccessPdf?.url || null,
      doi: p.externalIds?.DOI || null,
      citationCount: p.citationCount || 0,
      isOpenAccess: Boolean(p.isOpenAccess || p.openAccessPdf?.url),
      source: "semantic-scholar",
      raw: p,
    }));

    // optional filtering by year range or openAccessOnly
    return papers.filter((paper) => {
      if (options.yearFrom && paper.year && paper.year < options.yearFrom) return false;
      if (options.yearTo && paper.year && paper.year > options.yearTo) return false;
      if (options.openAccessOnly && !paper.isOpenAccess) return false;
      return true;
    });
  } catch (error: any) {
    console.error("searchSemanticScholar error:", error?.message || error);
    return [];
  }
}