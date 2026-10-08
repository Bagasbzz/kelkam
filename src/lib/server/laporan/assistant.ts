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
import { aiClient, AI_MODEL, AI_MODEL_FAST } from "@/lib/ai/client";
import { findVerifiedSources, JOURNAL_REQUIREMENT_LABEL, type JournalRequirement, type VerifiedSource } from "@/lib/references/find-sources";
import { startReportJob, getReportJob, type ReportJob } from "@/lib/report/report-jobs";
import { generateChapter, summarizeChapter } from "@/lib/report/generate-report";

const MAX_STEPS = 6;
const HISTORY_LIMIT = 16;
const STEP_TIMEOUT_MS = 50_000;
const TURN_BUDGET_MS = 100_000;

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
export interface PlanDiagram { id: string; title: string; type: string; purpose: string; sectionId?: string }
export interface PlanTable { id: string; title: string; purpose: string; columns: string[]; sectionId?: string }
export interface ReportPlan {
  outline: PlanSection[];
  diagrams: PlanDiagram[];
  tables: PlanTable[];
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

export interface AssistantTurnResult {
  reply: string;
  toolsUsed: string[];
  stage: string;
  brief: ReportBrief;
  plan: ReportPlan | null;
  sources: VerifiedSource[];
  jobId: string | null;
  draft: string | null;
  model: string;
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
    return { id: asStr(dobj.id, 60) || `diagram-${i + 1}`, title: asStr(dobj.title, 160), type: asStr(dobj.type, 40) || "flowchart", purpose: asStr(dobj.purpose, 400), sectionId: asStr(dobj.sectionId, 60) || undefined };
  }).filter((d) => d.title).slice(0, 20);
  const tables: PlanTable[] = asArr(o.tables).map((t, i) => {
    const tobj = asObj(t);
    return { id: asStr(tobj.id, 60) || `tabel-${i + 1}`, title: asStr(tobj.title, 160), purpose: asStr(tobj.purpose, 400), columns: strList(tobj.columns, 10), sectionId: asStr(tobj.sectionId, 60) || undefined };
  }).filter((t) => t.title).slice(0, 20);
  return { outline, diagrams, tables, sourceQueries: strList(o.sourceQueries, 8), rationale: asStr(o.rationale, 800) || undefined };
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
function buildProjectPayload(session: { id: string; brief: ReportBrief; plan: ReportPlan; sources: VerifiedSource[]; materials: SessionMaterial[] }) {
  const b = session.brief;
  const mats = session.materials.length
    ? session.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, content: m.content, fileName: m.fileName }))
    : [{ id: "brief", kind: "note", title: "Brief dari percakapan", content: JSON.stringify(b) }];
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
    diagrams: session.plan.diagrams.map((d) => ({ id: d.id, title: d.title, type: d.type, purpose: d.purpose, approved: true, status: "planned", caption: d.title, dataSummary: d.purpose })),
    tables: session.plan.tables.map((t) => ({ id: t.id, title: t.title, purpose: t.purpose, columns: t.columns })),
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
2. PLANNED — bila brief cukup, panggil proposePlan (outline bab + sub-tujuan, daftar diagram/UML, daftar tabel, query pencarian sumber) lalu panggil findSources untuk tiap query utama. Tampilkan ringkasan rencana + sumber dan minta persetujuan/koreksi.
3. EXECUTING — hanya setelah user setuju eksplisit ("oke", "eksekusi", "lanjut"), panggil startExecution. Jangan pernah memulai tanpa persetujuan.
4. DRAFTED — user bisa minta revisi bagian tertentu → panggil reviseSection dengan instruksi spesifik.

ATURAN KEJUJURAN (mutlak):
- Sumber hanya dari hasil findSources (DOI terverifikasi Crossref). Jangan pernah menyebut/menyitir jurnal yang tidak ada di daftar sources.
- Peringkat SINTA/Scimago TIDAK bisa dipastikan otomatis; katakan bahwa sistem menyaring (ISSN/DOAJ/DOI) dan user memverifikasi tier lewat tautan "Cek Scimago/SINTA" yang disediakan. Jangan mengklaim "Q1" atau "SINTA 2" sebagai fakta.
- Sistem hanya membaca ABSTRAK sumber (readLevel=abstract), bukan teks penuh. Jangan bilang sudah membaca isi jurnal.
- Jangan janji lolos Turnitin/deteksi AI.
- Jangan mengarang isi bahan user; jika bahan belum diunggah, minta.

GAYA JAWABAN: Bahasa Indonesia, hangat tapi padat, markdown ringan. Setelah tool berjalan, jelaskan hasil singkat (UI sudah menampilkan detail rencana/sumber, jangan ulangi semuanya).

STATE SAAT INI (sumber kebenaran, bukan riwayat chat):
stage=${state.stage}; brief=${JSON.stringify(state.brief)}; briefKurang=${missing.join(", ") || "-"};
plan=${state.plan ? `${state.plan.outline.length} bab, ${state.plan.diagrams.length} diagram, ${state.plan.tables.length} tabel` : "belum ada"};
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
          diagrams: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, type: { type: "string", description: "flowchart|usecase|activity|sequence|class|erd|arsitektur" }, purpose: { type: "string" }, sectionId: { type: "string" } }, required: ["title", "type", "purpose"] } },
          tables: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, purpose: { type: "string" }, columns: { type: "array", items: { type: "string" } }, sectionId: { type: "string" } }, required: ["title", "purpose"] } },
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

async function runTool(state: SessionState, name: string, args: Record<string, unknown>, events: string[]): Promise<unknown> {
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
      events.push(`Rencana: ${plan.outline.length} bab, ${plan.diagrams.length} diagram, ${plan.tables.length} tabel`);
      return { ok: true, outline: plan.outline.map((s) => s.title), diagrams: plan.diagrams.length, tables: plan.tables.length, sourceQueries: plan.sourceQueries };
    }
    case "findSources": {
      const query = asStr(args.query, 300);
      if (!query) return { error: "Query kosong." };
      const limit = Math.min(12, Math.max(1, Number(args.limit) || 6));
      const found = await findVerifiedSources(query, {
        limit,
        requirement: state.brief.journalRequirement,
        yearFrom: state.brief.yearFrom ?? null,
      });
      const existing = args.replace ? [] : state.sources;
      const seen = new Set(existing.map((s) => s.id));
      const added = found.filter((s) => !seen.has(s.id));
      state.sources = [...existing, ...added].slice(0, 60);
      await persist(state);
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
      const payload = buildProjectPayload({ id: state.id, brief: state.brief, plan: state.plan, sources: state.sources, materials: state.materials });
      const job = await startReportJob(payload, state.ownerId, "lengkap");
      state.jobId = job.id;
      state.stage = "executing";
      await persist(state);
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
      const payload = buildProjectPayload({ id: state.id, brief: state.brief, plan: state.plan ?? { outline: [], diagrams: [], tables: [], sourceQueries: [] }, sources: state.sources, materials: state.materials });
      const planSec = state.plan?.outline.find((s) => s.title.toLowerCase() === sec.title.toLowerCase());
      const out = await generateChapter(payload, {
        index: idx,
        total: sections.length,
        section: { id: planSec?.id, title: sec.title, purpose: `${planSec?.purpose || ""}\n\nINSTRUKSI REVISI USER: ${instruction}\n\nVERSI SEBELUMNYA (perbaiki, jangan ulang kesalahan):\n${original.slice(0, 6000)}`, requiredDiagrams: planSec?.requiredDiagrams || [] },
        previousSummaries: sections.slice(Math.max(0, idx - 3), idx).map((s) => summarizeChapter(lines.slice(s.start, s.end).join("\n"))),
        mode: "lengkap",
      });
      if (out.source !== "ai") return { error: "AI gagal merevisi; coba lagi." };
      const next = [...lines.slice(0, sec.start), out.content.trim(), ...lines.slice(sec.end)].join("\n");
      state.draft = next;
      await persist(state);
      events.push(`Bagian "${sec.title}" direvisi`);
      return { ok: true, section: sec.title, preview: out.content.slice(0, 600) };
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
  if (job.status === "done" && job.result && state.stage !== "drafted") {
    state.draft = job.result;
    state.stage = "drafted";
    await persist(state);
  } else if ((job.status === "failed" || job.status === "cancelled") && state.stage === "executing") {
    state.stage = "planned";
    await persist(state);
  }
  return job;
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

export async function runReportAssistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
  const row = await prisma.reportSession.findFirst({ where: { id: input.sessionId, ownerId: input.ownerId } });
  if (!row) throw new Error("Sesi tidak ditemukan.");
  const state = loadState(row);
  await syncJobIntoSession(state);

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

  const messages: Msg[] = [
    { role: "system", content: systemPrompt({ stage: state.stage, brief: state.brief, plan: state.plan, sources: state.sources, materials: state.materials, jobId: state.jobId, hasDraft: Boolean(state.draft), summary: state.summary }) },
    ...recent.map((m): Msg => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const model = input.deep ? AI_MODEL : AI_MODEL_FAST;
  const toolsUsed: string[] = [];
  const events: string[] = [];
  let reply = "";
  const startedAt = Date.now();

  for (let step = 0; step < MAX_STEPS; step++) {
    const remaining = TURN_BUDGET_MS - (Date.now() - startedAt);
    if (remaining < 8_000) {
      reply = `Giliran ini sudah menjalankan: ${events.join("; ") || toolsUsed.join(", ")}. Lanjutkan dengan pesan berikutnya.`;
      break;
    }
    const stepTimeout = Math.min(STEP_TIMEOUT_MS, remaining - 3_000);
    const completion = await withTimeout(
      aiClient.chat.completions.create({ model, messages, tools: TOOL_DEFS, tool_choice: "auto", temperature: 0.3, max_tokens: 1800 }, { timeout: stepTimeout }),
      stepTimeout + 2000,
    );
    const msg = completion.choices[0]?.message;
    if (!msg) break;
    const calls = msg.tool_calls ?? [];
    if (!calls.length) { reply = msg.content?.trim() || ""; break; }

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; } catch { args = {}; }
      toolsUsed.push(call.function.name);
      let result: unknown;
      try { result = await runTool(state, call.function.name, args, events); }
      catch (err) { result = { error: err instanceof Error ? err.message : "Tool gagal." }; }
      const text = JSON.stringify(result);
      messages.push({ role: "tool", tool_call_id: call.id, content: text.length > 12_000 ? `${text.slice(0, 12_000)}…` : text });
    }
    // Refresh state block agar langkah berikutnya melihat state terbaru.
    messages[0] = { role: "system", content: systemPrompt({ stage: state.stage, brief: state.brief, plan: state.plan, sources: state.sources, materials: state.materials, jobId: state.jobId, hasDraft: Boolean(state.draft), summary: state.summary }) };
  }

  if (!reply) reply = events.length ? `Selesai: ${events.join("; ")}.` : "Maaf, saya belum bisa merespons. Coba ulangi dengan kalimat lain.";

  await prisma.reportMessage.create({ data: { sessionId: state.id, role: "assistant", content: reply, toolCalls: toolsUsed.length ? { tools: toolsUsed, events } : undefined } });

  return { reply, toolsUsed, stage: state.stage, brief: state.brief, plan: state.plan, sources: state.sources, jobId: state.jobId, draft: state.draft, model };
}

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
    return r.choices[0]?.message?.content?.trim() || prev || "";
  } catch {
    return prev || "";
  }
}
