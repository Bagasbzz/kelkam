import { NextResponse } from "next/server";
import { searchSemanticScholar } from "@/lib/references/semantic-scholar";
import { searchOpenAlex } from "@/lib/references/openalex";
import { searchCrossref, verifyCrossrefDoi } from "@/lib/references/crossref";

function toApaFromProvider(paper: any) {
  const authors = (paper.authors || []).slice(0, 5).join(", ");
  const year = paper.year || "n.d.";
  const title = paper.title || "Tanpa judul";
  const venue = paper.venue || "";
  return `${authors || "Penulis tidak tersedia"} (${year}). ${title}.${venue ? ` ${venue}.` : ""}`;
}

function mergeAndDeduplicate(papersList: any[][], preferredSourceOrder: string[] = ["semantic-scholar", "openalex", "crossref"]) {
  const byKey = new Map<string, any>();

  const normalizeDoi = (d: any) => {
    if (!d) return null;
    try {
      const s = String(d).trim();
      return s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
    } catch {
      return String(d).toLowerCase();
    }
  };

  const normalizeTitle = (t: any) =>
    String(t || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const fingerprint = (p: any) => {
    const doi = normalizeDoi(p.doi);
    if (doi) return `doi:${doi}`;
    const t = normalizeTitle(p.title);
    const y = p.year ? String(p.year) : "";
    return `title:${t}::year:${y}`;
  };

  const titleSimilarity = (a: string, b: string) => {
    const wa = (a || "").split(/\s+/).filter(Boolean);
    const wb = (b || "").split(/\s+/).filter(Boolean);
    if (!wa.length || !wb.length) return 0;
    const setA = new Set(wa);
    const inter = wb.filter((w) => setA.has(w)).length;
    const union = new Set([...wa, ...wb]).size || 1;
    return inter / union;
  };

  for (const papers of papersList) {
    for (const p of papers) {
      const key = fingerprint(p);
      let existing = byKey.get(key);

      if (!existing && !normalizeDoi(p.doi)) {
        const tNorm = normalizeTitle(p.title);
        const y = p.year ? String(p.year) : "";
        for (const [k, v] of byKey.entries()) {
          if (!k.startsWith("title:")) continue;
          const existingTitle = normalizeTitle(v.title || "");
          const existingYear = v.year ? String(v.year) : "";
          const sim = titleSimilarity(tNorm, existingTitle);
          if (sim >= 0.7 && (existingYear === "" || y === "" || existingYear === y)) {
            existing = v;
            break;
          }
        }
      }

      if (!existing) {
        byKey.set(key, { ...p, sourceProviders: Array.from(new Set(p.sourceProviders || [p.source].filter(Boolean))) });
        continue;
      }

      const merged = { ...existing };
      if (!merged.doi && p.doi) merged.doi = normalizeDoi(p.doi) || p.doi;
      if (!merged.pdfUrl && p.pdfUrl) merged.pdfUrl = p.pdfUrl;
      if (!merged.abstract && p.abstract) merged.abstract = p.abstract;
      if (!merged.url && p.url) merged.url = p.url;
      if (!merged.venue && p.venue) merged.venue = p.venue;
      if (!merged.authors || merged.authors.length === 0) merged.authors = p.authors || [];
      if (!merged.pdfStatus || merged.pdfStatus === "unknown") merged.pdfStatus = p.pdfStatus || merged.pdfStatus || "unknown";
      merged.doiVerified = Boolean(merged.doiVerified || p.doiVerified);

      const existC = Number(merged.citationCount || 0);
      const newC = Number(p.citationCount || 0);
      if (newC > existC) merged.citationCount = newC;

      merged.isOpenAccess = Boolean(merged.isOpenAccess || p.isOpenAccess);

      const existSourceIdx = preferredSourceOrder.indexOf(merged.source || "");
      const pSourceIdx = preferredSourceOrder.indexOf(p.source || "");
      if (pSourceIdx >= 0 && (existSourceIdx === -1 || pSourceIdx < existSourceIdx)) {
        merged.source = p.source;
      }

      merged.sourceProviders = Array.from(
        new Set([...(merged.sourceProviders || []), ...(p.sourceProviders || []), ...(p.source ? [p.source] : [])])
      );
      merged.raw = merged.raw ? (Array.isArray(merged.raw) ? merged.raw.concat(p.raw) : [merged.raw, p.raw]) : p.raw;

      const newKey = normalizeDoi(merged.doi) ? `doi:${normalizeDoi(merged.doi)}` : key;
      byKey.set(newKey, merged);
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

    const calls: Promise<any[]>[] = [];
    if (providers.includes("semantic-scholar")) calls.push(searchSemanticScholar(query, searchOptions));
    if (providers.includes("openalex")) calls.push(searchOpenAlex(query, searchOptions));
    if (providers.includes("crossref")) calls.push(searchCrossref(query, searchOptions));

    const results = await Promise.all(calls);
    const merged = mergeAndDeduplicate(results, ["semantic-scholar", "openalex", "crossref"]);

    const limited = (merged || []).slice(0, Number(limit || 5));
    const verified = await Promise.all(
      limited.map(async (paper: any) => {
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

    const mapped = verified.map((p: any) => ({
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
  } catch (error: any) {
    console.error("API /api/references/search Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Gagal mencari referensi." }, { status: 500 });
  }
}
