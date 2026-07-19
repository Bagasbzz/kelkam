import { ProviderPaper, SearchOptions } from "./types";
import { fetchWithRetryAndCache } from "./provider-client";

const OPENALEX_BASE = "https://api.openalex.org/works";

/**
 * Search OpenAlex and normalize results into ProviderPaper[]
 * - query: search string (keywords/boolean)
 * - options: limit, yearFrom/yearTo, openAccessOnly
 *
 * Note: OpenAlex supports many filters; this adapter uses the `search` + `per-page` approach
 * for simplicity and then applies lightweight post-filtering.
 */
export async function searchOpenAlex(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const limit = Math.min(Number(options.limit || 6), 25);
  const url = new URL(OPENALEX_BASE);
  url.searchParams.set("search", String(query || ""));
  url.searchParams.set("per-page", String(limit));

  try {
    const json = await fetchWithRetryAndCache(url.toString(), {
      headers: { Accept: "application/json" },
    });

    const results = Array.isArray(json.results) ? json.results : [];

    const papers: ProviderPaper[] = results.map((r: any) => {
      const id = r.id || r.openalex_id || "";
      const title = r.title || "";
      const year = r.publication_year || null;
      const venue = r.host_venue?.display_name || r.host_venue?.publisher || null;
      const abstract = r.abstract_inverted_index ? Object.keys(r.abstract_inverted_index).join(" ") : r.abstract || null;
      const doi = r.doi || (r.ids && r.ids.doi) || null;
      const urlCanonical = r.primary_location?.url || r.id;
      const pdfUrl = r.primary_location?.url || null;
      const citationCount = r.cited_by_count || 0;
      const isOpenAccess = Boolean(r.open_access?.is_oa);
      const authors = Array.isArray(r.authorships) ? r.authorships.map((a: any) => a.author?.display_name).filter(Boolean) : [];

      return {
        id: String(id),
        title,
        authors,
        year,
        venue,
        abstract,
        url: urlCanonical,
        pdfUrl,
        doi,
        citationCount,
        isOpenAccess,
        source: "openalex",
        raw: r,
      } as ProviderPaper;
    });

    // post-filtering by year or OA if requested
    return papers.filter((paper) => {
      if (options.yearFrom && paper.year && paper.year < options.yearFrom) return false;
      if (options.yearTo && paper.year && paper.year > options.yearTo) return false;
      if (options.openAccessOnly && !paper.isOpenAccess) return false;
      return true;
    });
  } catch (error: any) {
    console.error("searchOpenAlex error:", error?.message || error);
    return [];
  }
}