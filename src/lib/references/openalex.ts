import { ProviderPaper, SearchOptions } from "./types";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import { getErrorMessage } from "@/lib/errors";

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

    const payload = isRecord(json) ? json : {};
    const results = Array.isArray(payload.results) ? payload.results.filter(isRecord) : [];

    const papers: ProviderPaper[] = results.map((r) => {
      const hostVenue = isRecord(r.host_venue) ? r.host_venue : {};
      const ids = isRecord(r.ids) ? r.ids : {};
      const primaryLocation = isRecord(r.primary_location) ? r.primary_location : {};
      const openAccess = isRecord(r.open_access) ? r.open_access : {};
      const id = r.id || r.openalex_id || "";
      const title = r.title || "";
      const year = r.publication_year || null;
      const venue = hostVenue.display_name || hostVenue.publisher || null;
      const abstract = isRecord(r.abstract_inverted_index) ? Object.keys(r.abstract_inverted_index).join(" ") : r.abstract || null;
      const doi = r.doi || ids.doi || null;
      const urlCanonical = primaryLocation.url || r.id;
      const pdfUrl = primaryLocation.url || null;
      const citationCount = r.cited_by_count || 0;
      const isOpenAccess = Boolean(openAccess.is_oa);
      const authors = Array.isArray(r.authorships)
        ? r.authorships
            .filter(isRecord)
            .map((authorship) => isRecord(authorship.author) ? authorship.author.display_name : "")
            .filter((author): author is string => typeof author === "string" && Boolean(author))
        : [];

      return {
        id: String(id),
        title: String(title),
        authors,
        year: typeof year === "number" ? year : null,
        venue: venue ? String(venue) : null,
        abstract: abstract ? String(abstract) : null,
        url: urlCanonical ? String(urlCanonical) : null,
        pdfUrl: pdfUrl ? String(pdfUrl) : null,
        doi: doi ? String(doi) : null,
        citationCount: Number(citationCount) || 0,
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
  } catch (error: unknown) {
    console.error("searchOpenAlex error:", getErrorMessage(error, "Unknown provider error"));
    return [];
  }
}
