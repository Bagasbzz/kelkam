export type DocumentType =
  | "task"
  | "paper"
  | "practicum"
  | "proposal"
  | "thesis"
  | "journal"
  | "project";

export interface DocumentProfile {
  documentType: DocumentType;
  academicTarget?: string; // e.g., "SINTA 1", "Tugas Kuliah", "Artikel Jurnal"
  targetPages?: number;
  targetWords?: number;
  citationStyle?: string; // "APA", "IEEE", etc
  referenceMin?: number;
  referenceMax?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  languagePreference?: "id" | "en" | "both";
  openAccessOnly?: boolean;
  nationalMinimum?: number;
  internationalMinimum?: number;
  institution?: string;
  course?: string;
  deadline?: string | null; // ISO date
}

export interface ResearchBrief {
  id?: string;
  title?: string;
  topic?: string;
  problemStatement?: string;
  objectives?: string[];
  constraints?: string;
  methodologyHint?: string;
  preferredKeywords?: string[];
  bannedKeywords?: string[];
  notes?: string;
  finalized?: boolean;
  updatedAt?: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: string;
}

export interface SearchQueryPlan {
  id?: string;
  group?: string; // theory, method, prior-work, novelty
  queries: string[]; // boolean or plain queries
  targetCount?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccessOnly?: boolean;
  language?: "id" | "en" | "both";
}

export interface AcademicReference {
  id: string; // local id
  doi?: string | null;
  title: string;
  authors?: string[];
  year?: number | null;
  venue?: string | null;
  abstract?: string | null;
  publisherUrl?: string | null;
  pdfUrl?: string | null;
  pdfStatus?: "verified" | "landing_page" | "closed" | "broken" | "unknown";
  openAccess?: boolean;
  citationCount?: number;
  sourceProviders?: string[]; // e.g., ["semantic-scholar","openalex"]
  normalized?: boolean;
  relevanceScore?: number;
  relevanceReasons?: string[];
  selected?: boolean;
  createdAt?: string;
  raw?: any; // raw provider payload (JSONB)
}

export interface EvidenceItem {
  id: string;
  referenceId: string;
  claimType?: string; // background, method-support, comparison, limitation
  statement: string;
  evidenceText?: string;
  page?: number | null;
  confidence?: number; // 0..1
  sectionIds?: string[]; // which report sections this evidence maps to
  createdAt?: string;
}

export interface ReportSectionBrief {
  id: string;
  title: string;
  purpose?: string;
  targetWords?: number;
  requiredClaimIds?: string[]; // evidence ids
  allowedReferenceIds?: string[];
  requiredDataIds?: string[];
  status?: "planned" | "draft" | "review" | "approved";
  content?: string; // generated content (markdown)
}

export interface ResearchProject {
  id: string;
  ownerId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  documentProfile: DocumentProfile;
  researchBrief: ResearchBrief;
  conversationSummary?: string; // short summary of chat/brief
  chatHistory?: ChatMessage[];
  searchPlan?: SearchQueryPlan[];
  references?: AcademicReference[]; // library for project
  evidenceMatrix?: EvidenceItem[];
  noveltyCandidates?: { id: string; text: string; supportingReferenceIds: string[] }[];
  selectedNoveltyId?: string | null;
  outline?: ReportSectionBrief[];
  citationMap?: Record<string, string[]>; // sectionId -> referenceIds
  diagrams?: { id: string; type: string; title?: string; caption?: string; approved?: boolean; diagramData?: any }[];
  tables?: { id: string; title?: string; purpose?: string; columns?: string[]; status?: string }[];
  sections?: ReportSectionBrief[];
  documentSettings?: any;
  workflowStage?: "intake" | "planned" | "searching" | "evidence" | "drafting" | "review" | "exported";
  qualityReport?: { errors: string[]; warnings: string[]; checkedAt?: string } | null;
  metadata?: Record<string, any>;
}