/**
 * src/lib/references/source-kind.ts
 * -----------------------------------------------------------------------------
 * Jenis sumber referensi (jurnal, buku, skripsi/preprint, dokumen resmi, web)
 * beserta label, klasifikasi dari metadata provider, dan sitasi APA per jenis.
 * Modul murni (tanpa I/O) sehingga aman dipakai di server maupun klien.
 */

export type SourceKind = "journal" | "book" | "thesis" | "official" | "web";

export const SOURCE_KINDS: SourceKind[] = ["journal", "book", "thesis", "official", "web"];

/** Jenis yang sudah bisa dicari otomatis. Dokumen resmi hanya laporan lembaga ber-DOI; regulasi & web menunggu API pencarian web (K14). */
export const SEARCHABLE_SOURCE_KINDS: SourceKind[] = ["journal", "book", "thesis", "official"];

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  journal: "Jurnal",
  book: "Buku",
  thesis: "Skripsi/preprint",
  official: "Resmi",
  web: "Web",
};

export const SOURCE_KIND_DESCRIPTION: Record<SourceKind, string> = {
  journal: "Artikel jurnal dan prosiding, DOI terverifikasi Crossref",
  book: "Buku dan bab buku, diverifikasi lewat DOI atau ISBN/katalog",
  thesis: "Skripsi, tesis, disertasi, dan preprint (belum tentu peer-review)",
  official: "Laporan lembaga, regulasi, dan dokumen resmi",
  web: "Artikel web dan berita dari situs tepercaya",
};

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === "string" && (SOURCE_KINDS as string[]).includes(value);
}

/** Normalisasi daftar jenis dari input AI/pengguna; hanya jenis yang bisa dicari. */
export function normalizeSourceKinds(value: unknown): SourceKind[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return Array.from(new Set(list.filter(isSourceKind))).filter((kind) => SEARCHABLE_SOURCE_KINDS.includes(kind));
}

/**
 * Tentukan jenis dari tipe publikasi provider (OpenAlex `type`, Crossref `type`,
 * Semantic Scholar `publicationTypes`) dan tipe venue OpenAlex.
 */
export function classifySourceKind(input: { publicationType?: string | null; venueType?: string | null }): SourceKind {
  const type = String(input.publicationType || "").toLowerCase();
  const venue = String(input.venueType || "").toLowerCase();
  if (/book|monograph|chapter|booksection/.test(type)) return "book";
  if (/dissertation|thesis/.test(type)) return "thesis";
  if (/preprint|posted-content/.test(type)) return "thesis";
  if (/^report|standard/.test(type)) return "official";
  if (venue === "ebook platform" || venue === "book series") return "book";
  if (venue === "repository") return "thesis";
  return "journal";
}

/** Jenis sumber yang tersimpan; sesi lama tanpa `kind` disimpulkan dari venueType. */
export function sourceKindOf(source: { kind?: unknown; venueType?: string | null; publicationType?: string | null }): SourceKind {
  if (isSourceKind(source.kind)) return source.kind;
  return classifySourceKind({ venueType: source.venueType, publicationType: source.publicationType });
}

/** Label rinci untuk tipe publikasi (dipakai di sitasi dan sinyal kualitas). */
export function publicationDetail(kind: SourceKind, publicationType?: string | null) {
  const type = String(publicationType || "").toLowerCase();
  if (kind === "book") return /chapter|section/.test(type) ? "Bab buku" : "Buku";
  if (kind === "thesis") return /dissertation|thesis/.test(type) ? "Tesis/disertasi" : "Preprint";
  if (kind === "official") return /standard/.test(type) ? "Standar" : "Laporan lembaga";
  if (kind === "web") return "Artikel web";
  return /proceedings|conference/.test(type) ? "Prosiding" : "Artikel jurnal";
}

export interface CitationInput {
  kind: SourceKind;
  publicationType?: string | null;
  authors: string[];
  year: number | string | null;
  title: string;
  venue?: string | null;
  publisher?: string | null;
  doiUrl?: string | null;
  url?: string | null;
}

/**
 * Sitasi gaya APA sesuai jenis sumber. Format jurnal sengaja sama dengan versi
 * sebelumnya agar sesi lama tetap konsisten.
 */
export function formatApaCitation(input: CitationInput) {
  const authors = input.authors.slice(0, 5).join(", ") || "Penulis tidak tersedia";
  const year = input.year || "n.d.";
  const title = input.title || "Tanpa judul";
  const venue = String(input.venue || "").trim();
  const publisher = String(input.publisher || "").trim();
  // Buku dan jurnal cukup DOI (APA 7); halaman katalog buku bukan bagian sitasi.
  const link = input.doiUrl || (input.kind === "thesis" || input.kind === "official" || input.kind === "web" ? input.url : null) || null;
  const tail = link ? ` ${link}` : "";
  const detail = publicationDetail(input.kind, input.publicationType);

  switch (input.kind) {
    case "book": {
      // APA: buku tanpa penulis (handbook/ensiklopedia suntingan) → judul di posisi penulis.
      const head = input.authors.length ? `${authors} (${year}). ${title}.` : `${title}. (${year}).`;
      if (detail === "Bab buku" && venue) {
        return `${head} Dalam ${venue}.${publisher && publisher !== venue ? ` ${publisher}.` : ""}${tail}`;
      }
      const pub = publisher || venue;
      return `${head}${pub ? ` ${pub}.` : ""}${tail}`;
    }
    case "thesis": {
      const place = venue || publisher;
      return `${authors} (${year}). ${title} [${detail}].${place ? ` ${place}.` : ""}${tail}`;
    }
    case "official":
    case "web": {
      const owner = input.authors.length ? authors : publisher || venue || "Lembaga tidak tersedia";
      const pub = input.authors.length ? publisher || venue : "";
      return `${owner} (${year}). ${title}.${pub ? ` ${pub}.` : ""}${tail}`;
    }
    default:
      return `${authors} (${year}). ${title}.${venue ? ` ${venue}.` : ""}${tail}`;
  }
}
