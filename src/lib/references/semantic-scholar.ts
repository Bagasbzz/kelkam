import { ProviderPaper, SearchOptions } from "./types";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import { getErrorMessage } from "@/lib/errors";

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

    const payload = isRecord(json) ? json : {};
    const data = Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];

    const papers: ProviderPaper[] = data.map((paper) => {
      const publicationVenue = isRecord(paper.publicationVenue) ? paper.publicationVenue : {};
      const openAccessPdf = isRecord(paper.openAccessPdf) ? paper.openAccessPdf : {};
      const externalIds = isRecord(paper.externalIds) ? paper.externalIds : {};
      const authors = Array.isArray(paper.authors)
        ? paper.authors
            .filter(isRecord)
            .map((author) => author.name)
            .filter((author): author is string => typeof author === "string" && Boolean(author))
        : [];

      return {
        id: String(paper.paperId || paper.paper_id || ""),
        title: String(paper.title || ""),
        authors,
        year: typeof paper.year === "number" ? paper.year : null,
        venue: paper.venue ? String(paper.venue) : publicationVenue.name ? String(publicationVenue.name) : null,
        abstract: paper.abstract ? String(paper.abstract) : null,
        url: paper.url ? String(paper.url) : null,
        pdfUrl: openAccessPdf.url ? String(openAccessPdf.url) : null,
        doi: externalIds.DOI ? String(externalIds.DOI) : null,
        citationCount: Number(paper.citationCount) || 0,
        isOpenAccess: Boolean(paper.isOpenAccess || openAccessPdf.url),
        source: "semantic-scholar",
        raw: paper,
      };
    });

    // optional filtering by year range or openAccessOnly
    return papers.filter((paper) => {
      if (options.yearFrom && paper.year && paper.year < options.yearFrom) return false;
      if (options.yearTo && paper.year && paper.year > options.yearTo) return false;
      if (options.openAccessOnly && !paper.isOpenAccess) return false;
      return true;
    });
  } catch (error: unknown) {
    console.error("searchSemanticScholar error:", getErrorMessage(error, "Unknown provider error"));
    return [];
  }
}
