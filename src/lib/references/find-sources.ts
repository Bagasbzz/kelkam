/**
 * src/lib/references/find-sources.ts
 * -----------------------------------------------------------------------------
 * Pencarian + verifikasi referensi yang bisa dipanggil langsung dari server
 * (asisten Laporan, job penulisan) maupun route /api/references/search.
 *
 * Prinsip kejujuran:
 *  - Hanya DOI yang lolos Crossref yang dianggap `doiVerified`.
 *  - `pdfStatus` berasal dari probe HTTP nyata (verify-pdf.ts).
 *  - Peringkat SINTA / Scimago Q tidak punya API publik gratis → TIDAK diklaim.
 *    Kami hanya memberi `qualitySignals` yang terverifikasi (DOAJ, ISSN, tipe
 *    sumber, sitasi, OA) + tautan cek manual ke Scimago/SINTA.
 */
import { searchSemanticScholar } from "./semantic-scholar";
import { searchOpenAlex } from "./openalex";
import { searchCrossref, verifyCrossrefDoi } from "./crossref";
import { verifyPdfUrls, type PdfStatus } from "./verify-pdf";
import type { ProviderPaper, SearchOptions } from "./types";

export type JournalRequirement =
  | "bebas"
  | "sinta-1-2"
  | "sinta-1-4"
  | "scopus-q1-q2"
  | "scopus-any"
  | "internasional-bereputasi";

export interface VerifiedSource {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string;
  abstract: string;
  url: string | null;
  pdfUrl: string | null;
  doi: string | null;
  doiUrl: string | null;
  doiVerified: boolean;
  pdfStatus: PdfStatus;
  citationCount: number;
  isOpenAccess: boolean;
  issn: string[];
  inDoaj: boolean;
  venueType: string | null;
  language: string | null;
  sourceProviders: string[];
  citationApa: string;
  /** Sinyal kualitas yang BENAR-BENAR terverifikasi (tanpa klaim tier). */
  qualitySignals: string[];
  /** Tautan untuk user mengecek sendiri peringkat jurnal. */
  checkLinks: { label: string; url: string }[];
  /** Seberapa isi yang kami baca: hanya abstrak (belum ada full-text ingest). */
  readLevel: "abstract" | "none";
}

export interface FindSourcesOptions extends SearchOptions {
  requirement?: JournalRequirement;
  /** Minimum DOI terverifikasi; default true (sumber tanpa DOI valid dibuang). */
  requireDoi?: boolean;
  /** Callback progres (untuk UI live). */
  onProgress?: (text: string) => void;
}

function normalizeDoi(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const doi = String(value).trim();
  if (!doi) return null;
  return doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").toLowerCase();
}

function normalizeTitle(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function titleSimilarity(a: string, b: string) {
  const wordsA = a.split(/\s+/).filter(Boolean);
  const wordsB = b.split(/\s+/).filter(Boolean);
  if (!wordsA.length || !wordsB.length) return 0;
  const setA = new Set(wordsA);
  const intersection = wordsB.filter((word) => setA.has(word)).length;
  const union = new Set([...wordsA, ...wordsB]).size || 1;
  return intersection / union;
}

export function mergeAndDeduplicate(
  papersList: ProviderPaper[][],
  preferredSourceOrder: string[] = ["semantic-scholar", "openalex", "crossref"],
) {
  const byKey = new Map<string, ProviderPaper>();
  const fingerprint = (paper: ProviderPaper) => {
    const doi = normalizeDoi(paper.doi);
    if (doi) return `doi:${doi}`;
    return `title:${normalizeTitle(paper.title)}::year:${paper.year ? String(paper.year) : ""}`;
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
          const storedYear = storedPaper.year ? String(storedPaper.year) : "";
          if (titleSimilarity(normalizedTitle, normalizeTitle(storedPaper.title)) >= 0.7 && (!storedYear || !year || storedYear === year)) {
            existing = storedPaper;
            break;
          }
        }
      }

      if (!existing) {
        byKey.set(key, { ...paper, sourceProviders: Array.from(new Set(paper.sourceProviders || (paper.source ? [paper.source] : []))) });
        continue;
      }

      const merged: ProviderPaper = { ...existing };
      if (!merged.doi && paper.doi) merged.doi = normalizeDoi(paper.doi) || paper.doi;
      if (!merged.pdfUrl && paper.pdfUrl) merged.pdfUrl = paper.pdfUrl;
      if (!merged.abstract && paper.abstract) merged.abstract = paper.abstract;
      if (!merged.url && paper.url) merged.url = paper.url;
      if (!merged.venue && paper.venue) merged.venue = paper.venue;
      if (!merged.authors?.length) merged.authors = paper.authors || [];
      if (!merged.issn?.length && paper.issn?.length) merged.issn = paper.issn;
      if (merged.inDoaj === undefined && paper.inDoaj !== undefined) merged.inDoaj = paper.inDoaj;
      if (!merged.venueType && paper.venueType) merged.venueType = paper.venueType;
      if (!merged.language && paper.language) merged.language = paper.language;
      if (!merged.pdfStatus || merged.pdfStatus === "unknown") merged.pdfStatus = paper.pdfStatus || merged.pdfStatus || "unknown";
      merged.doiVerified = Boolean(merged.doiVerified || paper.doiVerified);
      if (Number(paper.citationCount || 0) > Number(merged.citationCount || 0)) merged.citationCount = paper.citationCount;
      merged.isOpenAccess = Boolean(merged.isOpenAccess || paper.isOpenAccess);

      const existingIdx = preferredSourceOrder.indexOf(merged.source || "");
      const newIdx = preferredSourceOrder.indexOf(paper.source || "");
      if (newIdx >= 0 && (existingIdx === -1 || newIdx < existingIdx)) merged.source = paper.source;
      merged.sourceProviders = Array.from(new Set([...(merged.sourceProviders || []), ...(paper.sourceProviders || []), ...(paper.source ? [paper.source] : [])]));
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

export function toApaFromProvider(paper: ProviderPaper) {
  const authors = (paper.authors || []).slice(0, 5).join(", ");
  const year = paper.year || "n.d.";
  const title = paper.title || "Tanpa judul";
  const venue = paper.venue || "";
  const doi = normalizeDoi(paper.doi);
  return `${authors || "Penulis tidak tersedia"} (${year}). ${title}.${venue ? ` ${venue}.` : ""}${doi ? ` https://doi.org/${doi}` : ""}`;
}

function qualitySignals(p: ProviderPaper, pdfStatus: PdfStatus): string[] {
  const out: string[] = [];
  if (p.doiVerified) out.push("DOI terverifikasi Crossref");
  if (p.inDoaj) out.push("Terindeks DOAJ");
  if (p.venueType === "journal") out.push("Diterbitkan di jurnal");
  else if (p.venueType === "conference") out.push("Prosiding konferensi");
  else if (p.venueType === "repository") out.push("Repositori/preprint (belum tentu peer-review)");
  if (p.issn?.length) out.push(`ISSN ${p.issn[0]}`);
  if ((p.citationCount || 0) >= 50) out.push(`${p.citationCount} sitasi`);
  if (pdfStatus === "verified") out.push("PDF bisa diunduh");
  else if (pdfStatus === "landing_page") out.push("Halaman penerbit tersedia");
  return out;
}

function checkLinks(p: ProviderPaper): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  const issn = p.issn?.[0];
  const venue = (p.venue || "").trim();
  if (issn) {
    links.push({ label: "Cek Scimago (Q1–Q4)", url: `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(issn)}` });
    links.push({ label: "Cek SINTA", url: `https://sinta.kemdikbud.go.id/journals?q=${encodeURIComponent(issn)}` });
  } else if (venue) {
    links.push({ label: "Cek Scimago (Q1–Q4)", url: `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(venue)}` });
    links.push({ label: "Cek SINTA", url: `https://sinta.kemdikbud.go.id/journals?q=${encodeURIComponent(venue)}` });
  }
  return links;
}

/** Filter keras berdasarkan syarat yang bisa kami pastikan; tier dicek user via link. */
function passesRequirement(p: ProviderPaper, req: JournalRequirement | undefined) {
  if (!req || req === "bebas") return true;
  const isJournal = p.venueType === "journal" || (!p.venueType && Boolean(p.venue));
  if (!isJournal) return false;
  if (req === "sinta-1-2" || req === "sinta-1-4") {
    // SINTA mensyaratkan jurnal Indonesia; sinyal terbaik yang bisa dicek otomatis: DOAJ/ISSN.
    return Boolean(p.issn?.length) || Boolean(p.inDoaj);
  }
  if (req === "scopus-q1-q2" || req === "scopus-any" || req === "internasional-bereputasi") {
    return Boolean(p.issn?.length) && Boolean(p.doiVerified);
  }
  return true;
}

export async function findVerifiedSources(query: string, options: FindSourcesOptions = {}): Promise<VerifiedSource[]> {
  const limit = Math.min(Number(options.limit || 6), 25);
  const searchOptions: SearchOptions = {
    limit: Math.min(limit * 2, 25),
    yearFrom: options.yearFrom ?? null,
    yearTo: options.yearTo ?? null,
    openAccessOnly: Boolean(options.openAccessOnly),
  };
  const progress = options.onProgress ?? (() => {});
  const [ss, oa, cr] = await Promise.all([
    searchSemanticScholar(query, searchOptions),
    searchOpenAlex(query, searchOptions),
    searchCrossref(query, searchOptions),
  ]);
  const merged = mergeAndDeduplicate([ss, oa, cr]).filter((p) => p.title && (options.requireDoi === false || p.doi));
  progress(`${merged.length} kandidat (Semantic Scholar ${ss.length}, OpenAlex ${oa.length}, Crossref ${cr.length}) — memverifikasi DOI…`);

  const doiChecked = await Promise.all(
    merged.slice(0, Math.min(limit * 2, 20)).map(async (paper) => {
      if (!paper.doi) return paper;
      const check = await verifyCrossrefDoi(paper.doi);
      return {
        ...paper,
        doi: check.canonicalDoi || paper.doi,
        doiVerified: check.verified,
        url: paper.url || check.publisherUrl || null,
        pdfUrl: paper.pdfUrl || check.pdfUrl || null,
        venue: paper.venue || check.venue || "",
      };
    }),
  );

  const eligible = doiChecked
    .filter((p) => (options.requireDoi === false ? true : p.doiVerified))
    .filter((p) => passesRequirement(p, options.requirement))
    .sort((a, b) => Number(b.citationCount || 0) - Number(a.citationCount || 0))
    .slice(0, limit);

  progress(`${eligible.length} lolos verifikasi DOI & syarat jurnal — mengecek ketersediaan PDF…`);
  const pdfStatuses = await verifyPdfUrls(eligible.map((p) => p.pdfUrl));

  return eligible.map((p, i) => {
    const doi = normalizeDoi(p.doi);
    const pdfStatus = pdfStatuses[i];
    return {
      id: doi || p.id,
      title: p.title,
      authors: p.authors || [],
      year: p.year ?? null,
      venue: p.venue || "",
      abstract: p.abstract || "",
      url: p.url || (doi ? `https://doi.org/${doi}` : null),
      pdfUrl: pdfStatus === "verified" || pdfStatus === "landing_page" ? p.pdfUrl || null : null,
      doi,
      doiUrl: doi ? `https://doi.org/${doi}` : null,
      doiVerified: Boolean(p.doiVerified),
      pdfStatus,
      citationCount: Number(p.citationCount || 0),
      isOpenAccess: Boolean(p.isOpenAccess) || pdfStatus === "verified",
      issn: p.issn || [],
      inDoaj: Boolean(p.inDoaj),
      venueType: p.venueType || null,
      language: p.language || null,
      sourceProviders: p.sourceProviders || [],
      citationApa: toApaFromProvider(p),
      qualitySignals: qualitySignals(p, pdfStatus),
      checkLinks: checkLinks(p),
      readLevel: p.abstract ? "abstract" : "none",
    };
  });
}

export const JOURNAL_REQUIREMENT_LABEL: Record<JournalRequirement, string> = {
  "bebas": "Bebas (DOI valid)",
  "sinta-1-2": "SINTA 1–2 (jurnal Indonesia, ISSN/DOAJ; tier dicek user)",
  "sinta-1-4": "SINTA 1–4 (jurnal Indonesia, ISSN/DOAJ; tier dicek user)",
  "scopus-q1-q2": "Scopus Q1–Q2 (ISSN + DOI; kuartil dicek user via Scimago)",
  "scopus-any": "Scopus (ISSN + DOI; indeks dicek user)",
  "internasional-bereputasi": "Internasional bereputasi (ISSN + DOI; dicek user)",
};
