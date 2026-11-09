/**
 * src/lib/references/books.ts
 * -----------------------------------------------------------------------------
 * Pencarian buku: Google Books (utama, metadata per edisi + ISBN) dan
 * Open Library (cadangan bila Google Books kosong/kena kuota).
 *
 * Verifikasi buku: tercatat di katalog dengan ISBN (Google Books) atau
 * tercatat sebagai karya di katalog Open Library. Tidak ada klaim isi dibaca;
 * yang tersedia hanya deskripsi penerbit.
 */
import { getErrorMessage } from "@/lib/errors";
import { fetchWithRetryAndCache, isRecord } from "./provider-client";
import type { ProviderPaper, SearchOptions } from "./types";

const GOOGLE_BOOKS_BASE = "https://www.googleapis.com/books/v1/volumes";
const OPEN_LIBRARY_BASE = "https://openlibrary.org/search.json";

function str(value: unknown, max = 400) {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

function strList(value: unknown, max = 20) {
  return Array.isArray(value) ? value.map((v) => str(v, 200)).filter(Boolean).slice(0, max) : [];
}

function yearOf(value: unknown) {
  const match = /\b(1[5-9]\d{2}|20\d{2})\b/.exec(String(value ?? ""));
  return match ? Number(match[1]) : null;
}

export function normalizeIsbn(value: unknown) {
  const isbn = String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
  return isbn.length === 13 || isbn.length === 10 ? isbn : null;
}

function withinYears(year: number | null, options: SearchOptions) {
  if (options.yearFrom && year && year < options.yearFrom) return false;
  if (options.yearTo && year && year > options.yearTo) return false;
  return true;
}

function safeHttpsUrl(value: unknown) {
  const raw = str(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw.replace(/^http:\/\//i, "https://"));
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function searchGoogleBooks(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 40);
  const url = new URL(GOOGLE_BOOKS_BASE);
  url.searchParams.set("q", String(query || ""));
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("printType", "books");
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (key) url.searchParams.set("key", key);

  try {
    const json = await fetchWithRetryAndCache(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }, 1, 400);
    const items = isRecord(json) && Array.isArray(json.items) ? json.items.filter(isRecord) : [];
    const books: ProviderPaper[] = [];
    for (const item of items) {
      const info = isRecord(item.volumeInfo) ? item.volumeInfo : {};
      const ids = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers.filter(isRecord) : [];
      const isbn13 = ids.filter((id) => id.type === "ISBN_13").map((id) => normalizeIsbn(id.identifier)).filter((v): v is string => Boolean(v));
      const isbn10 = ids.filter((id) => id.type === "ISBN_10").map((id) => normalizeIsbn(id.identifier)).filter((v): v is string => Boolean(v));
      const isbn = [...isbn13, ...isbn10];
      const baseTitle = str(info.title, 300);
      const subtitle = str(info.subtitle, 200);
      const authors = strList(info.authors);
      const publisher = str(info.publisher, 200) || null;
      const year = yearOf(info.publishedDate);
      // Tanpa ISBN tidak bisa diverifikasi sebagai buku terbitan; tanpa penulis/penerbit tidak bisa disitasi.
      if (!baseTitle || !isbn.length || (!authors.length && !publisher)) continue;
      if (!withinYears(year, options)) continue;
      books.push({
        id: `isbn:${isbn[0]}`,
        title: subtitle ? `${baseTitle}: ${subtitle}` : baseTitle,
        authors,
        year,
        venue: null,
        publisher,
        isbn,
        abstract: str(info.description, 2000) || null,
        url: safeHttpsUrl(info.canonicalVolumeLink) || safeHttpsUrl(info.infoLink),
        pdfUrl: null,
        doi: null,
        citationCount: 0,
        isOpenAccess: false,
        venueType: "book",
        publicationType: "book",
        language: str(info.language, 10) || null,
        source: "google-books",
        sourceProviders: ["google-books"],
        pdfStatus: "unknown",
        doiVerified: false,
      });
    }
    return books;
  } catch (error: unknown) {
    console.error("searchGoogleBooks error:", getErrorMessage(error, "Unknown provider error"));
    return [];
  }
}

export async function searchOpenLibrary(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const limit = Math.min(Math.max(Number(options.limit || 10), 1), 30);
  const url = new URL(OPEN_LIBRARY_BASE);
  url.searchParams.set("q", String(query || ""));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("fields", "key,title,subtitle,author_name,first_publish_year,publisher,language");

  try {
    const json = await fetchWithRetryAndCache(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }, 1, 400);
    const docs = isRecord(json) && Array.isArray(json.docs) ? json.docs.filter(isRecord) : [];
    const books: ProviderPaper[] = [];
    for (const doc of docs) {
      const key = str(doc.key, 80);
      const baseTitle = str(doc.title, 300);
      const subtitle = str(doc.subtitle, 200);
      const authors = strList(doc.author_name);
      const publisher = strList(doc.publisher, 1)[0] || null;
      const year = typeof doc.first_publish_year === "number" ? doc.first_publish_year : null;
      if (!/^\/works\/OL\d+W$/.test(key) || !baseTitle || !authors.length) continue;
      if (!withinYears(year, options)) continue;
      books.push({
        id: `openlibrary:${key.slice("/works/".length)}`,
        title: subtitle ? `${baseTitle}: ${subtitle}` : baseTitle,
        authors,
        year,
        venue: null,
        publisher,
        isbn: [],
        abstract: null,
        url: `https://openlibrary.org${key}`,
        pdfUrl: null,
        doi: null,
        citationCount: 0,
        isOpenAccess: false,
        venueType: "book",
        publicationType: "book",
        language: strList(doc.language, 1)[0] || null,
        source: "open-library",
        sourceProviders: ["open-library"],
        pdfStatus: "unknown",
        doiVerified: false,
      });
    }
    return books;
  } catch (error: unknown) {
    console.error("searchOpenLibrary error:", getErrorMessage(error, "Unknown provider error"));
    return [];
  }
}

/** Google Books dulu; Open Library hanya bila Google Books tidak memberi hasil. */
export async function searchBooks(query: string, options: SearchOptions = {}): Promise<ProviderPaper[]> {
  const google = await searchGoogleBooks(query, options);
  if (google.length) return google;
  return searchOpenLibrary(query, options);
}
