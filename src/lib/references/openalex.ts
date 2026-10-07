import { ProviderPaper, SearchOptions } from "./types";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import { getErrorMessage } from "@/lib/errors";

const OPENALEX_BASE = "https://api.openalex.org/works";

/**
 * OpenAlex menyimpan abstrak sebagai inverted index { kata: [posisi,...] }.
 * Susun ulang berdasarkan posisi supaya urutan kalimat benar.
 */
function reconstructAbstract(index: Record<string, unknown>) {
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === "number") words.push([pos, word]);
    }
  }
  if (!words.length) return null;
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, word]) => word).join(" ");
}

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
      const bestOaLocation = isRecord(r.best_oa_location) ? r.best_oa_location : {};
      const openAccess = isRecord(r.open_access) ? r.open_access : {};
      const id = r.id || r.openalex_id || "";
      const title = r.title || "";
      const year = r.publication_year || null;
      const venue = hostVenue.display_name || hostVenue.publisher || null;
      const abstract = isRecord(r.abstract_inverted_index)
        ? reconstructAbstract(r.abstract_inverted_index)
        : r.abstract || null;
      const doi = r.doi || ids.doi || null;
      const urlCanonical = primaryLocation.landing_page_url || primaryLocation.url || r.id;
      // pdf_url benar-benar PDF; landing page BUKAN PDF.
      const pdfUrl = primaryLocation.pdf_url || bestOaLocation.pdf_url || openAccess.oa_url || null;
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
