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
import { searchBooks } from "./books";
import { checkPdfUrls, type PdfStatus } from "./verify-pdf";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import type { ProviderPaper, SearchOptions } from "./types";
import { buildJournalCheckLinks, normalizeJournalIssns, type JournalVerification } from "./journal-check";
import type { JournalVerificationResult } from "./journal-verifier";
import { classifySourceKind, formatApaCitation, normalizeSourceKinds, publicationDetail, type SourceKind } from "./source-kind";

export type { SourceKind } from "./source-kind";

/** Cara sumber diverifikasi; tiap jenis punya bukti berbeda. */
export type SourceVerificationMethod = "crossref-doi" | "google-books-isbn" | "open-library" | "openalex";

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
  /** Hasil provider otomatis; terpisah dari catatan manual user. */
  journalVerificationResult?: JournalVerificationResult;
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
  /** Jenis sumber. Sesi lama tidak punya field ini; pakai `sourceKindOf`. */
  kind?: SourceKind;
  /** Tipe publikasi mentah dari provider (mis. book-chapter, dissertation). */
  publicationType?: string | null;
  publisher?: string | null;
  isbn?: string[];
  /** Lolos verifikasi sesuai jenisnya (DOI Crossref, ISBN, atau katalog). */
  verified?: boolean;
  verifiedBy?: SourceVerificationMethod;
}

export interface FindSourcesOptions extends SearchOptions {
  requirement?: JournalRequirement;
  /** Minimum DOI terverifikasi; default true (sumber tanpa DOI valid dibuang). */
  requireDoi?: boolean;
  /** Jenis sumber yang dicari. Kosong = campuran bawaan (jurnal mayoritas). */
  kinds?: SourceKind[];
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
      if (!merged.publisher && paper.publisher) merged.publisher = paper.publisher;
      if (!merged.publicationType && paper.publicationType) merged.publicationType = paper.publicationType;
      if (paper.isbn?.length) merged.isbn = Array.from(new Set([...(merged.isbn || []), ...paper.isbn]));
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

function qualitySignals(p: ProviderPaper, pdfStatus: PdfStatus, kind: SourceKind = "journal", verifiedBy?: SourceVerificationMethod): string[] {
  const out: string[] = [];
  const detail = publicationDetail(kind, p.publicationType);
  if (p.doiVerified) out.push("DOI terverifikasi Crossref");
  if (verifiedBy === "google-books-isbn" && p.isbn?.length) out.push(`ISBN ${p.isbn[0]} (Google Books)`);
  else if (verifiedBy === "open-library") out.push("Tercatat di katalog Open Library");
  else if (verifiedBy === "openalex") out.push("Tercatat di OpenAlex");
  if (kind === "book") out.push(detail);
  else if (kind === "thesis") out.push(`${detail} (belum tentu peer-review)`);
  else if (kind === "official") out.push(detail);
  if (p.inDoaj) out.push("Terindeks DOAJ");
  if (kind === "journal") {
    if (p.venueType === "journal") out.push("Diterbitkan di jurnal");
    else if (p.venueType === "conference") out.push("Prosiding konferensi");
  }
  if (p.issn?.length && kind === "journal") out.push(`ISSN ${p.issn[0]}`);
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

/**
 * Syarat SINTA/Scopus hanya menyaring kandidat JURNAL; ISSN/DOAJ tidak membuktikan
 * peringkat. Buku/laporan tidak terkena syarat ini.
 */
function passesRequirement(p: ProviderPaper, kind: SourceKind, req: JournalRequirement | undefined) {
  if (!req || req === "bebas" || kind !== "journal") return true;
  return p.venueType === "journal" || (!p.venueType && Boolean(p.venue));
}

/** Campuran bawaan: syarat jurnal ketat → tanpa preprint/skripsi. */
function defaultKinds(req: JournalRequirement | undefined): SourceKind[] {
  return !req || req === "bebas" ? ["journal", "book", "thesis", "official"] : ["journal", "book"];
}

function isFrom(p: ProviderPaper, provider: string) {
  return p.source === provider || Boolean(p.sourceProviders?.includes(provider));
}

/** Bukti verifikasi per jenis; null = tidak lolos. */
function verificationOf(p: ProviderPaper, kind: SourceKind): SourceVerificationMethod | null {
  if (p.doiVerified) return "crossref-doi";
  // DOI DataCite (arXiv, Zenodo, repositori kampus) tidak ada di Crossref; cukup tercatat di OpenAlex.
  if (kind === "thesis" && isFrom(p, "openalex") && p.url) return "openalex";
  if (p.doi) return null;
  if (kind === "book" && isFrom(p, "google-books") && p.isbn?.length) return "google-books-isbn";
  if (kind === "book" && isFrom(p, "open-library")) return "open-library";
  return null;
}

type Candidate = { paper: ProviderPaper; kind: SourceKind; score: number };

/**
 * Jurnal tetap mayoritas saat campuran: tiap jenis non-jurnal maks. ±1/4 limit,
 * total non-jurnal maks. 40%. Sisa kuota diisi kandidat berikutnya bila jurnal kurang.
 */
function pickWithQuota<T extends Candidate>(items: T[], kinds: SourceKind[], limit: number): T[] {
  if (kinds.length === 1 || !kinds.includes("journal")) return items.slice(0, limit);
  const perKind = Math.max(1, Math.round(limit / 4));
  const nonJournalCap = Math.max(1, Math.floor(limit * 0.4));
  const counts = new Map<SourceKind, number>();
  let nonJournal = 0;
  const picked: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (picked.length >= limit) break;
    if (item.kind === "journal") { picked.push(item); continue; }
    const count = counts.get(item.kind) || 0;
    if (count < perKind && nonJournal < nonJournalCap) {
      counts.set(item.kind, count + 1);
      nonJournal += 1;
      picked.push(item);
    } else {
      rest.push(item);
    }
  }
  for (const item of rest) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  return picked.sort((a, b) => b.score - a.score);
}

export async function findVerifiedSources(query: string, options: FindSourcesOptions = {}): Promise<VerifiedSource[]> {
  const limit = Math.min(Number(options.limit || 6), 25);
  const requested = normalizeSourceKinds(options.kinds);
  const kinds = requested.length ? requested : defaultKinds(options.requirement);
  const searchOptions: SearchOptions = {
    limit: Math.min(limit * 3, 40),
    yearFrom: options.yearFrom ?? null,
    yearTo: options.yearTo ?? null,
    openAccessOnly: Boolean(options.openAccessOnly),
  };
  const progress = options.onProgress ?? (() => {});
  const wantsBooks = kinds.includes("book");
  const [ss, oa, cr, books] = await Promise.all([
    searchSemanticScholar(query, searchOptions),
    searchOpenAlex(query, searchOptions),
    searchCrossref(query, searchOptions),
    wantsBooks && !options.openAccessOnly ? searchBooks(query, { ...searchOptions, limit: Math.min(limit * 2, 20) }) : Promise.resolve([] as ProviderPaper[]),
  ]);
  const terms = queryTerms(query);
  const candidates: Candidate[] = mergeAndDeduplicate([ss, oa, cr, books])
    .filter((p) => p.title)
    // Ulasan buku di majalah Choice (DOI 10.5860/choice.*) bukan buku itu sendiri.
    .filter((p) => !/^10\.5860\/choice/i.test(normalizeDoi(p.doi) || ""))
    .map((p) => ({ paper: p, kind: classifySourceKind(p), score: scoreSource(p, terms) }))
    // Tahap awal: hanya jenis yang diminta (tipe bisa diperjelas Crossref nanti) dan punya identitas yang bisa dicek.
    .filter(({ paper: p, kind }) => options.requireDoi === false || p.doi || kind === "book" || kind === "thesis")
    .sort((a, b) => b.score - a.score);
  progress(`${candidates.length} kandidat (Semantic Scholar ${ss.length}, OpenAlex ${oa.length}, Crossref ${cr.length}${wantsBooks ? `, katalog buku ${books.length}` : ""}), memverifikasi DOI/ISBN…`);

  // Verifikasi DOI hanya untuk kandidat teratas yang ber-DOI (maks. 30 panggilan Crossref).
  const topCandidates = candidates.slice(0, Math.min(limit * 5, 60));
  let doiBudget = Math.min(limit * 3, 30);
  const checked = await Promise.all(
    topCandidates.map(async (candidate): Promise<Candidate | null> => {
      const paper = candidate.paper;
      if (!paper.doi) return candidate;
      if (doiBudget <= 0) return null;
      doiBudget -= 1;
      const check = await verifyCrossrefDoi(paper.doi);
      const crossrefKind = check.type ? classifySourceKind({ publicationType: check.type }) : "journal";
      const kind = crossrefKind !== "journal" ? crossrefKind : candidate.kind;
      // Bab buku: judul buku ada di container-title Crossref; OpenAlex sering hanya memberi nama platform ("Springer eBooks").
      const platformVenue = /\be-?books?$/i.test(String(paper.venue || ""));
      const venue = kind === "book" && check.venue ? check.venue : platformVenue ? "" : paper.venue || check.venue || "";
      return {
        score: candidate.score,
        // Tipe Crossref (book-chapter, dissertation, posted-content, report) memperjelas jenis.
        kind,
        paper: {
          ...paper,
          doi: check.canonicalDoi || paper.doi,
          doiVerified: check.verified,
          url: paper.url || check.publisherUrl || null,
          pdfUrl: paper.pdfUrl || check.pdfUrl || null,
          venue,
          publisher: paper.publisher || check.publisher || null,
          publicationType: crossrefKind !== "journal" ? check.type : paper.publicationType || check.type,
          issn: normalizeJournalIssns([...(paper.issn || []), ...(check.issn || [])]),
        },
      };
    }),
  );

  const eligible = checked
    .filter((c): c is Candidate => Boolean(c))
    .filter(({ kind }) => kinds.includes(kind))
    .map((c) => ({ ...c, verifiedBy: verificationOf(c.paper, c.kind) }))
    .filter(({ verifiedBy }) => options.requireDoi === false || Boolean(verifiedBy))
    .filter(({ paper: p, kind }) => passesRequirement(p, kind, options.requirement))
    .sort((a, b) => b.score - a.score);
  const eligibleRanked = pickWithQuota(eligible, kinds, limit);

  const kindSummary = kinds.length > 1
    ? ` (${eligibleRanked.filter((c) => c.kind === "journal").length} jurnal, ${eligibleRanked.filter((c) => c.kind === "book").length} buku, ${eligibleRanked.filter((c) => c.kind === "thesis").length} skripsi/preprint)`
    : "";
  progress(`${eligibleRanked.length} kandidat lolos verifikasi${kindSummary}${options.requirement && options.requirement !== "bebas" ? "; peringkat/indeks jurnal belum dikonfirmasi" : ""}, mengecek PDF open access…`);
  // Tahap 1: cek pdfUrl dari provider (sekaligus cari PDF asli bila ternyata landing page).
  let checks = await checkPdfUrls(eligibleRanked.map(({ paper }) => paper.pdfUrl));

  // Tahap 2: yang belum verified → coba Unpaywall (by DOI), lalu halaman penerbit (citation_pdf_url).
  // Halaman katalog buku (Google Books/Open Library) bukan PDF, jadi dilewati.
  const retry = eligibleRanked
    .map(({ paper, verifiedBy }, i) => ({ paper, verifiedBy, i }))
    .filter(({ i, verifiedBy }) => checks[i].status !== "verified" && verifiedBy !== "google-books-isbn" && verifiedBy !== "open-library");
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

  return eligibleRanked.map(({ paper: p, score, kind, verifiedBy }, i) => {
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
      citationApa: formatApaCitation({
        kind,
        publicationType: p.publicationType,
        authors: p.authors || [],
        year: p.year ?? null,
        title: p.title,
        venue: p.venue,
        publisher: p.publisher,
        doiUrl: doi ? doiToUrl(doi) : null,
        url: p.url,
      }),
      qualitySignals: qualitySignals(p, pdfStatus, kind, verifiedBy || undefined),
      checkLinks: kind === "journal" ? checkLinks(p) : [],
      readLevel: p.abstract ? "abstract" : "none",
      relevance: score,
      selected: true,
      kind,
      publicationType: p.publicationType || null,
      publisher: p.publisher || null,
      isbn: p.isbn || [],
      verified: Boolean(verifiedBy),
      verifiedBy: verifiedBy || undefined,
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
