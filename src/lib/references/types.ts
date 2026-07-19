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
  raw?: any;
}

export interface SearchOptions {
  limit?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccessOnly?: boolean;
  language?: "id" | "en" | "both";
}