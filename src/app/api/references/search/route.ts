import { NextResponse } from "next/server";
import { searchSemanticScholar } from "@/lib/references/semantic-scholar";
import { searchOpenAlex } from "@/lib/references/openalex";
import { searchCrossref, verifyCrossrefDoi } from "@/lib/references/crossref";
import type { ProviderPaper } from "@/lib/references/types";
import { getErrorMessage } from "@/lib/errors";

function toApaFromProvider(paper: ProviderPaper) {
  const authors = (paper.authors || []).slice(0, 5).join(", ");
  const year = paper.year || "n.d.";
  const title = paper.title || "Tanpa judul";
  const venue = paper.venue || "";
  return `${authors || "Penulis tidak tersedia"} (${year}). ${title}.${venue ? ` ${venue}.` : ""}`;
}

function mergeAndDeduplicate(
  papersList: ProviderPaper[][],
  preferredSourceOrder: string[] = ["semantic-scholar", "openalex", "crossref"],
) {
  const byKey = new Map<string, ProviderPaper>();

  const normalizeDoi = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return null;
    const doi = String(value).trim();
    if (!doi) return null;
    return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
  };

  const normalizeTitle = (value: unknown) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const fingerprint = (paper: ProviderPaper) => {
    const doi = normalizeDoi(paper.doi);
    if (doi) return `doi:${doi}`;
    const title = normalizeTitle(paper.title);
    const year = paper.year ? String(paper.year) : "";
    return `title:${title}::year:${year}`;
  };

  const titleSimilarity = (a: string, b: string) => {
    const wordsA = a.split(/\s+/).filter(Boolean);
    const wordsB = b.split(/\s+/).filter(Boolean);
    if (!wordsA.length || !wordsB.length) return 0;
    const setA = new Set(wordsA);
    const intersection = wordsB.filter((word) => setA.has(word)).length;
    const union = new Set([...wordsA, ...wordsB]).size || 1;
    return intersection / union;
  };

  for (const papers of papersList) {
    for (const paper of papers) {
      const key = fingerprint(paper);
      let existing = byKey.get(key);

      if (!existing && !normalizeDoi(paper.doi)) {
        const normalizedTitle = normalizeTitle(paper.title);
        const year = paper.year ? String(paper.year) : "";
        for (const [storedKey, storedPaper] of byKey.entries()) {
          if (!storedKey.startsWith("title:")) continue;
          const storedTitle = normalizeTitle(storedPaper.title);
          const storedYear = storedPaper.year ? String(storedPaper.year) : "";
          const similarity = titleSimilarity(normalizedTitle, storedTitle);
          if (similarity >= 0.7 && (!storedYear || !year || storedYear === year)) {
            existing = storedPaper;
            break;
          }
        }
      }

      if (!existing) {
        byKey.set(key, {
          ...paper,
          sourceProviders: Array.from(
            new Set(paper.sourceProviders || (paper.source ? [paper.source] : [])),
          ),
        });
        continue;
      }

      const merged: ProviderPaper = { ...existing };
      if (!merged.doi && paper.doi) merged.doi = normalizeDoi(paper.doi) || paper.doi;
      if (!merged.pdfUrl && paper.pdfUrl) merged.pdfUrl = paper.pdfUrl;
      if (!merged.abstract && paper.abstract) merged.abstract = paper.abstract;
      if (!merged.url && paper.url) merged.url = paper.url;
      if (!merged.venue && paper.venue) merged.venue = paper.venue;
      if (!merged.authors?.length) merged.authors = paper.authors || [];
      if (!merged.pdfStatus || merged.pdfStatus === "unknown") {
        merged.pdfStatus = paper.pdfStatus || merged.pdfStatus || "unknown";
      }
      merged.doiVerified = Boolean(merged.doiVerified || paper.doiVerified);

      const existingCitations = Number(merged.citationCount || 0);
      const newCitations = Number(paper.citationCount || 0);
      if (newCitations > existingCitations) merged.citationCount = newCitations;

      merged.isOpenAccess = Boolean(merged.isOpenAccess || paper.isOpenAccess);

      const existingSourceIndex = preferredSourceOrder.indexOf(merged.source || "");
      const newSourceIndex = preferredSourceOrder.indexOf(paper.source || "");
      if (newSourceIndex >= 0 && (existingSourceIndex === -1 || newSourceIndex < existingSourceIndex)) {
        merged.source = paper.source;
      }

      merged.sourceProviders = Array.from(
        new Set([
          ...(merged.sourceProviders || []),
          ...(paper.sourceProviders || []),
          ...(paper.source ? [paper.source] : []),
        ]),
      );
      if (merged.raw !== undefined && paper.raw !== undefined) {
        merged.raw = Array.isArray(merged.raw) ? [...merged.raw, paper.raw] : [merged.raw, paper.raw];
      } else if (paper.raw !== undefined) {
        merged.raw = paper.raw;
      }

      const canonicalDoi = normalizeDoi(merged.doi);
      byKey.set(canonicalDoi ? `doi:${canonicalDoi}` : key, merged);
    }
  }

  return Array.from(byKey.values());
}

export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const { query, limit = 5, yearFrom = null, yearTo = null, openAccessOnly = false, providers = ["semantic-scholar", "openalex", "crossref"] } =
      (await req.json().catch(() => ({}))) as {
        query?: string;
        limit?: number;
        yearFrom?: number | null;
        yearTo?: number | null;
        openAccessOnly?: boolean;
        providers?: string[];
      };

    if (!query || !String(query).trim()) {
      return NextResponse.json({ success: false, error: "Query referensi tidak boleh kosong." }, { status: 400 });
    }

    const searchOptions = {
      limit: Math.min(Number(limit || 5), 25),
      yearFrom: yearFrom ? Number(yearFrom) : null,
      yearTo: yearTo ? Number(yearTo) : null,
      openAccessOnly: Boolean(openAccessOnly),
    };

    const calls: Promise<ProviderPaper[]>[] = [];
    if (providers.includes("semantic-scholar")) calls.push(searchSemanticScholar(query, searchOptions));
    if (providers.includes("openalex")) calls.push(searchOpenAlex(query, searchOptions));
    if (providers.includes("crossref")) calls.push(searchCrossref(query, searchOptions));

    const results = await Promise.all(calls);
    const merged = mergeAndDeduplicate(results, ["semantic-scholar", "openalex", "crossref"]);

    const limited = (merged || []).slice(0, Number(limit || 5));
    const verified = await Promise.all(
      limited.map(async (paper) => {
        if (!paper.doi) return paper;
        const doiCheck = await verifyCrossrefDoi(paper.doi);
        return {
          ...paper,
          doi: doiCheck.canonicalDoi || paper.doi,
          doiVerified: doiCheck.verified,
          url: paper.url || doiCheck.publisherUrl || null,
          pdfUrl: paper.pdfUrl || doiCheck.pdfUrl || null,
          venue: paper.venue || doiCheck.venue || "",
          pdfStatus: paper.pdfUrl || doiCheck.pdfUrl ? "verified" : paper.pdfStatus || "unknown",
        };
      })
    );

    const mapped = verified.map((p) => ({
      id: p.doi || p.id || p.title?.slice(0, 60) || Math.random().toString(36).slice(2, 9),
      title: p.title || "",
      authors: p.authors || [],
      year: p.year || null,
      venue: p.venue || "",
      abstract: p.abstract || "Abstrak tidak tersedia.",
      url: p.url || null,
      pdfUrl: p.pdfUrl || null,
      doi: p.doi || null,
      doiVerified: Boolean(p.doiVerified),
      pdfStatus: p.pdfStatus || (p.pdfUrl ? "verified" : "unknown"),
      citationCount: p.citationCount || 0,
      isOpenAccess: Boolean(p.isOpenAccess),
      source: p.source || null,
      sourceProviders: p.sourceProviders || (p.source ? [p.source] : []),
      citationApa: toApaFromProvider(p),
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: unknown) {
    console.error("API /api/references/search Error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, "Gagal mencari referensi.") },
      { status: 500 },
    );
  }
}
