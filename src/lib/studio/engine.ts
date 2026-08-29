export const STUDIO_SCHEMA_VERSION = 1 as const;

export type ProjectType =
  | "thesis"
  | "proposal"
  | "capstone"
  | "course"
  | "practicum"
  | "paper"
  | "formal";

export type SourceKind =
  | "lecturer_request"
  | "campus_guide"
  | "template"
  | "example"
  | "code"
  | "dataset"
  | "reference"
  | "brief"
  | "note";

export type SourceAuthority =
  | "binding"
  | "primary"
  | "supporting"
  | "example_only"
  | "unverified";

export type QuestionCategory =
  | "identity"
  | "scope"
  | "actors"
  | "requirements"
  | "flow"
  | "exceptions"
  | "data"
  | "method"
  | "format"
  | "citation"
  | "lecturer"
  | "conflict";

export type QuestionClass = "blocker" | "important" | "enrichment";
export type QuestionStatus = "unanswered" | "answered" | "waived";
export type DecisionStatus =
  | "suggested"
  | "draft"
  | "confirmed"
  | "locked"
  | "superseded"
  | "rejected";
export type ArtifactStatus =
  | "not_started"
  | "draft"
  | "stale"
  | "ready"
  | "approved"
  | "locked";
export type ReadinessStage =
  | "intake"
  | "clarifying"
  | "specified"
  | "production"
  | "preflight"
  | "ready";

export interface StudioIntake {
  projectType: ProjectType;
  title: string;
  topic: string;
  institution: string;
  faculty: string;
  program: string;
  course: string;
  lecturer: string;
  deadline: string;
  objective: string;
  problem: string;
  existingState: string;
  expectedOutput: string;
  language: "id" | "en";
}

export interface StudioSource {
  id: string;
  kind: SourceKind;
  authority: SourceAuthority;
  title: string;
  content: string;
  fileName?: string;
  provenance?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioQuestion {
  id: string;
  key: string;
  category: QuestionCategory;
  class: QuestionClass;
  prompt: string;
  why: string;
  answerHint: string;
  options?: string[];
  status: QuestionStatus;
  answer: string;
  waiverReason?: string;
  priority: number;
  affectedArtifactIds: string[];
  sourceIds: string[];
  origin: "system" | "ai" | "user";
  createdAt: string;
  updatedAt: string;
}

export interface DecisionHistoryEntry {
  version: number;
  value: string;
  status: DecisionStatus;
  changedAt: string;
  reason?: string;
}

export interface StudioDecision {
  id: string;
  key: string;
  category: QuestionCategory;
  statement: string;
  value: string;
  rationale: string;
  status: DecisionStatus;
  origin: "question" | "source" | "ai" | "user" | "legacy";
  questionId?: string;
  sourceIds: string[];
  affectedArtifactIds: string[];
  version: number;
  history: DecisionHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface SpecificationActor {
  name: string;
  responsibility: string;
}

export interface ProjectSpecification {
  version: number;
  compiledAt: string;
  title: string;
  projectType: ProjectType;
  objective: string;
  problem: string;
  scopeIn: string[];
  scopeOut: string[];
  actors: SpecificationActor[];
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  businessRules: string[];
  normalFlows: string[];
  exceptionFlows: string[];
  entities: string[];
  methodology: string[];
  citationRules: string[];
  lecturerRequests: string[];
  formatConstraints: string[];
  bindingSources: string[];
  unresolvedBlockers: string[];
  assumptions: string[];
}

export interface ArtifactValidationIssue {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface StudioArtifact {
  id: string;
  kind:
    | "specification"
    | "requirements"
    | "actor_matrix"
    | "uml"
    | "test_cases"
    | "outline"
    | "report"
    | "format_profile"
    | "document";
  title: string;
  description: string;
  status: ArtifactStatus;
  dependencyIds: string[];
  decisionIds: string[];
  currentVersion: number;
  approvedVersion?: number;
  lockedAt?: string;
  generatedAt?: string;
  updatedAt: string;
  validationIssues: ArtifactValidationIssue[];
  payload?: unknown;
}

export interface FormatProfile {
  presetName: string;
  paperSize: "A4" | "Letter";
  margins: { top: number; right: number; bottom: number; left: number };
  fontFamily: string;
  bodyFontSize: number;
  heading1FontSize: number;
  heading2FontSize: number;
  lineSpacing: number;
  paragraphIndent: number;
  alignment: "justify" | "left";
  citationStyle: "APA 7" | "IEEE" | "Harvard" | "Vancouver" | "Other";
  pageNumbering: string;
  requiredSections: string[];
  sourceId?: string;
}

export interface FormatIssue {
  id: string;
  severity: "error" | "warning" | "info";
  field: string;
  message: string;
  fix: string;
}

export interface ReadinessBreakdown {
  intake: number;
  clarification: number;
  specification: number;
  artifacts: number;
  format: number;
}

export interface StudioReadiness {
  score: number;
  stage: ReadinessStage;
  breakdown: ReadinessBreakdown;
  blockerCount: number;
  staleArtifactCount: number;
  formatErrorCount: number;
  nextActions: string[];
}

export interface StudioProject {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  importedFromLegacy: boolean;
  intake: StudioIntake;
  sources: StudioSource[];
  questions: StudioQuestion[];
  decisions: StudioDecision[];
  specification: ProjectSpecification;
  artifacts: StudioArtifact[];
  formatProfile: FormatProfile;
  formatIssues: FormatIssue[];
  readiness: StudioReadiness;
}

export interface StudioWorkspace {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  activeProjectId: string;
  projects: StudioProject[];
  savedAt: string;
}

interface QuestionTemplate {
  key: string;
  category: QuestionCategory;
  class: QuestionClass;
  prompt: string;
  why: string;
  answerHint: string;
  options?: string[];
  impact: number;
  uncertainty: number;
  revisionRisk: number;
  affectedArtifactIds: string[];
  isSatisfied: (project: StudioProject) => boolean;
  inferredAnswer?: (project: StudioProject) => string;
}

const ALL_CONTENT_ARTIFACTS = [
  "project-spec",
  "requirements",
  "actor-matrix",
  "usecase-main",
  "activity-main",
  "sequence-main",
  "test-cases",
  "outline",
  "report-draft",
  "final-docx",
];

const ALL_ARTIFACTS = [...ALL_CONTENT_ARTIFACTS, "format-profile"];

const DEFAULT_INTAKE: StudioIntake = {
  projectType: "formal",
  title: "",
  topic: "",
  institution: "",
  faculty: "",
  program: "",
  course: "",
  lecturer: "",
  deadline: "",
  objective: "",
  problem: "",
  existingState: "",
  expectedOutput: "Laporan akademik dan artefak pendukung",
  language: "id",
};

export const DEFAULT_FORMAT_PROFILE: FormatProfile = {
  presetName: "Standar Indonesia",
  paperSize: "A4",
  margins: { top: 40, right: 30, bottom: 30, left: 40 },
  fontFamily: "Times New Roman",
  bodyFontSize: 12,
  heading1FontSize: 14,
  heading2FontSize: 12,
  lineSpacing: 1.5,
  paragraphIndent: 12.5,
  alignment: "justify",
  citationStyle: "APA 7",
  pageNumbering: "Romawi untuk bagian awal, Arab mulai BAB I",
  requiredSections: [
    "Halaman Judul",
    "Abstrak",
    "BAB I Pendahuluan",
    "BAB II Landasan Teori",
    "BAB III Metodologi",
    "BAB IV Hasil dan Pembahasan",
    "BAB V Penutup",
    "Daftar Pustaka",
  ],
};

function nowIso() {
  return new Date().toISOString();
}

export function makeStudioId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function cloneProject(project: StudioProject): StudioProject {
  return JSON.parse(JSON.stringify(project)) as StudioProject;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitList(value: string) {
  return unique(
    value
      .split(/\r?\n|;|\|/)
      .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
      .filter(Boolean),
  );
}

function activeDecision(project: StudioProject, key: string) {
  return project.decisions.find(
    (decision) =>
      decision.key === key &&
      !["superseded", "rejected"].includes(decision.status),
  );
}

function decisionValue(project: StudioProject, key: string) {
  return clean(activeDecision(project, key)?.value);
}

function decisionsByCategory(project: StudioProject, category: QuestionCategory) {
  return project.decisions.filter(
    (decision) =>
      decision.category === category &&
      ["confirmed", "locked"].includes(decision.status) &&
      clean(decision.value),
  );
}

function defaultArtifacts(timestamp: string): StudioArtifact[] {
  const definitions: Array<
    Pick<StudioArtifact, "id" | "kind" | "title" | "description" | "dependencyIds">
  > = [
    {
      id: "project-spec",
      kind: "specification",
      title: "Project Specification",
      description: "Satu sumber kebenaran untuk seluruh isi dan artefak.",
      dependencyIds: [],
    },
    {
      id: "requirements",
      kind: "requirements",
      title: "Daftar Kebutuhan & Aturan Bisnis",
      description: "Kebutuhan fungsional, nonfungsional, serta aturan bisnis terkonfirmasi.",
      dependencyIds: ["project-spec"],
    },
    {
      id: "actor-matrix",
      kind: "actor_matrix",
      title: "Matriks Aktor dan Hak Akses",
      description: "Aktor, tanggung jawab, dan batas kewenangan.",
      dependencyIds: ["requirements"],
    },
    {
      id: "usecase-main",
      kind: "uml",
      title: "Use Case Diagram Utama",
      description: "Batas sistem dan interaksi aktor tanpa fungsi yatim.",
      dependencyIds: ["requirements", "actor-matrix"],
    },
    {
      id: "activity-main",
      kind: "uml",
      title: "Activity Diagram Alur Utama",
      description: "Alur normal, percabangan, dan exception utama.",
      dependencyIds: ["usecase-main"],
    },
    {
      id: "sequence-main",
      kind: "uml",
      title: "Sequence Diagram Skenario Kritis",
      description: "Urutan pesan antarkomponen untuk skenario paling berisiko.",
      dependencyIds: ["usecase-main", "activity-main"],
    },
    {
      id: "test-cases",
      kind: "test_cases",
      title: "Test Cases",
      description: "Kasus uji diturunkan dari requirement, alur normal, dan exception.",
      dependencyIds: ["requirements", "activity-main"],
    },
    {
      id: "outline",
      kind: "outline",
      title: "Outline Laporan",
      description: "Struktur laporan berdasarkan spesifikasi dan aturan format.",
      dependencyIds: ["project-spec"],
    },
    {
      id: "report-draft",
      kind: "report",
      title: "Draft Laporan",
      description: "Naskah yang hanya memakai keputusan dan sumber terkonfirmasi.",
      dependencyIds: ["outline", "requirements"],
    },
    {
      id: "format-profile",
      kind: "format_profile",
      title: "Profil Format",
      description: "Aturan margin, font, heading, sitasi, dan penomoran.",
      dependencyIds: [],
    },
    {
      id: "final-docx",
      kind: "document",
      title: "Dokumen Final",
      description: "DOCX final setelah consistency check dan format preflight lolos.",
      dependencyIds: ["report-draft", "format-profile", "test-cases"],
    },
  ];

  return definitions.map((definition) => ({
    ...definition,
    status: "not_started",
    decisionIds: [],
    currentVersion: 0,
    updatedAt: timestamp,
    validationIssues: [],
  }));
}

const EMPTY_SPECIFICATION: ProjectSpecification = {
  version: 0,
  compiledAt: "",
  title: "",
  projectType: "formal",
  objective: "",
  problem: "",
  scopeIn: [],
  scopeOut: [],
  actors: [],
  functionalRequirements: [],
  nonFunctionalRequirements: [],
  businessRules: [],
  normalFlows: [],
  exceptionFlows: [],
  entities: [],
  methodology: [],
  citationRules: [],
  lecturerRequests: [],
  formatConstraints: [],
  bindingSources: [],
  unresolvedBlockers: [],
  assumptions: [],
};

const EMPTY_READINESS: StudioReadiness = {
  score: 0,
  stage: "intake",
  breakdown: { intake: 0, clarification: 0, specification: 0, artifacts: 0, format: 0 },
  blockerCount: 0,
  staleArtifactCount: 0,
  formatErrorCount: 0,
  nextActions: [],
};

export function createStudioProject(
  input: Partial<Pick<StudioProject, "id" | "name" | "importedFromLegacy">> & {
    intake?: Partial<StudioIntake>;
  } = {},
  timestamp = nowIso(),
) {
  const project: StudioProject = {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    id: input.id || makeStudioId("project"),
    name: clean(input.name) || "Proyek Akademik Baru",
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    importedFromLegacy: Boolean(input.importedFromLegacy),
    intake: { ...DEFAULT_INTAKE, ...(input.intake || {}) },
    sources: [],
    questions: [],
    decisions: [],
    specification: { ...EMPTY_SPECIFICATION },
    artifacts: defaultArtifacts(timestamp),
    formatProfile: JSON.parse(JSON.stringify(DEFAULT_FORMAT_PROFILE)) as FormatProfile,
    formatIssues: [],
    readiness: { ...EMPTY_READINESS, breakdown: { ...EMPTY_READINESS.breakdown } },
  };

  return refreshStudioProject(project, timestamp);
}

function questionTemplates(): QuestionTemplate[] {
  return [
    {
      key: "identity.title",
      category: "identity",
      class: "blocker",
      prompt: "Apa judul kerja yang akan menjadi jangkar seluruh proyek?",
      why: "Judul mencegah outline, UML, dan isi membahas objek yang berbeda.",
      answerHint: "Tulis judul sementara; nanti boleh berubah lewat Decision Ledger.",
      impact: 5,
      uncertainty: 4,
      revisionRisk: 5,
      affectedArtifactIds: ALL_CONTENT_ARTIFACTS,
      isSatisfied: (project) => Boolean(clean(project.intake.title)),
      inferredAnswer: (project) => project.intake.title,
    },
    {
      key: "identity.problem",
      category: "identity",
      class: "blocker",
      prompt: "Masalah nyata apa yang ingin diselesaikan atau dianalisis?",
      why: "Masalah adalah dasar tujuan, requirement, metode, dan kesimpulan.",
      answerHint: "Jelaskan kondisi sekarang, siapa yang terdampak, dan akibatnya.",
      impact: 5,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ALL_CONTENT_ARTIFACTS,
      isSatisfied: (project) => Boolean(clean(project.intake.problem)),
      inferredAnswer: (project) => project.intake.problem,
    },
    {
      key: "identity.objective",
      category: "identity",
      class: "blocker",
      prompt: "Hasil terukur apa yang harus dicapai proyek ini?",
      why: "Tujuan menentukan kapan isi dan sistem bisa dianggap selesai.",
      answerHint: "Gunakan kata kerja konkret: merancang, membangun, menguji, atau menganalisis.",
      impact: 5,
      uncertainty: 4,
      revisionRisk: 5,
      affectedArtifactIds: ALL_CONTENT_ARTIFACTS,
      isSatisfied: (project) => Boolean(clean(project.intake.objective)),
      inferredAnswer: (project) => project.intake.objective,
    },
    {
      key: "scope.in",
      category: "scope",
      class: "blocker",
      prompt: "Apa saja yang wajib masuk ke cakupan proyek?",
      why: "Cakupan masuk mencegah fitur dan pembahasan penting terlewat.",
      answerHint: "Satu item per baris: proses, modul, lokasi, periode, atau objek penelitian.",
      impact: 5,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ALL_CONTENT_ARTIFACTS,
      isSatisfied: (project) => Boolean(decisionValue(project, "scope.in")),
      inferredAnswer: (project) => decisionValue(project, "scope.in"),
    },
    {
      key: "scope.out",
      category: "scope",
      class: "important",
      prompt: "Apa yang secara tegas tidak dikerjakan?",
      why: "Batas eksplisit mencegah scope creep dan ekspektasi dosen/user yang berbeda.",
      answerHint: "Satu item per baris. Contoh: pembayaran online, aplikasi mobile, deployment publik.",
      impact: 4,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ALL_CONTENT_ARTIFACTS,
      isSatisfied: (project) => Boolean(decisionValue(project, "scope.out")),
      inferredAnswer: (project) => decisionValue(project, "scope.out"),
    },
    {
      key: "actors.matrix",
      category: "actors",
      class: "blocker",
      prompt: "Siapa saja aktor dan apa tanggung jawab atau hak aksesnya?",
      why: "UML sering salah karena aktor, boundary, dan kewenangannya belum disepakati.",
      answerHint: "Format per baris: Aktor — tanggung jawab/hak akses.",
      impact: 5,
      uncertainty: 4,
      revisionRisk: 5,
      affectedArtifactIds: ["project-spec", "requirements", "actor-matrix", "usecase-main", "activity-main", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "actors.matrix")),
      inferredAnswer: (project) => decisionValue(project, "actors.matrix"),
    },
    {
      key: "requirements.functional",
      category: "requirements",
      class: "blocker",
      prompt: "Fungsi atau kemampuan utama apa yang wajib tersedia?",
      why: "Requirement terkonfirmasi menjadi sumber use case, pengujian, dan pembahasan.",
      answerHint: "Satu requirement per baris dan mulai dengan kata kerja.",
      impact: 5,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ["project-spec", "requirements", "usecase-main", "activity-main", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "requirements.functional")),
      inferredAnswer: (project) => decisionValue(project, "requirements.functional"),
    },
    {
      key: "requirements.nonfunctional",
      category: "requirements",
      class: "important",
      prompt: "Batas kualitas apa yang wajib dipenuhi?",
      why: "Keamanan, performa, kemudahan pakai, dan reliabilitas perlu dapat diuji.",
      answerHint: "Contoh: role-based access, waktu respons, backup, aksesibilitas, perangkat target.",
      impact: 4,
      uncertainty: 4,
      revisionRisk: 4,
      affectedArtifactIds: ["project-spec", "requirements", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "requirements.nonfunctional")),
      inferredAnswer: (project) => decisionValue(project, "requirements.nonfunctional"),
    },
    {
      key: "requirements.business_rules",
      category: "requirements",
      class: "important",
      prompt: "Aturan bisnis atau syarat validasi apa yang tidak boleh dilanggar?",
      why: "Aturan bisnis menentukan cabang UML, validasi data, dan test case negatif.",
      answerHint: "Contoh: hanya dosen pembimbing dapat menyetujui; status final tidak dapat diedit.",
      impact: 4,
      uncertainty: 5,
      revisionRisk: 4,
      affectedArtifactIds: ["project-spec", "requirements", "activity-main", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "requirements.business_rules")),
      inferredAnswer: (project) => decisionValue(project, "requirements.business_rules"),
    },
    {
      key: "flow.normal",
      category: "flow",
      class: "blocker",
      prompt: "Bagaimana alur normal dari awal sampai hasil akhir?",
      why: "Alur normal menyatukan narasi, activity diagram, sequence diagram, dan test case.",
      answerHint: "Tulis langkah bernomor atau satu langkah per baris.",
      impact: 5,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ["project-spec", "usecase-main", "activity-main", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "flow.normal")),
      inferredAnswer: (project) => decisionValue(project, "flow.normal"),
    },
    {
      key: "flow.exceptions",
      category: "exceptions",
      class: "important",
      prompt: "Apa kondisi gagal, data tidak valid, atau jalur alternatif yang harus ditangani?",
      why: "Exception yang hilang adalah penyebab diagram terlihat benar tetapi sistem tetap mudah bug.",
      answerHint: "Format: kondisi — respons sistem — hasil akhir.",
      impact: 4,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ["project-spec", "activity-main", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "flow.exceptions")),
      inferredAnswer: (project) => decisionValue(project, "flow.exceptions"),
    },
    {
      key: "data.entities",
      category: "data",
      class: "important",
      prompt: "Data atau entitas utama apa yang dibaca, dibuat, diubah, dan disimpan?",
      why: "Entitas menjaga istilah konsisten antara kode, UML, tabel, dan laporan.",
      answerHint: "Satu entitas per baris, boleh sertakan atribut kunci.",
      impact: 4,
      uncertainty: 4,
      revisionRisk: 4,
      affectedArtifactIds: ["project-spec", "requirements", "sequence-main", "test-cases", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "data.entities")),
      inferredAnswer: (project) => decisionValue(project, "data.entities"),
    },
    {
      key: "method.approach",
      category: "method",
      class: "important",
      prompt: "Metode pengembangan/penelitian dan cara pengujiannya apa?",
      why: "Metode harus selaras dengan data, artefak, BAB metodologi, dan bukti hasil.",
      answerHint: "Sebut metode, tahap, subjek/data, instrumen, dan teknik uji.",
      impact: 4,
      uncertainty: 4,
      revisionRisk: 4,
      affectedArtifactIds: ["project-spec", "test-cases", "outline", "report-draft", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "method.approach")),
      inferredAnswer: (project) => decisionValue(project, "method.approach"),
    },
    {
      key: "lecturer.requests",
      category: "lecturer",
      class: "blocker",
      prompt: "Apa permintaan, revisi, atau larangan eksplisit dari dosen?",
      why: "Instruksi dosen harus mengalahkan asumsi sistem dan contoh laporan umum.",
      answerHint: "Tulis 'tidak ada' jika sudah dipastikan, atau tambahkan sumber dengan otoritas Mengikat.",
      impact: 5,
      uncertainty: 4,
      revisionRisk: 5,
      affectedArtifactIds: ALL_ARTIFACTS,
      isSatisfied: (project) =>
        Boolean(decisionValue(project, "lecturer.requests")) ||
        project.sources.some(
          (source) => source.kind === "lecturer_request" && source.authority === "binding",
        ),
      inferredAnswer: (project) =>
        decisionValue(project, "lecturer.requests") ||
        project.sources
          .filter((source) => source.kind === "lecturer_request")
          .map((source) => source.title)
          .join("; "),
    },
    {
      key: "format.binding_source",
      category: "format",
      class: "blocker",
      prompt: "Pedoman atau template mana yang menjadi aturan format tertinggi?",
      why: "Tanpa sumber format yang jelas, margin, heading, dan struktur rawan direvisi berulang.",
      answerHint: "Tambahkan pedoman kampus/template sebagai sumber Mengikat, atau jelaskan aturan yang disepakati.",
      impact: 5,
      uncertainty: 5,
      revisionRisk: 5,
      affectedArtifactIds: ["project-spec", "outline", "report-draft", "format-profile", "final-docx"],
      isSatisfied: (project) =>
        Boolean(decisionValue(project, "format.binding_source")) ||
        project.sources.some(
          (source) =>
            ["campus_guide", "template"].includes(source.kind) &&
            source.authority === "binding",
        ),
      inferredAnswer: (project) =>
        decisionValue(project, "format.binding_source") ||
        project.sources
          .filter((source) => ["campus_guide", "template"].includes(source.kind))
          .map((source) => source.title)
          .join("; "),
    },
    {
      key: "citation.style",
      category: "citation",
      class: "important",
      prompt: "Gaya sitasi dan batas sumber yang boleh dipakai apa?",
      why: "Aturan sitasi harus konsisten dari kutipan pertama sampai daftar pustaka.",
      answerHint: "Contoh: APA 7; jurnal 5 tahun terakhir; sumber primer; DOI wajib bila tersedia.",
      impact: 4,
      uncertainty: 4,
      revisionRisk: 4,
      affectedArtifactIds: ["project-spec", "outline", "report-draft", "format-profile", "final-docx"],
      isSatisfied: (project) => Boolean(decisionValue(project, "citation.style")),
      inferredAnswer: (project) => decisionValue(project, "citation.style"),
    },
  ];
}

export function calculateQuestionPriority(
  impact: number,
  uncertainty: number,
  artifactCount: number,
  revisionRisk: number,
) {
  const spread = Math.min(5, Math.max(1, Math.ceil(artifactCount / 2)));
  return impact * uncertainty * spread * revisionRisk;
}

export function generateStudioQuestions(project: StudioProject, timestamp = nowIso()) {
  const previous = new Map(project.questions.map((question) => [question.key, question]));
  const generated = questionTemplates().map((template) => {
    const current = previous.get(template.key);
    const satisfied = template.isSatisfied(project);
    const inferred = clean(template.inferredAnswer?.(project));
    const shouldInfer = satisfied && !clean(current?.answer) && Boolean(inferred);
    const status: QuestionStatus = current?.status === "waived"
      ? "waived"
      : satisfied
        ? "answered"
        : current?.status === "answered" && clean(current.answer)
          ? "answered"
          : "unanswered";

    return {
      id: current?.id || makeStudioId("question"),
      key: template.key,
      category: template.category,
      class: template.class,
      prompt: template.prompt,
      why: template.why,
      answerHint: template.answerHint,
      options: template.options,
      status,
      answer: shouldInfer ? inferred : current?.answer || "",
      waiverReason: current?.waiverReason,
      priority: calculateQuestionPriority(
        template.impact,
        template.uncertainty,
        template.affectedArtifactIds.length,
        template.revisionRisk,
      ),
      affectedArtifactIds: [...template.affectedArtifactIds],
      sourceIds: current?.sourceIds || [],
      origin: current?.origin || "system",
      createdAt: current?.createdAt || timestamp,
      updatedAt: current?.updatedAt || timestamp,
    } satisfies StudioQuestion;
  });

  const custom = project.questions.filter(
    (question) => !generated.some((item) => item.key === question.key),
  );
  return [...generated, ...custom].sort((left, right) => {
    const statusOrder = { unanswered: 0, answered: 1, waived: 2 };
    return statusOrder[left.status] - statusOrder[right.status] || right.priority - left.priority;
  });
}

function projectWithStaleArtifacts(project: StudioProject, artifactIds: string[], timestamp: string) {
  const staleIds = new Set(artifactIds);
  let expanded = true;
  while (expanded) {
    expanded = false;
    project.artifacts.forEach((artifact) => {
      if (
        !staleIds.has(artifact.id) &&
        artifact.dependencyIds.some((dependencyId) => staleIds.has(dependencyId))
      ) {
        staleIds.add(artifact.id);
        expanded = true;
      }
    });
  }

  project.artifacts = project.artifacts.map((artifact) => {
    if (!staleIds.has(artifact.id) || artifact.status === "not_started") return artifact;
    return {
      ...artifact,
      status: "stale",
      lockedAt: undefined,
      updatedAt: timestamp,
      validationIssues: unique([
        ...artifact.validationIssues.map((issue) => issue.message),
        "Keputusan atau sumber hulu berubah; artefak wajib divalidasi ulang.",
      ]).map((message, index) => ({
        id: `stale-${artifact.id}-${index}`,
        severity: "warning" as const,
        message,
      })),
    };
  });
}

function setIntakeFromQuestion(project: StudioProject, questionKey: string, answer: string) {
  if (questionKey === "identity.title") project.intake.title = answer;
  if (questionKey === "identity.problem") project.intake.problem = answer;
  if (questionKey === "identity.objective") project.intake.objective = answer;
}

function upsertDecisionFromQuestion(
  project: StudioProject,
  question: StudioQuestion,
  answer: string,
  lock: boolean,
  timestamp: string,
) {
  const existing = activeDecision(project, question.key);
  if (existing?.status === "locked" && existing.value !== answer) {
    throw new Error("Keputusan ini terkunci. Buka kunci di Decision Ledger sebelum mengubah jawaban.");
  }

  if (existing) {
    if (existing.value !== answer || existing.status !== (lock ? "locked" : "confirmed")) {
      existing.history.push({
        version: existing.version,
        value: existing.value,
        status: existing.status,
        changedAt: timestamp,
        reason: "Diperbarui dari jawaban Question Engine",
      });
      existing.version += 1;
    }
    existing.value = answer;
    existing.statement = question.prompt;
    existing.status = lock ? "locked" : "confirmed";
    existing.questionId = question.id;
    existing.sourceIds = [...question.sourceIds];
    existing.affectedArtifactIds = [...question.affectedArtifactIds];
    existing.updatedAt = timestamp;
    return existing.id;
  }

  const id = makeStudioId("decision");
  project.decisions.push({
    id,
    key: question.key,
    category: question.category,
    statement: question.prompt,
    value: answer,
    rationale: question.why,
    status: lock ? "locked" : "confirmed",
    origin: "question",
    questionId: question.id,
    sourceIds: [...question.sourceIds],
    affectedArtifactIds: [...question.affectedArtifactIds],
    version: 1,
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export function answerStudioQuestion(
  input: StudioProject,
  questionId: string,
  answerValue: string,
  options: { lock?: boolean; sourceIds?: string[] } = {},
  timestamp = nowIso(),
) {
  const answer = clean(answerValue);
  if (!answer) throw new Error("Jawaban tidak boleh kosong.");
  const project = cloneProject(input);
  const question = project.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("Pertanyaan tidak ditemukan.");

  const previousAnswer = question.answer;
  question.answer = answer;
  question.status = "answered";
  question.waiverReason = undefined;
  question.sourceIds = unique(options.sourceIds || question.sourceIds);
  question.updatedAt = timestamp;
  setIntakeFromQuestion(project, question.key, answer);
  upsertDecisionFromQuestion(project, question, answer, Boolean(options.lock), timestamp);

  if (previousAnswer !== answer) {
    projectWithStaleArtifacts(project, question.affectedArtifactIds, timestamp);
  }
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function waiveStudioQuestion(
  input: StudioProject,
  questionId: string,
  reasonValue: string,
  timestamp = nowIso(),
) {
  const reason = clean(reasonValue);
  if (reason.length < 8) throw new Error("Alasan waiver minimal 8 karakter agar dapat diaudit.");
  const project = cloneProject(input);
  const question = project.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("Pertanyaan tidak ditemukan.");
  question.status = "waived";
  question.waiverReason = reason;
  question.updatedAt = timestamp;
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function updateStudioIntake(
  input: StudioProject,
  patch: Partial<StudioIntake>,
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  const changed = Object.entries(patch).some(
    ([key, value]) => project.intake[key as keyof StudioIntake] !== value,
  );
  if (!changed) return project;
  project.intake = { ...project.intake, ...patch };
  if (clean(patch.title)) project.name = clean(patch.title).slice(0, 100);
  projectWithStaleArtifacts(project, ALL_CONTENT_ARTIFACTS, timestamp);
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function addStudioSource(
  input: StudioProject,
  sourceInput: Pick<StudioSource, "title" | "content" | "kind" | "authority"> &
    Partial<Pick<StudioSource, "fileName" | "provenance" | "notes">>,
  timestamp = nowIso(),
) {
  const title = clean(sourceInput.title);
  const content = clean(sourceInput.content);
  if (!title || !content) throw new Error("Judul dan isi sumber wajib diisi.");
  const project = cloneProject(input);
  const source: StudioSource = {
    id: makeStudioId("source"),
    kind: sourceInput.kind,
    authority: sourceInput.authority,
    title,
    content,
    fileName: clean(sourceInput.fileName) || undefined,
    provenance: clean(sourceInput.provenance) || undefined,
    notes: clean(sourceInput.notes) || undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  project.sources.unshift(source);
  const affected = ["campus_guide", "template"].includes(source.kind)
    ? ALL_ARTIFACTS
    : ALL_CONTENT_ARTIFACTS;
  projectWithStaleArtifacts(project, affected, timestamp);
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function removeStudioSource(
  input: StudioProject,
  sourceId: string,
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  const source = project.sources.find((item) => item.id === sourceId);
  if (!source) return project;
  project.sources = project.sources.filter((item) => item.id !== sourceId);
  project.questions = project.questions.map((question) => ({
    ...question,
    sourceIds: question.sourceIds.filter((id) => id !== sourceId),
  }));
  project.decisions = project.decisions.map((decision) => ({
    ...decision,
    sourceIds: decision.sourceIds.filter((id) => id !== sourceId),
  }));
  projectWithStaleArtifacts(project, ALL_ARTIFACTS, timestamp);
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function addStudioQuestion(
  input: StudioProject,
  questionInput: Pick<StudioQuestion, "prompt" | "category" | "class"> &
    Partial<Pick<StudioQuestion, "why" | "answerHint" | "sourceIds" | "affectedArtifactIds">>,
  timestamp = nowIso(),
) {
  const prompt = clean(questionInput.prompt);
  if (!prompt) throw new Error("Pertanyaan tidak boleh kosong.");
  const project = cloneProject(input);
  const id = makeStudioId("question");
  const affected = unique(questionInput.affectedArtifactIds || ALL_CONTENT_ARTIFACTS);
  project.questions.push({
    id,
    key: `custom.${id}`,
    category: questionInput.category,
    class: questionInput.class,
    prompt,
    why: clean(questionInput.why) || "Pertanyaan tambahan dari hasil brainstorming atau review.",
    answerHint: clean(questionInput.answerHint) || "Jawab dengan fakta yang dapat diverifikasi.",
    status: "unanswered",
    answer: "",
    priority: calculateQuestionPriority(3, 4, affected.length, 4),
    affectedArtifactIds: affected,
    sourceIds: unique(questionInput.sourceIds || []),
    origin: "user",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function mergeAiQuestions(
  input: StudioProject,
  questions: Array<{
    prompt: string;
    why?: string;
    answerHint?: string;
    category?: QuestionCategory;
    class?: QuestionClass;
    sourceIds?: string[];
    affectedArtifactIds?: string[];
  }>,
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  questions.slice(0, 12).forEach((question) => {
    const normalized = clean(question.prompt).toLowerCase();
    if (!normalized) return;
    const duplicate = project.questions.some(
      (existing) => clean(existing.prompt).toLowerCase() === normalized,
    );
    if (duplicate) return;
    const id = makeStudioId("question");
    const affected = unique(question.affectedArtifactIds || ALL_CONTENT_ARTIFACTS);
    project.questions.push({
      id,
      key: `ai.${id}`,
      category: question.category || "conflict",
      class: question.class || "important",
      prompt: clean(question.prompt),
      why: clean(question.why) || "AI menemukan ketidakjelasan yang berpotensi memicu revisi.",
      answerHint: clean(question.answerHint) || "Jawab dengan fakta dan kaitkan sumber bila tersedia.",
      status: "unanswered",
      answer: "",
      priority: calculateQuestionPriority(4, 5, affected.length, 4),
      affectedArtifactIds: affected,
      sourceIds: unique(question.sourceIds || []),
      origin: "ai",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function addStudioDecision(
  input: StudioProject,
  decisionInput: Pick<StudioDecision, "statement" | "value" | "category"> &
    Partial<Pick<StudioDecision, "key" | "rationale" | "status" | "sourceIds" | "affectedArtifactIds">>,
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  const value = clean(decisionInput.value);
  const statement = clean(decisionInput.statement);
  if (!statement || !value) throw new Error("Pernyataan dan nilai keputusan wajib diisi.");
  const id = makeStudioId("decision");
  const affected = unique(decisionInput.affectedArtifactIds || ALL_CONTENT_ARTIFACTS);
  project.decisions.push({
    id,
    key: clean(decisionInput.key) || `manual.${id}`,
    category: decisionInput.category,
    statement,
    value,
    rationale: clean(decisionInput.rationale) || "Keputusan manual dari pengguna.",
    status: decisionInput.status || "confirmed",
    origin: "user",
    sourceIds: unique(decisionInput.sourceIds || []),
    affectedArtifactIds: affected,
    version: 1,
    history: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  projectWithStaleArtifacts(project, affected, timestamp);
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function setDecisionStatus(
  input: StudioProject,
  decisionId: string,
  status: DecisionStatus,
  reason = "",
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  const decision = project.decisions.find((item) => item.id === decisionId);
  if (!decision) throw new Error("Keputusan tidak ditemukan.");
  if (decision.status === status) return project;
  decision.history.push({
    version: decision.version,
    value: decision.value,
    status: decision.status,
    changedAt: timestamp,
    reason: clean(reason) || `Status diubah menjadi ${status}`,
  });
  decision.status = status;
  decision.version += 1;
  decision.updatedAt = timestamp;
  if (["rejected", "superseded", "draft"].includes(status)) {
    projectWithStaleArtifacts(project, decision.affectedArtifactIds, timestamp);
  }
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

function collectDecisionList(project: StudioProject, key: string) {
  return splitList(decisionValue(project, key));
}

function collectCategoryValues(project: StudioProject, category: QuestionCategory) {
  return unique(decisionsByCategory(project, category).flatMap((decision) => splitList(decision.value)));
}

function parseActors(value: string): SpecificationActor[] {
  return splitList(value).map((line) => {
    const [name, ...responsibility] = line.split(/\s+(?:—|-|:)\s+/);
    return {
      name: clean(name) || line,
      responsibility: clean(responsibility.join(" — ")) || "Tanggung jawab perlu dirinci",
    };
  });
}

export function compileProjectSpecification(project: StudioProject, timestamp = nowIso()) {
  const lecturerSourceItems = project.sources
    .filter((source) => source.kind === "lecturer_request")
    .map((source) => `${source.title}: ${source.content.slice(0, 500)}`);
  const formatSourceItems = project.sources
    .filter((source) => ["campus_guide", "template"].includes(source.kind))
    .map((source) => `${source.title}${source.authority === "binding" ? " (mengikat)" : ""}`);
  const blockerQuestions = project.questions.filter(
    (question) => question.class === "blocker" && question.status === "unanswered",
  );

  return {
    version: Math.max(1, project.revision),
    compiledAt: timestamp,
    title: clean(project.intake.title),
    projectType: project.intake.projectType,
    objective: clean(project.intake.objective),
    problem: clean(project.intake.problem),
    scopeIn: collectDecisionList(project, "scope.in"),
    scopeOut: collectDecisionList(project, "scope.out"),
    actors: parseActors(decisionValue(project, "actors.matrix")),
    functionalRequirements: collectDecisionList(project, "requirements.functional"),
    nonFunctionalRequirements: collectDecisionList(project, "requirements.nonfunctional"),
    businessRules: collectDecisionList(project, "requirements.business_rules"),
    normalFlows: collectDecisionList(project, "flow.normal"),
    exceptionFlows: collectDecisionList(project, "flow.exceptions"),
    entities: collectDecisionList(project, "data.entities"),
    methodology: collectCategoryValues(project, "method"),
    citationRules: unique([
      ...collectCategoryValues(project, "citation"),
      project.formatProfile.citationStyle,
    ]),
    lecturerRequests: unique([
      ...collectCategoryValues(project, "lecturer"),
      ...lecturerSourceItems,
    ]),
    formatConstraints: unique([
      ...collectCategoryValues(project, "format"),
      ...formatSourceItems,
      `${project.formatProfile.paperSize}; margin ${project.formatProfile.margins.top}/${project.formatProfile.margins.right}/${project.formatProfile.margins.bottom}/${project.formatProfile.margins.left} mm`,
      `${project.formatProfile.fontFamily} ${project.formatProfile.bodyFontSize} pt; spasi ${project.formatProfile.lineSpacing}`,
    ]),
    bindingSources: project.sources
      .filter((source) => source.authority === "binding")
      .map((source) => source.title),
    unresolvedBlockers: blockerQuestions.map((question) => question.prompt),
    assumptions: project.questions
      .filter((question) => question.status === "waived")
      .map((question) => `${question.prompt} — diasumsikan/diabaikan: ${question.waiverReason}`),
  } satisfies ProjectSpecification;
}

export function validateFormatProfile(project: StudioProject) {
  const profile = project.formatProfile;
  const issues: FormatIssue[] = [];
  const add = (
    id: string,
    severity: FormatIssue["severity"],
    field: string,
    message: string,
    fix: string,
  ) => issues.push({ id, severity, field, message, fix });

  if (!profile.sourceId || !project.sources.some((source) => source.id === profile.sourceId)) {
    add(
      "format-source",
      "error",
      "sourceId",
      "Profil format belum ditautkan ke pedoman/template sumber.",
      "Tambahkan pedoman kampus lalu pilih sebagai sumber profil format.",
    );
  }
  Object.entries(profile.margins).forEach(([side, value]) => {
    if (!Number.isFinite(value) || value < 15 || value > 60) {
      add(
        `margin-${side}`,
        "error",
        `margins.${side}`,
        `Margin ${side} ${value} mm berada di luar batas aman 15–60 mm.`,
        "Cocokkan angka dengan pedoman resmi.",
      );
    }
  });
  if (!clean(profile.fontFamily)) {
    add("font-family", "error", "fontFamily", "Font utama belum ditentukan.", "Pilih font dari pedoman resmi.");
  }
  if (profile.bodyFontSize < 9 || profile.bodyFontSize > 14) {
    add("body-size", "warning", "bodyFontSize", "Ukuran body tidak lazim untuk laporan akademik.", "Verifikasi ukuran body pada pedoman.");
  }
  if (profile.heading1FontSize < profile.bodyFontSize) {
    add("heading-size", "warning", "heading1FontSize", "Heading 1 lebih kecil dari body.", "Naikkan Heading 1 atau konfirmasi pengecualian pada pedoman.");
  }
  if (profile.lineSpacing < 1 || profile.lineSpacing > 2.5) {
    add("line-spacing", "error", "lineSpacing", "Line spacing berada di luar rentang 1–2,5.", "Masukkan nilai dari pedoman.");
  }
  if (profile.requiredSections.length === 0) {
    add("required-sections", "error", "requiredSections", "Daftar bagian wajib masih kosong.", "Masukkan seluruh halaman awal, BAB, dan lampiran wajib.");
  }
  if (!clean(profile.pageNumbering)) {
    add("page-numbering", "warning", "pageNumbering", "Aturan penomoran halaman belum dicatat.", "Tulis posisi dan pola nomor halaman awal/isi.");
  }
  const unansweredFormat = project.questions.filter(
    (question) =>
      ["format", "citation"].includes(question.category) && question.status === "unanswered",
  );
  unansweredFormat.forEach((question) =>
    add(
      `question-${question.id}`,
      question.class === "blocker" ? "error" : "warning",
      question.key,
      `Aturan belum dipastikan: ${question.prompt}`,
      "Jawab di Question Engine dan kunci keputusannya.",
    ),
  );
  return issues;
}

export function calculateStudioReadiness(project: StudioProject): StudioReadiness {
  const intakeFields = [
    project.intake.title,
    project.intake.problem,
    project.intake.objective,
    project.intake.institution || project.intake.course,
    project.intake.deadline,
  ];
  const intakeRatio = intakeFields.filter((value) => clean(value)).length / intakeFields.length;
  const hasPrimarySource = project.sources.some((source) =>
    ["binding", "primary"].includes(source.authority),
  );
  const intake = Math.round((intakeRatio * 0.75 + (hasPrimarySource ? 0.25 : 0)) * 20);

  const relevantQuestions = project.questions.filter((question) => question.class !== "enrichment");
  const resolvedQuestions = relevantQuestions.filter((question) => question.status !== "unanswered");
  const clarification = Math.round(
    (relevantQuestions.length ? resolvedQuestions.length / relevantQuestions.length : 0) * 20,
  );

  const specChecks = [
    project.specification.title,
    project.specification.problem,
    project.specification.objective,
    project.specification.scopeIn.length,
    project.specification.actors.length,
    project.specification.functionalRequirements.length,
    project.specification.normalFlows.length,
  ];
  const specification = Math.round(
    (specChecks.filter((value) => Boolean(value)).length / specChecks.length) * 25,
  );

  const productionArtifacts = project.artifacts.filter(
    (artifact) => !["project-spec", "format-profile"].includes(artifact.id),
  );
  const artifactPoints = productionArtifacts.reduce((total, artifact) => {
    if (artifact.status === "locked") return total + 1;
    if (artifact.status === "approved") return total + 0.9;
    if (artifact.status === "ready") return total + 0.65;
    if (artifact.status === "draft") return total + 0.35;
    return total;
  }, 0);
  const artifacts = Math.round(
    (productionArtifacts.length ? artifactPoints / productionArtifacts.length : 0) * 25,
  );

  const errorCount = project.formatIssues.filter((issue) => issue.severity === "error").length;
  const warningCount = project.formatIssues.filter((issue) => issue.severity === "warning").length;
  const format = Math.max(0, 10 - errorCount * 3 - Math.min(3, warningCount));
  const blockerCount = project.questions.filter(
    (question) => question.class === "blocker" && question.status === "unanswered",
  ).length;
  const staleArtifactCount = project.artifacts.filter((artifact) => artifact.status === "stale").length;

  let score = Math.min(100, intake + clarification + specification + artifacts + format);
  if (blockerCount > 0) score = Math.min(score, 69);
  if (staleArtifactCount > 0) score = Math.min(score, 84);
  if (errorCount > 0) score = Math.min(score, 94);

  let stage: ReadinessStage = "intake";
  if (score >= 25) stage = "clarifying";
  if (score >= 55 && blockerCount === 0) stage = "specified";
  if (score >= 70 && blockerCount === 0) stage = "production";
  if (score >= 85 && blockerCount === 0 && staleArtifactCount === 0) stage = "preflight";
  if (score >= 95 && blockerCount === 0 && staleArtifactCount === 0 && errorCount === 0) stage = "ready";

  const nextActions: string[] = [];
  if (intake < 16) nextActions.push("Lengkapi identitas, masalah, tujuan, deadline, dan satu sumber utama.");
  if (blockerCount > 0) nextActions.push(`Jawab ${blockerCount} pertanyaan blocker yang tersisa.`);
  if (specification < 20) nextActions.push("Konfirmasi scope, aktor, requirement, dan alur utama.");
  if (staleArtifactCount > 0) nextActions.push(`Validasi ulang ${staleArtifactCount} artefak yang stale.`);
  if (artifacts < 20 && blockerCount === 0) nextActions.push("Bangun dan approve artefak mengikuti urutan dependensi.");
  if (errorCount > 0) nextActions.push(`Perbaiki ${errorCount} error pada format preflight.`);
  if (nextActions.length === 0) nextActions.push("Semua gate utama lolos; dokumen siap diekspor dan direview final.");

  return {
    score,
    stage,
    breakdown: { intake, clarification, specification, artifacts, format },
    blockerCount,
    staleArtifactCount,
    formatErrorCount: errorCount,
    nextActions,
  };
}

export function refreshStudioProject(input: StudioProject, timestamp = nowIso()) {
  const project = input;
  project.questions = generateStudioQuestions(project, timestamp);
  project.specification = compileProjectSpecification(project, timestamp);
  project.formatIssues = validateFormatProfile(project);
  project.readiness = calculateStudioReadiness(project);

  const specArtifact = project.artifacts.find((artifact) => artifact.id === "project-spec");
  if (specArtifact && specArtifact.status === "not_started" && project.readiness.breakdown.specification >= 12) {
    specArtifact.status = project.readiness.blockerCount === 0 ? "ready" : "draft";
    specArtifact.currentVersion = Math.max(1, specArtifact.currentVersion);
    specArtifact.generatedAt = timestamp;
    specArtifact.updatedAt = timestamp;
  }
  const formatArtifact = project.artifacts.find((artifact) => artifact.id === "format-profile");
  if (formatArtifact && formatArtifact.status === "not_started") {
    formatArtifact.status = project.formatIssues.some((issue) => issue.severity === "error")
      ? "draft"
      : "ready";
    formatArtifact.currentVersion = Math.max(1, formatArtifact.currentVersion);
    formatArtifact.updatedAt = timestamp;
  }
  return project;
}

export function updateFormatProfile(
  input: StudioProject,
  patch: Partial<FormatProfile>,
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  project.formatProfile = {
    ...project.formatProfile,
    ...patch,
    margins: { ...project.formatProfile.margins, ...(patch.margins || {}) },
    requiredSections: patch.requiredSections
      ? unique(patch.requiredSections)
      : project.formatProfile.requiredSections,
  };
  projectWithStaleArtifacts(project, ["format-profile", "outline", "report-draft", "final-docx"], timestamp);
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function artifactDependencyProblems(project: StudioProject, artifactId: string) {
  const artifact = project.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return ["Artefak tidak ditemukan."];
  return artifact.dependencyIds.flatMap((dependencyId) => {
    const dependency = project.artifacts.find((item) => item.id === dependencyId);
    if (!dependency) return [`Dependensi ${dependencyId} tidak ditemukan.`];
    if (["approved", "locked"].includes(dependency.status)) return [];
    return [`${dependency.title} belum approved.`];
  });
}

export function advanceArtifact(
  input: StudioProject,
  artifactId: string,
  action: "draft" | "ready" | "approve" | "lock" | "reopen",
  validationIssues: ArtifactValidationIssue[] = [],
  timestamp = nowIso(),
) {
  const project = cloneProject(input);
  const artifact = project.artifacts.find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Artefak tidak ditemukan.");
  const dependencyProblems = artifactDependencyProblems(project, artifactId);
  if (["approve", "lock"].includes(action) && dependencyProblems.length > 0) {
    throw new Error(`Dependensi belum siap: ${dependencyProblems.join(" ")}`);
  }
  if (["approve", "lock"].includes(action) && validationIssues.some((issue) => issue.severity === "error")) {
    throw new Error("Artefak masih memiliki validation error.");
  }
  if (action === "lock" && artifact.status !== "approved") {
    throw new Error("Artefak harus approved sebelum dikunci.");
  }

  if (["draft", "ready"].includes(action)) {
    artifact.currentVersion += 1;
    artifact.status = action === "ready" ? "ready" : "draft";
    artifact.generatedAt = timestamp;
    artifact.lockedAt = undefined;
  }
  if (action === "approve") {
    if (artifact.currentVersion === 0) artifact.currentVersion = 1;
    artifact.status = "approved";
    artifact.approvedVersion = artifact.currentVersion;
    artifact.lockedAt = undefined;
  }
  if (action === "lock") {
    artifact.status = "locked";
    artifact.approvedVersion = artifact.currentVersion;
    artifact.lockedAt = timestamp;
  }
  if (action === "reopen") {
    artifact.status = artifact.currentVersion > 0 ? "draft" : "not_started";
    artifact.lockedAt = undefined;
  }
  artifact.validationIssues = validationIssues;
  artifact.decisionIds = project.decisions
    .filter(
      (decision) =>
        ["confirmed", "locked"].includes(decision.status) &&
        decision.affectedArtifactIds.includes(artifact.id),
    )
    .map((decision) => decision.id);
  artifact.updatedAt = timestamp;
  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function normalizeStudioProject(value: unknown, timestamp = nowIso()) {
  if (!value || typeof value !== "object") return createStudioProject({}, timestamp);
  const partial = value as Partial<StudioProject>;
  const base = createStudioProject(
    {
      id: clean(partial.id) || undefined,
      name: clean(partial.name) || undefined,
      importedFromLegacy: Boolean(partial.importedFromLegacy),
      intake: partial.intake && typeof partial.intake === "object" ? partial.intake : undefined,
    },
    clean(partial.createdAt) || timestamp,
  );
  base.revision = Number.isFinite(partial.revision) ? Math.max(1, Number(partial.revision)) : 1;
  base.updatedAt = clean(partial.updatedAt) || timestamp;
  base.sources = Array.isArray(partial.sources) ? partial.sources : [];
  base.questions = Array.isArray(partial.questions) ? partial.questions : [];
  base.decisions = Array.isArray(partial.decisions) ? partial.decisions : [];
  base.formatProfile = partial.formatProfile && typeof partial.formatProfile === "object"
    ? {
        ...base.formatProfile,
        ...partial.formatProfile,
        margins: { ...base.formatProfile.margins, ...partial.formatProfile.margins },
        requiredSections: Array.isArray(partial.formatProfile.requiredSections)
          ? unique(partial.formatProfile.requiredSections)
          : base.formatProfile.requiredSections,
      }
    : base.formatProfile;

  if (Array.isArray(partial.artifacts)) {
    const existing = new Map(partial.artifacts.map((artifact) => [artifact.id, artifact]));
    base.artifacts = base.artifacts.map((artifact) => ({
      ...artifact,
      ...(existing.get(artifact.id) || {}),
      dependencyIds: artifact.dependencyIds,
    }));
  }
  return refreshStudioProject(base, timestamp);
}

export function specificationAsMarkdown(specification: ProjectSpecification) {
  const section = (title: string, values: string[]) =>
    `## ${title}\n${values.length ? values.map((value) => `- ${value}`).join("\n") : "- Belum diputuskan"}`;
  return [
    `# Project Specification v${specification.version}`,
    `**Judul:** ${specification.title || "Belum diputuskan"}`,
    `**Masalah:** ${specification.problem || "Belum diputuskan"}`,
    `**Tujuan:** ${specification.objective || "Belum diputuskan"}`,
    section("Cakupan Masuk", specification.scopeIn),
    section("Cakupan Keluar", specification.scopeOut),
    section(
      "Aktor dan Tanggung Jawab",
      specification.actors.map((actor) => `${actor.name} — ${actor.responsibility}`),
    ),
    section("Kebutuhan Fungsional", specification.functionalRequirements),
    section("Kebutuhan Nonfungsional", specification.nonFunctionalRequirements),
    section("Aturan Bisnis", specification.businessRules),
    section("Alur Normal", specification.normalFlows),
    section("Exception", specification.exceptionFlows),
    section("Entitas/Data", specification.entities),
    section("Metode", specification.methodology),
    section("Aturan Sitasi", specification.citationRules),
    section("Permintaan Dosen", specification.lecturerRequests),
    section("Aturan Format", specification.formatConstraints),
    section("Sumber Mengikat", specification.bindingSources),
    section("Blocker Belum Selesai", specification.unresolvedBlockers),
    section("Asumsi/Waiver", specification.assumptions),
  ].join("\n\n");
}
