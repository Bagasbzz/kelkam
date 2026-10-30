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
import { checkPdfUrls, type PdfStatus } from "./verify-pdf";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import type { ProviderPaper, SearchOptions } from "./types";
import { buildJournalCheckLinks, normalizeJournalIssns, type JournalVerification } from "./journal-check";

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
  /** Catatan peringkat manual, bila caller menyimpannya. Tidak pernah diisi otomatis. */
  journalVerification?: JournalVerification;
  /** Seberapa isi yang kami baca: teks penuh (PDF OA terunduh), abstrak, atau tidak ada. */
  readLevel: "fulltext" | "abstract" | "none";
  /** Skor relevansi 0-100 terhadap query (overlap kata kunci + kebaruan + sitasi). */
  relevance: number;
  /** Dipakai sebagai referensi penulisan? Default true; user/AI bisa mencentang. */
  selected?: boolean;
  /** Teks penuh hasil ekstraksi PDF (dipotong), hanya bila readLevel=fulltext. */
  fullText?: string;
  /** Jumlah karakter teks penuh asli sebelum dipotong. */
  fullTextChars?: number;
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
      merged.issn = normalizeJournalIssns([...(merged.issn || []), ...(paper.issn || [])]);
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
  return `${authors || "Penulis tidak tersedia"} (${year}). ${title}.${venue ? ` ${venue}.` : ""}${doi ? ` ${doiToUrl(doi)}` : ""}`;
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
  if (pdfStatus === "verified") out.push("Tautan PDF terverifikasi");
  else if (pdfStatus === "landing_page") out.push("Halaman penerbit tersedia");
  return out;
}

/** URL doi.org yang aman: tiap segmen di-encode (DOI boleh berisi <>#?;), "/" dipertahankan. */
export function doiToUrl(doi: string) {
  return `https://doi.org/${doi.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function checkLinks(p: ProviderPaper): { label: string; url: string }[] {
  return buildJournalCheckLinks({ venue: p.venue, issn: p.issn });
}

/**
 * Cari PDF open access legal via Unpaywall (berdasarkan DOI). Dipakai bila provider
 * utama tidak memberi pdfUrl. Butuh email kontak (syarat API Unpaywall).
 */
async function unpaywallPdf(doi: string): Promise<string | null> {
  const email = process.env.UNPAYWALL_EMAIL || process.env.CONTACT_EMAIL || "";
  if (!email) return null;
  try {
    const data = await fetchWithRetryAndCache(
      `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6_000) },
      1,
      300,
    );
    if (!isRecord(data)) return null;
    const best = isRecord(data.best_oa_location) ? data.best_oa_location : null;
    const locations = Array.isArray(data.oa_locations) ? data.oa_locations.filter(isRecord) : [];
    for (const loc of [best, ...locations]) {
      const url = loc && typeof loc.url_for_pdf === "string" ? loc.url_for_pdf : null;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
    return null;
  } catch {
    return null;
  }
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "into", "using", "based", "study", "analysis",
  "dan", "yang", "untuk", "dengan", "pada", "dari", "dalam", "terhadap", "atau", "oleh", "sebagai", "studi", "analisis", "sistem",
]);

function queryTerms(query: string) {
  return Array.from(new Set(
    query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  ));
}

/**
 * Skor 0-100: relevansi kata kunci (judul berbobot 2x, abstrak 1x) ~60%,
 * kebaruan tahun ~30%, sitasi (log) ~10%. Dipakai untuk urutan prioritas.
 */
export function scoreSource(p: ProviderPaper, terms: string[], nowYear = new Date().getFullYear()) {
  const title = normalizeTitle(p.title);
  const abstract = String(p.abstract || "").toLowerCase();
  let hit = 0;
  for (const term of terms) {
    if (title.includes(term)) hit += 2;
    else if (abstract.includes(term)) hit += 1;
  }
  const relevance = terms.length ? Math.min(1, hit / (terms.length * 2)) : 0.5;
  const age = p.year ? Math.max(0, nowYear - Number(p.year)) : 12;
  const recency = Math.max(0, 1 - age / 12); // 0 tahun = 1, >=12 tahun = 0
  const citations = Math.min(1, Math.log10(1 + Number(p.citationCount || 0)) / 3); // 1000 sitasi = 1
  return Math.round((relevance * 0.6 + recency * 0.3 + citations * 0.1) * 100);
}

/** Only narrow to journal candidates; ISSN/DOAJ cannot establish any requested rank. */
function passesRequirement(p: ProviderPaper, req: JournalRequirement | undefined) {
  if (!req || req === "bebas") return true;
  return p.venueType === "journal" || (!p.venueType && Boolean(p.venue));
}

export async function findVerifiedSources(query: string, options: FindSourcesOptions = {}): Promise<VerifiedSource[]> {
  const limit = Math.min(Number(options.limit || 6), 25);
  const searchOptions: SearchOptions = {
    limit: Math.min(limit * 3, 40),
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
  progress(`${merged.length} kandidat (Semantic Scholar ${ss.length}, OpenAlex ${oa.length}, Crossref ${cr.length}), memverifikasi DOI…`);

  // Urutkan dulu berdasarkan relevansi + kebaruan supaya kandidat terbaik yang diverifikasi.
  const terms = queryTerms(query);
  const ranked = merged
    .map((p) => ({ p, score: scoreSource(p, terms) }))
    .sort((a, b) => b.score - a.score);

  const doiChecked = await Promise.all(
    ranked.slice(0, Math.min(limit * 3, 30)).map(async ({ p: paper, score }) => {
      if (!paper.doi) return { paper, score };
      const check = await verifyCrossrefDoi(paper.doi);
      return {
        score,
        paper: {
          ...paper,
          doi: check.canonicalDoi || paper.doi,
          doiVerified: check.verified,
          url: paper.url || check.publisherUrl || null,
          pdfUrl: paper.pdfUrl || check.pdfUrl || null,
          venue: paper.venue || check.venue || "",
          issn: normalizeJournalIssns([...(paper.issn || []), ...(check.issn || [])]),
        },
      };
    }),
  );

  const eligibleRanked = doiChecked
    .filter(({ paper: p }) => (options.requireDoi === false ? true : p.doiVerified))
    .filter(({ paper: p }) => passesRequirement(p, options.requirement))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  progress(`${eligibleRanked.length} kandidat setelah pemeriksaan DOI${options.requirement && options.requirement !== "bebas" ? "; peringkat/indeks jurnal belum dikonfirmasi" : ""}, mengecek PDF open access…`);
  // Tahap 1: cek pdfUrl dari provider (sekaligus cari PDF asli bila ternyata landing page).
  let checks = await checkPdfUrls(eligibleRanked.map(({ paper }) => paper.pdfUrl));

  // Tahap 2: yang belum verified → coba Unpaywall (by DOI), lalu halaman penerbit (citation_pdf_url).
  const retry = eligibleRanked
    .map(({ paper }, i) => ({ paper, i }))
    .filter(({ i }) => checks[i].status !== "verified");
  if (retry.length) {
    const fallbackUrls = await Promise.all(retry.map(async ({ paper }) => {
      const doi = normalizeDoi(paper.doi);
      const oaPdf = doi ? await unpaywallPdf(doi) : null;
      if (oaPdf && oaPdf !== paper.pdfUrl) return oaPdf;
      return paper.url && paper.url !== paper.pdfUrl ? paper.url : null;
    }));
    const second = await checkPdfUrls(fallbackUrls);
    checks = checks.slice();
    retry.forEach(({ i }, k) => {
      if (second[k].status === "verified") checks[i] = second[k];
    });
  }

  return eligibleRanked.map(({ paper: p, score }, i) => {
    const doi = normalizeDoi(p.doi);
    const { status: pdfStatus, url: verifiedPdf } = checks[i];
    return {
      id: doi || p.id,
      title: p.title,
      authors: p.authors || [],
      year: p.year ?? null,
      venue: p.venue || "",
      abstract: p.abstract || "",
      url: p.url || (doi ? doiToUrl(doi) : null),
      // Hanya link yang benar-benar PDF; landing page tetap bisa dibuka lewat DOI/url.
      pdfUrl: pdfStatus === "verified" ? verifiedPdf || p.pdfUrl || null : null,
      doi,
      doiUrl: doi ? doiToUrl(doi) : null,
      doiVerified: Boolean(p.doiVerified),
      pdfStatus,
      citationCount: Number(p.citationCount || 0),
      isOpenAccess: Boolean(p.isOpenAccess) || pdfStatus === "verified",
      issn: normalizeJournalIssns(p.issn),
      inDoaj: Boolean(p.inDoaj),
      venueType: p.venueType || null,
      language: p.language || null,
      sourceProviders: p.sourceProviders || [],
      citationApa: toApaFromProvider(p),
      qualitySignals: qualitySignals(p, pdfStatus),
      checkLinks: checkLinks(p),
      readLevel: p.abstract ? "abstract" : "none",
      relevance: score,
      selected: true,
    };
  });
}

export const JOURNAL_REQUIREMENT_LABEL: Record<JournalRequirement, string> = {
  "bebas": "Bebas (DOI valid)",
  "sinta-1-2": "Target SINTA 1-2 (kandidat; akreditasi wajib dicek manual)",
  "sinta-1-4": "Target SINTA 1-4 (kandidat; akreditasi wajib dicek manual)",
  "scopus-q1-q2": "Target Scopus Q1-Q2 (indeks dan kuartil wajib dicek manual)",
  "scopus-any": "Target Scopus (indeks wajib dicek manual)",
  "internasional-bereputasi": "Target internasional bereputasi (wajib dicek manual)",
};
