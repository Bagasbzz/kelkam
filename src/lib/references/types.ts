export interface ProviderPaper {
  id: string;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  url?: string | null;
  pdfUrl?: string | null;
  doi?: string | null;
  citationCount?: number | null;
  isOpenAccess?: boolean;
  source?: string;
  sourceProviders?: string[];
  pdfStatus?: "verified" | "landing_page" | "closed" | "broken" | "unknown";
  doiVerified?: boolean;
  /** Metadata jurnal/penerbit untuk penilaian kualitas sumber. */
  issn?: string[];
  inDoaj?: boolean;
  /** journal | conference | repository | book | other */
  venueType?: string | null;
  publicationType?: string | null;
  language?: string | null;
  raw?: unknown;
}

export interface SearchOptions {
  limit?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccessOnly?: boolean;
  language?: "id" | "en" | "both";
}
