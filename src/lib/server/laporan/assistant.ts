/**
 * src/lib/server/laporan/assistant.ts
 * -----------------------------------------------------------------------------
 * Asisten "Laporan": chat natural → brief → rencana → sumber terverifikasi →
 * eksekusi (report job tahan lama) → revisi per bagian.
 *
 * State per sesi tersimpan di `ReportSession` (brief/plan/sources/draft),
 * sehingga konteks tidak hilang meski percakapan panjang: setiap giliran AI
 * menerima STATE TERKINI (bukan hanya riwayat chat).
 */
import type OpenAI from "openai";
import { prisma } from "@/lib/db/prisma";
import { aiClient, AI_MODEL, AI_MODEL_FAST, stripThinking } from "@/lib/ai/client";
import { startImageJob, listImageJobs } from "@/lib/server/image-jobs";
import { findVerifiedSources, JOURNAL_REQUIREMENT_LABEL, type JournalRequirement, type VerifiedSource } from "@/lib/references/find-sources";
import { startReportJob, getReportJob, extractDiagramArtifacts, type ReportJob, type ReportDiagramArtifact } from "@/lib/report/report-jobs";
import { generateChapter, summarizeChapter } from "@/lib/report/generate-report";
import {
  appendUserMessage, controlAgentRun, createAgentRun, findActiveAgentRun, isContinueKeyword,
  type AgentDriver, type AgentRunPublic, type AgentToolContext,
} from "@/lib/server/agent-runs/engine";

const HISTORY_LIMIT = 16;
const MAX_STEPS = 60;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// ---------------------------------------------------------------------------
// Tipe state sesi
// ---------------------------------------------------------------------------

export interface ReportBrief {
  documentType?: string;          // skripsi | laporan praktikum | makalah | capstone | ...
  title?: string;
  topic?: string;
  course?: string;
  institution?: string;
  formatRules?: string;           // ketentuan format dari user (margin, font, bab wajib)
  citationStyle?: "APA" | "IEEE" | "Bebas";
  formality?: "ringkas" | "formal" | "akademik";
  journalRequirement?: JournalRequirement;
  minSources?: number;
  yearFrom?: number | null;
  language?: "id" | "en";
  targetLength?: string;          // mis. "60-80 halaman"
  notes?: string[];               // fakta penting lain dari user
}

export interface PlanSection {
  id: string;
  title: string;
  purpose: string;
  requiredDiagrams: string[];
}
export interface PlanDiagram {
  id: string;
  title: string;
  type: string;
  purpose: string;
  sectionId?: string;
  /** Diisi setelah job membuat diagram lewat engine UML Builder. */
  status?: "planned" | "approved" | "failed";
  diagramData?: ReportDiagramArtifact["diagramData"];
  svg?: string;
  flowSummary?: string;
}
export interface PlanTable { id: string; title: string; purpose: string; columns: string[]; sectionId?: string }
/** Ilustrasi (gambar AI, bukan diagram): dibuat otomatis oleh job via image job. */
export interface PlanFigure { id: string; title: string; caption: string; prompt: string; sectionId?: string }
export interface ReportPlan {
  outline: PlanSection[];
  diagrams: PlanDiagram[];
  tables: PlanTable[];
  figures: PlanFigure[];
  sourceQueries: string[];
  rationale?: string;
}

export interface SessionMaterial { id: string; kind: string; title: string; content: string; fileName?: string }

export interface AssistantTurnInput {
  sessionId: string;
  ownerId: string;
  message: string;
  deep?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("AI timeout")), ms); });
  try { return await Promise.race([p, timeout]); } finally { if (t) clearTimeout(t); }
}

const asObj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, max = 20) => asArr(v).map((x) => asStr(x, 160)).filter(Boolean).slice(0, max);

function slug(s: string, i: number) {
  return `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "bagian"}-${i + 1}`;
}

function normalizePlan(raw: unknown): ReportPlan {
  const o = asObj(raw);
  const outline: PlanSection[] = asArr(o.outline).map((s, i) => {
    const so = asObj(s);
    const title = asStr(so.title, 160) || `Bagian ${i + 1}`;
    return { id: asStr(so.id, 60) || slug(title, i), title, purpose: asStr(so.purpose, 500), requiredDiagrams: strList(so.requiredDiagrams, 6) };
  }).slice(0, 40);
  const diagrams: PlanDiagram[] = asArr(o.diagrams).map((d, i) => {
    const dobj = asObj(d);
    const status: PlanDiagram["status"] = dobj.status === "approved" || dobj.status === "failed" ? dobj.status : "planned";
    const diagramData = asObj(dobj.diagramData);
    const hasData = Array.isArray(diagramData.nodes) && diagramData.nodes.length > 0;
    return {
      id: asStr(dobj.id, 60) || `diagram-${i + 1}`,
      title: asStr(dobj.title, 160),
      type: asStr(dobj.type, 40) || "flowchart",
      purpose: asStr(dobj.purpose, 400),
      sectionId: asStr(dobj.sectionId, 60) || undefined,
      status: hasData ? "approved" : status,
      diagramData: hasData ? (diagramData as PlanDiagram["diagramData"]) : undefined,
      svg: typeof dobj.svg === "string" ? dobj.svg : undefined,
      flowSummary: asStr(dobj.flowSummary, 900) || undefined,
    };
  }).filter((d) => d.title).slice(0, 20);
  const tables: PlanTable[] = asArr(o.tables).map((t, i) => {
    const tobj = asObj(t);
    return { id: asStr(tobj.id, 60) || `tabel-${i + 1}`, title: asStr(tobj.title, 160), purpose: asStr(tobj.purpose, 400), columns: strList(tobj.columns, 10), sectionId: asStr(tobj.sectionId, 60) || undefined };
  }).filter((t) => t.title).slice(0, 20);
  const figures: PlanFigure[] = asArr(o.figures).map((f, i) => {
    const fo = asObj(f);
    const title = asStr(fo.title, 160);
    return { id: asStr(fo.id, 60) || `gambar-${i + 1}`, title, caption: asStr(fo.caption, 300) || title, prompt: asStr(fo.prompt, 1500), sectionId: asStr(fo.sectionId, 60) || undefined };
  }).filter((f) => f.title && f.prompt.length >= 8).slice(0, 8);
  return { outline, diagrams, tables, figures, sourceQueries: strList(o.sourceQueries, 8), rationale: asStr(o.rationale, 800) || undefined };
}

function mergeBrief(prev: ReportBrief, patch: unknown): ReportBrief {
  const p = asObj(patch);
  const next: ReportBrief = { ...prev };
  const setStr = (k: keyof ReportBrief, max = 300) => { const v = asStr(p[k], max); if (v) (next as Record<string, unknown>)[k] = v; };
  (["documentType", "title", "topic", "course", "institution", "formatRules", "targetLength"] as const).forEach((k) => setStr(k, k === "formatRules" ? 1500 : 300));
  const cs = asStr(p.citationStyle, 10).toUpperCase();
  if (cs === "APA" || cs === "IEEE" || cs === "BEBAS") next.citationStyle = cs === "BEBAS" ? "Bebas" : cs;
  const f = asStr(p.formality, 20);
  if (f === "ringkas" || f === "formal" || f === "akademik") next.formality = f;
  const jr = asStr(p.journalRequirement, 40) as JournalRequirement;
  if (jr && jr in JOURNAL_REQUIREMENT_LABEL) next.journalRequirement = jr;
  if (typeof p.minSources === "number" && p.minSources > 0) next.minSources = Math.min(60, Math.round(p.minSources));
  if (typeof p.yearFrom === "number" && p.yearFrom > 1900) next.yearFrom = Math.round(p.yearFrom);
  const lang = asStr(p.language, 4);
  if (lang === "id" || lang === "en") next.language = lang;
  const notes = strList(p.notes, 30);
  if (notes.length) next.notes = Array.from(new Set([...(prev.notes || []), ...notes])).slice(0, 40);
  return next;
}

function briefComplete(b: ReportBrief) {
  const missing: string[] = [];
  if (!b.documentType) missing.push("jenis dokumen");
  if (!b.title && !b.topic) missing.push("judul/topik");
  if (!b.journalRequirement) missing.push("syarat jurnal (SINTA/Scopus/bebas)");
  if (!b.citationStyle) missing.push("gaya sitasi");
  return missing;
}

/** Payload project yang dimengerti `startReportJob`/`compactProject`. */
async function buildProjectPayload(session: { id: string; ownerId: string; brief: ReportBrief; plan: ReportPlan; sources: VerifiedSource[]; materials: SessionMaterial[] }) {
  const b = session.brief;
  const mats = session.materials.length
    ? session.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, content: m.content, fileName: m.fileName }))
    : [{ id: "brief", kind: "note", title: "Brief dari percakapan", content: JSON.stringify(b) }];
  // Ilustrasi: gabungan rencana (prompt → job membuatkan) + image job yang sudah jadi (done, judul harus persis di placeholder).
  const imageJobs = await listImageJobs(session.ownerId, { sessionId: session.id, limit: 30 }).catch(() => []);
  const doneTitles = new Map(imageJobs.filter((job) => job.status === "done" && job.title).map((job) => [job.title!.trim().toLowerCase(), job.title!]));
  const activeTitles = new Set(imageJobs.filter((job) => job.status !== "failed" && job.title).map((job) => job.title!.trim().toLowerCase()));
  const planned = (session.plan.figures || []).map((f) => ({
    title: f.title,
    caption: f.caption || f.title,
    sectionId: f.sectionId,
    // Jangan mulai ulang job gambar yang sudah ada (selesai/berjalan).
    prompt: activeTitles.has(f.title.trim().toLowerCase()) ? undefined : f.prompt,
    done: doneTitles.has(f.title.trim().toLowerCase()),
  }));
  const plannedKeys = new Set(planned.map((f) => f.title.trim().toLowerCase()));
  const extraDone = Array.from(doneTitles.entries()).filter(([key]) => !plannedKeys.has(key)).map(([, title]) => ({ title, caption: title, sectionId: undefined, prompt: undefined, done: true }));
  const figures = [...planned, ...extraDone];
  return {
    reportSessionId: session.id,
    projectType: b.documentType || "report",
    title: b.title || b.topic || "Laporan",
    topic: b.topic || b.title || "",
    course: b.course || "",
    institution: b.institution || "",
    formality: b.formality || "akademik",
    citationStyle: b.citationStyle || "APA",
    formatRules: b.formatRules || "",
    sources: mats,
    outline: session.plan.outline.map((s) => ({ id: s.id, title: s.title, purpose: s.purpose, requiredDiagrams: s.requiredDiagrams })),
    // Diagram: yang sudah dibuat engine (approved + diagramData) dipakai apa adanya;
    // sisanya "planned" → job membuatkan lewat engine UML bila tipenya didukung.
    diagrams: session.plan.diagrams.map((d) => ({
      id: d.id,
      title: d.title,
      type: d.type,
      purpose: d.purpose,
      sectionId: d.sectionId,
      status: d.diagramData ? "approved" : "planned",
      caption: d.title,
      diagramData: d.diagramData,
      svg: d.svg,
      flowSummary: d.flowSummary,
    })),
    figures,
    tables: session.plan.tables.map((t) => ({ id: t.id, title: t.title, purpose: t.purpose, columns: t.columns, sectionId: t.sectionId })),
    references: session.sources.map((s) => ({
      query: s.title,
      purpose: s.venue,
      citation: s.citationApa,
      url: s.doiUrl || s.url || "",
      pdfUrl: s.pdfUrl || "",
      abstract: s.abstract,
      readLevel: s.readLevel,
    })),
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function systemPrompt(state: { stage: string; brief: ReportBrief; plan: ReportPlan | null; sources: VerifiedSource[]; materials: SessionMaterial[]; jobId: string | null; hasDraft: boolean; summary: string | null }) {
  const missing = briefComplete(state.brief);
  return `Anda adalah Asisten Laporan keluhkampus: pembimbing penulisan akademik yang mengobrol natural (bukan formulir), lalu MENGERJAKAN laporan/skripsi untuk pengguna.

ALUR:
1. INTAKE — ngobrol untuk memahami kebutuhan. Tanyakan hanya yang belum diketahui, maksimal 2-3 pertanyaan per giliran, bahasa santai-sopan. Wajib tahu: jenis dokumen, judul/topik, syarat jurnal (SINTA 1-2 / SINTA 1-4 / Scopus Q1-Q2 / Scopus / bebas) + jumlah minimal + tahun terbit minimal, gaya sitasi, ketentuan format kampus jika ada, bahan yang user punya (kode ZIP, data, catatan). Setiap fakta baru → panggil updateBrief.
2. PLANNED — bila brief cukup, panggil proposePlan (outline bab + sub-tujuan, daftar diagram, daftar tabel, daftar ilustrasi, query pencarian sumber) lalu panggil findSources untuk tiap query utama. Tampilkan ringkasan rencana + sumber dan minta persetujuan/koreksi.
3. EXECUTING — hanya setelah user setuju eksplisit ("oke", "eksekusi", "lanjut"), panggil startExecution. Jangan pernah memulai tanpa persetujuan.
4. DRAFTED — user bisa minta revisi bagian tertentu → panggil reviseSection dengan instruksi spesifik.
5. VISUAL — laporan tidak boleh polos. Saat proposePlan, pilah visual ke 3 jalur dan beri sectionId untuk masing-masing:
   a) diagrams type flowchart/usecase/activity/sequence → dibuat otomatis oleh engine UML Builder (vektor, bisa diedit user).
   b) diagrams type arsitektur/erd/class/konsep/kerangka → dibuat otomatis sebagai diagram vektor terstruktur (kotak komponen + relasi), BUKAN gambar AI.
   c) figures (ilustrasi: skema konsep, ilustrasi proses nyata, gambaran lingkungan/alat) → dibuat otomatis lewat model gambar di background saat eksekusi; prompt bahasa Inggris, gaya ilustrasi teknis bersih latar putih, tanpa teks panjang.
   Target: tiap bab inti (landasan teori, metode/perancangan, hasil) punya minimal 1 visual; bab pendahuluan boleh 1 ilustrasi; semua diberi sectionId. Setelah drafted, bila user minta gambar tambahan, pakai generateFigure (ilustrasi) — jangan untuk diagram.

ATURAN KEJUJURAN (mutlak):
- Sumber hanya dari hasil findSources (DOI terverifikasi Crossref). Jangan pernah menyebut/menyitir jurnal yang tidak ada di daftar sources.
- Peringkat SINTA/Scimago TIDAK bisa dipastikan otomatis; katakan bahwa sistem menyaring (ISSN/DOAJ/DOI) dan user memverifikasi tier lewat tautan "Cek Scimago/SINTA" yang disediakan. Jangan mengklaim "Q1" atau "SINTA 2" sebagai fakta.
- Sistem hanya membaca ABSTRAK sumber (readLevel=abstract), bukan teks penuh. Jangan bilang sudah membaca isi jurnal.
- Jangan janji lolos Turnitin/deteksi AI.
- Jangan mengarang isi bahan user; jika bahan belum diunggah, minta.

GAYA JAWABAN: Bahasa Indonesia, hangat tapi padat, markdown ringan. Setelah tool berjalan, jelaskan hasil singkat (UI sudah menampilkan detail rencana/sumber, jangan ulangi semuanya).

STATE SAAT INI (sumber kebenaran, bukan riwayat chat):
stage=${state.stage}; brief=${JSON.stringify(state.brief)}; briefKurang=${missing.join(", ") || "-"};
plan=${state.plan ? `${state.plan.outline.length} bab, ${state.plan.diagrams.length} diagram, ${state.plan.tables.length} tabel, ${state.plan.figures?.length || 0} ilustrasi` : "belum ada"};
sources=${state.sources.length} terverifikasi${state.sources.length ? ` (${state.sources.slice(0, 6).map((s) => `${s.authors[0] || "?"} ${s.year || ""}`).join("; ")})` : ""};
materials=${state.materials.length ? state.materials.map((m) => `${m.kind}:${m.title} (${m.content.length} char)`).join(", ") : "belum ada"};
job=${state.jobId || "-"}; draft=${state.hasDraft ? "ada" : "belum"}.${state.summary ? `\nRINGKASAN PERCAKAPAN LAMA: ${state.summary.slice(0, 1500)}` : ""}`;
}

const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "updateBrief",
      description: "Simpan fakta kebutuhan yang baru diketahui dari user. Panggil setiap kali ada info baru.",
      parameters: {
        type: "object",
        properties: {
          documentType: { type: "string" }, title: { type: "string" }, topic: { type: "string" }, course: { type: "string" }, institution: { type: "string" },
          formatRules: { type: "string", description: "Ketentuan format kampus apa adanya." },
          citationStyle: { type: "string", enum: ["APA", "IEEE", "Bebas"] },
          formality: { type: "string", enum: ["ringkas", "formal", "akademik"] },
          journalRequirement: { type: "string", enum: Object.keys(JOURNAL_REQUIREMENT_LABEL) },
          minSources: { type: "number" }, yearFrom: { type: "number" },
          language: { type: "string", enum: ["id", "en"] }, targetLength: { type: "string" },
          notes: { type: "array", items: { type: "string" }, description: "Fakta penting lain (nama sistem, entitas, metode, batasan)." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "proposePlan",
      description: "Buat/perbarui rencana: outline bab, diagram, tabel, dan query pencarian sumber. Sesuaikan dengan jenis dokumen & ketentuan format user.",
      parameters: {
        type: "object",
        properties: {
          outline: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, purpose: { type: "string" }, requiredDiagrams: { type: "array", items: { type: "string" } } }, required: ["title", "purpose"] } },
          diagrams: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, type: { type: "string", description: "UML: flowchart|usecase|activity|sequence. Non-UML (vektor terstruktur): arsitektur|erd|class|konsep|kerangka" }, purpose: { type: "string", description: "Isi spesifik yang harus tergambar (aktor, langkah, komponen) — bukan tujuan umum." }, sectionId: { type: "string" } }, required: ["title", "type", "purpose", "sectionId"] } },
          tables: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, purpose: { type: "string" }, columns: { type: "array", items: { type: "string" } }, sectionId: { type: "string" } }, required: ["title", "purpose", "sectionId"] } },
          figures: { type: "array", description: "Ilustrasi non-diagram (maks 6) yang dibuat model gambar saat eksekusi.", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string", description: "Judul singkat Bahasa Indonesia, mis. 'Ilustrasi Proses Fermentasi'." }, caption: { type: "string" }, prompt: { type: "string", description: "Deskripsi visual detail bahasa Inggris untuk model gambar." }, sectionId: { type: "string" } }, required: ["title", "prompt", "sectionId"] } },
          sourceQueries: { type: "array", items: { type: "string" }, description: "3-6 query pencarian literatur (bahasa Inggris & Indonesia)." },
          rationale: { type: "string" },
        },
        required: ["outline", "sourceQueries"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "findSources",
      description: "Cari & verifikasi referensi nyata (DOI Crossref, PDF). Hasil ditambahkan ke sources sesi. Gunakan syarat jurnal dari brief.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          limit: { type: "number", description: "default 6, maks 12" },
          replace: { type: "boolean", description: "true = ganti seluruh daftar sumber" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "startExecution",
      description: "Mulai penulisan penuh (job tahan lama) berdasarkan plan+sources+materials yang sudah disetujui user.",
      parameters: { type: "object", properties: { confirm: { type: "boolean" } }, required: ["confirm"] },
    },
  },
  {
    type: "function",
    function: {
      name: "reviseSection",
      description: "Tulis ulang satu bagian draft (berdasarkan judul heading) sesuai instruksi. Hanya saat stage=drafted.",
      parameters: { type: "object", properties: { sectionTitle: { type: "string" }, instruction: { type: "string" } }, required: ["sectionTitle", "instruction"] },
    },
  },
  {
    type: "function",
    function: {
      name: "generateFigure",
      description: "Buat gambar ilustrasi (bukan UML) lewat model gambar AI di background. Jika draft sudah ada dan sectionTitle diberikan, placeholder [Gambar: title - caption] disisipkan di akhir bagian itu agar ikut terekspor ke DOCX.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Judul singkat gambar, mis. 'Arsitektur Sistem'." },
          prompt: { type: "string", description: "Deskripsi visual detail dalam bahasa Inggris untuk model gambar." },
          caption: { type: "string", description: "Keterangan gambar untuk laporan (Bahasa Indonesia)." },
          sectionTitle: { type: "string", description: "Judul heading di draft tempat gambar ditempatkan (opsional)." },
        },
        required: ["title", "prompt"],
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

interface SessionState {
  id: string;
  ownerId: string;
  stage: string;
  brief: ReportBrief;
  plan: ReportPlan | null;
  sources: VerifiedSource[];
  materials: SessionMaterial[];
  jobId: string | null;
  draft: string | null;
  summary: string | null;
  title: string | null;
}

function loadState(row: { id: string; ownerId: string; stage: string; brief: unknown; plan: unknown; sources: unknown; materials: unknown; jobId: string | null; draft: string | null; summary: string | null; title: string | null }): SessionState {
  return {
    id: row.id,
    ownerId: row.ownerId,
    stage: row.stage,
    brief: asObj(row.brief) as ReportBrief,
    plan: row.plan ? normalizePlan(row.plan) : null,
    sources: asArr(row.sources) as VerifiedSource[],
    materials: asArr(row.materials) as SessionMaterial[],
    jobId: row.jobId,
    draft: row.draft,
    summary: row.summary,
    title: row.title,
  };
}

async function persist(state: SessionState) {
  await prisma.reportSession.update({
    where: { id: state.id },
    data: {
      stage: state.stage,
      title: state.title ?? state.brief.title ?? state.brief.topic ?? null,
      brief: state.brief as object,
      plan: (state.plan ?? undefined) as object | undefined,
      sources: state.sources as unknown as object,
      materials: state.materials as unknown as object,
      jobId: state.jobId,
      draft: state.draft,
    },
  });
}

function splitSections(markdown: string) {
  const lines = markdown.split("\n");
  const sections: { title: string; start: number; end: number }[] = [];
  lines.forEach((line, i) => {
    const m = /^(#{1,3})\s+(.+)$/.exec(line);
    if (m) sections.push({ title: m[2].trim(), start: i, end: lines.length });
  });
  sections.forEach((s, i) => { if (sections[i + 1]) s.end = sections[i + 1].start; });
  return { lines, sections };
}

async function runTool(state: SessionState, name: string, args: Record<string, unknown>, events: string[], emit: (text: string) => void = () => {}): Promise<unknown> {
  switch (name) {
    case "updateBrief": {
      state.brief = mergeBrief(state.brief, args);
      if (!state.title && (state.brief.title || state.brief.topic)) state.title = (state.brief.title || state.brief.topic || "").slice(0, 120);
      await persist(state);
      return { ok: true, brief: state.brief, missing: briefComplete(state.brief) };
    }
    case "proposePlan": {
      const plan = normalizePlan(args);
      if (!plan.outline.length) return { error: "Outline kosong." };
      state.plan = plan;
      if (state.stage === "intake") state.stage = "planned";
      await persist(state);
      events.push(`Rencana: ${plan.outline.length} bab, ${plan.diagrams.length} diagram, ${plan.tables.length} tabel, ${plan.figures.length} ilustrasi`);
      return { ok: true, outline: plan.outline.map((s) => s.title), diagrams: plan.diagrams.length, tables: plan.tables.length, figures: plan.figures.length, sourceQueries: plan.sourceQueries };
    }
    case "findSources": {
      const query = asStr(args.query, 300);
      if (!query) return { error: "Query kosong." };
      const limit = Math.min(12, Math.max(1, Number(args.limit) || 6));
      emit(`Mencari literatur "${query}" di Semantic Scholar, OpenAlex, Crossref…`);
      const found = await findVerifiedSources(query, {
        limit,
        requirement: state.brief.journalRequirement,
        yearFrom: state.brief.yearFrom ?? null,
        onProgress: emit,
      });
      const existing = args.replace ? [] : state.sources;
      const seen = new Set(existing.map((s) => s.id));
      const added = found.filter((s) => !seen.has(s.id));
      state.sources = [...existing, ...added].slice(0, 60);
      await persist(state);
      emit(`Ditemukan ${added.length} sumber baru terverifikasi (total ${state.sources.length})${added[0] ? `: ${added[0].authors[0] || "?"} ${added[0].year || ""}` : ""}`);
      events.push(`Sumber "${query}": ${added.length} baru (${state.sources.length} total)`);
      return {
        ok: true,
        query,
        added: added.map((s) => ({ id: s.id, apa: s.citationApa, doi: s.doiUrl, pdf: s.pdfStatus, signals: s.qualitySignals })),
        total: state.sources.length,
        note: "Peringkat SINTA/Scimago belum diverifikasi otomatis; user cek lewat tautan.",
      };
    }
    case "startExecution": {
      if (!args.confirm) return { error: "Butuh konfirmasi user." };
      if (!state.plan?.outline.length) return { error: "Belum ada rencana." };
      const minSources = state.brief.minSources || 0;
      if (minSources && state.sources.length < minSources) {
        return { error: `Sumber terverifikasi baru ${state.sources.length}, syarat minimal ${minSources}. Cari lagi dengan findSources atau minta user menurunkan syarat.` };
      }
      const payload = await buildProjectPayload({ id: state.id, ownerId: state.ownerId, brief: state.brief, plan: state.plan, sources: state.sources, materials: state.materials });
      const job = await startReportJob(payload, state.ownerId, "lengkap");
      state.jobId = job.id;
      state.stage = "executing";
      await persist(state);
      emit(`Job penulisan dibuat: ${job.totalSteps} bagian akan ditulis di background`);
      events.push(`Job penulisan dimulai (${job.totalSteps} langkah)`);
      return { ok: true, jobId: job.id, totalSteps: job.totalSteps };
    }
    case "reviseSection": {
      if (!state.draft) return { error: "Belum ada draft." };
      const target = asStr(args.sectionTitle, 200).toLowerCase();
      const instruction = asStr(args.instruction, 1500);
      const { lines, sections } = splitSections(state.draft);
      const idx = sections.findIndex((s) => s.title.toLowerCase().includes(target) || target.includes(s.title.toLowerCase()));
      if (idx < 0) return { error: `Bagian "${args.sectionTitle}" tidak ditemukan. Bagian yang ada: ${sections.map((s) => s.title).slice(0, 30).join(" | ")}` };
      const sec = sections[idx];
      const original = lines.slice(sec.start, sec.end).join("\n");
      const payload = await buildProjectPayload({ id: state.id, ownerId: state.ownerId, brief: state.brief, plan: state.plan ?? { outline: [], diagrams: [], tables: [], figures: [], sourceQueries: [] }, sources: state.sources, materials: state.materials });
      const planSec = state.plan?.outline.find((s) => s.title.toLowerCase() === sec.title.toLowerCase());
      // Placeholder gambar yang sudah ada di bagian ini harus dipertahankan.
      const keepPlaceholders = original.match(/\[Gambar:[^\]]+\]/g) || [];
      emit(`Menulis ulang bagian "${sec.title}"…`);
      const out = await generateChapter(payload, {
        index: idx,
        total: sections.length,
        section: { id: planSec?.id, title: sec.title, purpose: `${planSec?.purpose || ""}\n\nINSTRUKSI REVISI USER: ${instruction}\n\n${keepPlaceholders.length ? `PLACEHOLDER GAMBAR WAJIB DIPERTAHANKAN PERSIS: ${keepPlaceholders.join(" | ")}\n\n` : ""}VERSI SEBELUMNYA (perbaiki, jangan ulang kesalahan):\n${original.slice(0, 6000)}`, requiredDiagrams: planSec?.requiredDiagrams || [] },
        previousSummaries: sections.slice(Math.max(0, idx - 3), idx).map((s) => summarizeChapter(lines.slice(s.start, s.end).join("\n"))),
        mode: "lengkap",
      });
      if (out.source !== "ai") return { error: "AI gagal merevisi; coba lagi." };
      let revised = out.content.trim();
      const lost = keepPlaceholders.filter((p) => !revised.includes(p));
      if (lost.length) revised = `${revised}\n\n${lost.join("\n\n")}`;
      const next = [...lines.slice(0, sec.start), revised, ...lines.slice(sec.end)].join("\n");
      state.draft = next;
      await persist(state);
      events.push(`Bagian "${sec.title}" direvisi`);
      return { ok: true, section: sec.title, preview: out.content.slice(0, 600) };
    }
    case "generateFigure": {
      const title = asStr(args.title, 160);
      const prompt = asStr(args.prompt, 4000);
      if (!title || prompt.length < 8) return { error: "title dan prompt wajib diisi." };
      const caption = asStr(args.caption, 300) || title;
      const stylePrompt = `${prompt}\n\nStyle: clean technical illustration for an academic report, white background, flat vector look, high contrast, minimal text, no watermark.`;
      let job;
      try {
        job = await startImageJob({ ownerId: state.ownerId, prompt: stylePrompt, title, sessionId: state.id });
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Gagal memulai pembuatan gambar." };
      }
      let placed: string | null = null;
      const placeholder = `[Gambar: ${title} - ${caption}]`;
      if (state.draft && !state.draft.includes(`[Gambar: ${title}`)) {
        const target = asStr(args.sectionTitle, 200).toLowerCase();
        const { lines, sections } = splitSections(state.draft);
        let idx = target ? sections.findIndex((s) => s.title.toLowerCase().includes(target) || target.includes(s.title.toLowerCase())) : -1;
        // Tanpa section yang cocok: taruh di bagian level-2 terakhir sebelum Daftar Pustaka
        // (lebih baik ada di draft daripada hilang).
        if (idx < 0) {
          const bodySections = sections.filter((s) => !/daftar pustaka|referensi/i.test(s.title));
          const last = bodySections[bodySections.length - 1];
          idx = last ? sections.indexOf(last) : -1;
        }
        if (idx >= 0) {
          const sec = sections[idx];
          const next = [...lines.slice(0, sec.end), "", placeholder, "", ...lines.slice(sec.end)].join("\n");
          state.draft = next;
          placed = sec.title;
          await persist(state);
        }
      }
      events.push(`Gambar "${title}" diproses di background`);
      return {
        ok: true,
        jobId: job.id,
        title,
        placeholder,
        placedInSection: placed,
        note: "Gambar dibuat ±2 menit di background. Jika placeholder belum ditempatkan, user bisa menaruh teks placeholder di draft secara manual.",
      };
    }
    default:
      return { error: `Tool ${name} tidak dikenal.` };
  }
}

// ---------------------------------------------------------------------------
// Sinkronisasi job → draft (dipanggil tiap giliran & dari route status)
// ---------------------------------------------------------------------------

export async function syncJobIntoSession(state: SessionState): Promise<ReportJob | null> {
  if (!state.jobId) return null;
  const job = await getReportJob(state.jobId, state.ownerId);
  if (!job) return null;
  // Diagram yang sudah dibuat engine (di payload job) disalin ke rencana sesi
  // supaya tampil di panel Gambar & ikut ekspor DOCX, walau job belum selesai.
  const synced = await syncDiagramArtifacts(state);
  if (job.status === "done" && job.result && state.stage !== "drafted") {
    state.draft = job.result;
    state.stage = "drafted";
    await persist(state);
  } else if ((job.status === "failed" || job.status === "cancelled") && state.stage === "executing") {
    state.stage = "planned";
    await persist(state);
  } else if (synced) {
    await persist(state);
  }
  return job;
}

/** Salin artefak diagram dari payload job ke plan.diagrams. Return true bila ada perubahan. */
async function syncDiagramArtifacts(state: SessionState) {
  if (!state.jobId || !state.plan) return false;
  const row = await prisma.reportJob.findFirst({ where: { id: state.jobId, ownerId: state.ownerId }, select: { payload: true } });
  if (!row) return false;
  const artifacts = extractDiagramArtifacts(row.payload);
  if (!artifacts.length) return false;
  let changed = false;
  state.plan.diagrams = state.plan.diagrams.map((diagram) => {
    const artifact = artifacts.find((item) => item.id === diagram.id);
    if (!artifact || !artifact.diagramData || diagram.svg === artifact.svg) return diagram;
    changed = true;
    return { ...diagram, status: "approved", diagramData: artifact.diagramData, svg: artifact.svg, flowSummary: artifact.flowSummary };
  });
  return changed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getSessionState(sessionId: string, ownerId: string) {
  const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId } });
  if (!row) return null;
  const state = loadState(row);
  const job = await syncJobIntoSession(state);
  return { state, job };
}

export async function addSessionMaterial(sessionId: string, ownerId: string, material: Omit<SessionMaterial, "id">) {
  const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId } });
  if (!row) throw new Error("Sesi tidak ditemukan.");
  const state = loadState(row);
  const item: SessionMaterial = { id: `m${Date.now().toString(36)}`, ...material, content: material.content.slice(0, 120_000) };
  state.materials = [...state.materials, item].slice(0, 25);
  await persist(state);
  return item;
}

/** Eksekusi dari tombol UI (tanpa lewat AI). Mengembalikan jobId atau error. */
export async function executeSession(sessionId: string, ownerId: string, opts: { ignoreMinSources?: boolean } = {}) {
  const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId } });
  if (!row) throw new Error("Sesi tidak ditemukan.");
  const state = loadState(row);
  if (opts.ignoreMinSources) state.brief = { ...state.brief, minSources: 0 };
  const events: string[] = [];
  const result = asObj(await runTool(state, "startExecution", { confirm: true }, events));
  if (result.error) throw new Error(String(result.error));
  await prisma.reportMessage.create({ data: { sessionId, role: "assistant", content: `Penulisan dimulai (job ${state.jobId}). Pantau progres di panel kanan; setelah selesai, draft bisa direvisi per bagian lewat chat.`, toolCalls: { tools: ["startExecution"], events } } });
  return { jobId: state.jobId as string, stage: state.stage };
}

// ---------------------------------------------------------------------------
// Agent run (tahan lama, bisa dilanjutkan) — lihat agent-runs/engine.ts
// ---------------------------------------------------------------------------

const RUN_KIND = "laporan" as const;

/** Nama tool → kalimat progres yang dibaca user. */
function describeToolCall(name: string, args: Record<string, unknown>): string | null {
  switch (name) {
    case "updateBrief": return "Mencatat kebutuhan laporan…";
    case "proposePlan": return "Menyusun rencana outline, diagram, dan tabel…";
    case "findSources": return `Mencari sumber: "${asStr(args.query, 80)}"`;
    case "startExecution": return "Memulai penulisan penuh…";
    case "reviseSection": return `Merevisi bagian "${asStr(args.sectionTitle, 80)}"…`;
    case "generateFigure": return `Membuat gambar "${asStr(args.title, 80)}"…`;
    default: return null;
  }
}

/**
 * Buat run baru untuk pesan user ini. Jika ada run yang dijeda/antre dan user
 * mengetik "lanjut", run lama dilanjutkan (tidak mengulang dari awal).
 * Return id run; route kemudian men-stream `serveAgentRun`.
 */
export async function startReportAssistantRun(input: AssistantTurnInput): Promise<{ runId: string; resumed: boolean }> {
  const row = await prisma.reportSession.findFirst({ where: { id: input.sessionId, ownerId: input.ownerId } });
  if (!row) throw new Error("Sesi tidak ditemukan.");
  const state = loadState(row);
  await syncJobIntoSession(state);

  // Lanjutkan run yang belum selesai.
  const active = await findActiveAgentRun(input.ownerId, RUN_KIND, state.id);
  if (active) {
    if (active.status === "running") return { runId: active.id, resumed: true };
    if (active.status === "paused") await controlAgentRun(active.id, input.ownerId, "resume");
    if (!isContinueKeyword(input.message)) {
      await appendUserMessage(active.id, input.ownerId, input.message);
      await prisma.reportMessage.create({ data: { sessionId: state.id, role: "user", content: input.message } });
    }
    return { runId: active.id, resumed: true };
  }

  await prisma.reportMessage.create({ data: { sessionId: state.id, role: "user", content: input.message } });

  const all = await prisma.reportMessage.findMany({
    where: { sessionId: state.id, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true },
  });
  let recent = all;
  if (all.length > HISTORY_LIMIT) {
    const old = all.slice(0, all.length - HISTORY_LIMIT);
    recent = all.slice(-HISTORY_LIMIT);
    state.summary = await summarizeOld(old, state.summary);
    await prisma.reportSession.update({ where: { id: state.id }, data: { summary: state.summary } });
  }

  const messages: Msg[] = recent.map((m): Msg => ({ role: m.role as "user" | "assistant", content: m.content }));
  const run = await createAgentRun({
    ownerId: input.ownerId,
    kind: RUN_KIND,
    sessionId: state.id,
    model: input.deep ? AI_MODEL : AI_MODEL_FAST,
    messages,
    maxSteps: MAX_STEPS,
    meta: { events: [] },
  });
  return { runId: run.id, resumed: false };
}

async function loadSessionForRun(sessionId: string, ownerId: string): Promise<SessionState> {
  const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId } });
  if (!row) throw new Error("Sesi tidak ditemukan.");
  const state = loadState(row);
  await syncJobIntoSession(state);
  return state;
}

export const laporanAgentDriver: AgentDriver = {
  kind: RUN_KIND,
  tools: TOOL_DEFS,
  temperature: 0.3,
  maxTokens: 1800,
  describeToolCall,
  async systemPrompt(run) {
    const state = await loadSessionForRun(run.sessionId, run.ownerId);
    return `${systemPrompt({ stage: state.stage, brief: state.brief, plan: state.plan, sources: state.sources, materials: state.materials, jobId: state.jobId, hasDraft: Boolean(state.draft), summary: state.summary })}

MODE KERJA PANJANG: Anda berjalan sebagai proses tahan lama — boleh memanggil tool berkali-kali (mis. findSources untuk tiap query, satu per satu) sampai pekerjaan benar-benar selesai. Jangan berhenti di tengah untuk "melaporkan progres"; progres sudah tampil otomatis ke user. Setelah semua selesai, tulis satu jawaban akhir yang ringkas. Jika user mengetik "lanjut", teruskan dari langkah terakhir tanpa mengulang tool yang hasilnya sudah ada.`;
  },
  async runTool(name, args, ctx: AgentToolContext) {
    const state = await loadSessionForRun(ctx.run.sessionId, ctx.run.ownerId);
    const events: string[] = [];
    const result = await runTool(state, name, args, events, ctx.emit);
    return result;
  },
  async onFinish(run: AgentRunPublic) {
    if (run.status === "cancelled" && !run.reply) return;
    const content = run.reply || (run.status === "failed" ? `Maaf, proses gagal: ${run.error || "kesalahan tak dikenal"}. Ketik "lanjut" untuk mencoba meneruskan.` : "");
    if (!content) return;
    const toolEvents = run.events.filter((e) => e.level === "tool").map((e) => e.text);
    await prisma.reportMessage.create({
      data: {
        sessionId: run.sessionId,
        role: "assistant",
        content,
        toolCalls: run.toolsUsed.length ? { tools: Array.from(new Set(run.toolsUsed)), events: toolEvents.slice(-20), runId: run.id } : undefined,
      },
    });
  },
};

async function summarizeOld(messages: { role: string; content: string }[], prev: string | null): Promise<string> {
  const text = messages.map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join("\n");
  try {
    const r = await withTimeout(
      aiClient.chat.completions.create({
        model: AI_MODEL_FAST,
        messages: [
          { role: "system", content: "Ringkas percakapan berikut dalam ≤150 kata; pertahankan keputusan, preferensi, dan fakta proyek. Bahasa Indonesia." },
          { role: "user", content: `${prev ? `Ringkasan sebelumnya:\n${prev}\n\n` : ""}Percakapan:\n${text}` },
        ],
        temperature: 0.1,
        max_tokens: 350,
      }, { timeout: 15_000 }),
      16_000,
    );
    return stripThinking(r.choices[0]?.message?.content) || prev || "";
  } catch {
    return prev || "";
  }
}
