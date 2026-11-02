import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import * as intent from "../src/lib/report/report-intent.ts";
import * as figures from "../src/lib/report/figure-placeholders.ts";
import type * as Report from "../src/lib/report/generate-report.ts";
import type * as Assistant from "../src/lib/server/laporan/assistant.ts";
import type * as Jobs from "../src/lib/report/report-jobs.ts";

// Load the real pure assembly functions with paid/server/env dependencies denied.
const exports: Record<string, unknown> = {};
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/report/generate-report.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
vm.runInNewContext(compiled, {
  exports, process: { env: {} },
  require(id: string) {
    if (id === "@/lib/report/report-intent") return intent;
    if (id === "@/lib/report/figure-placeholders") return figures;
    if (id === "@/lib/ai/client") return { assertAiConfigured: () => { throw new Error("Paid/configured dependency forbidden"); } };
    if (id === "@/lib/ai/guard") return { UNTRUSTED_DATA_NOTICE: "Untrusted data", promptInline: (value: string) => value };
    if (id === "@/lib/errors") return {};
    throw new Error(`Unexpected import ${id}`);
  },
});
const report = exports as unknown as typeof Report;
const refs = [
  { id: "smith", doi: "10.1/smith", verified: true, authors: ["Smith, A."], year: "2020", title: "Smith Study", venue: "Journal One", citation: "Smith, A. (2020). Smith Study. Journal One." },
  { id: "jones", doi: "10.1/jones", verified: true, authors: ["Jones, B."], year: "2021", title: "Jones Study", venue: "Journal Two", citation: "Jones, B. (2021). Jones Study. Journal Two." },
];
const project = (mode = "full_report", extra = {}) => ({ title: "Scope Test", intent: intent.normalizeReportIntent({ outputMode: mode }), references: refs, outline: [{ id: "intro", title: "Pendahuluan" }, { id: "review", title: "Tinjauan Pustaka" }, { id: "method", title: "Metode" }], ...extra });

test("all four assembly modes honor bibliography and never fallback to all uncited sources", () => {
  for (const mode of ["full_report", "literature_review", "answer"]) {
    const result = report.assembleReport(project(mode), ["Penjelasan singkat tanpa sitasi."]);
    assert.doesNotMatch(result, /Smith Study|Jones Study|Daftar Pustaka/);
  }
  const citations = report.assembleReport(project("citations_only"), ["Ignore this narrative"]);
  assert.match(citations, /Smith Study/);
  assert.match(citations, /Jones Study/);
  assert.doesNotMatch(citations, /Ignore this narrative|Pendahuluan|Metode/);
  assert.equal(citations, report.assembleReport(project("citations_only"), []));
});

test("author/year matching belongs to the same reference, never a union of names and years", () => {
  const compact = report.compactProject(project());
  const mismatch = report.auditCitations("Smith dan Jones membahas 2020 dan 2021. (Smith, 2021).", compact);
  assert.equal(mismatch.unmatched.length, 1);
  assert.equal(mismatch.citedNumbers.length, 0);
  const result = report.assembleReport(project(), ["Temuan (Smith, 2020; Jones, 2021)."]);
  assert.match(result, /Smith Study/);
  assert.match(result, /Jones Study/);
  const narrative = report.assembleReport(project(), ["Smith (2020) menjelaskan hasil."]);
  assert.match(narrative, /Smith Study/);
  assert.doesNotMatch(narrative, /Jones Study/);
});

test("citation metadata is preserved and incomplete legacy entries are explicitly marked", () => {
  const compact = report.compactProject(project());
  assert.equal(compact.references[0].id, "smith");
  assert.equal(compact.references[0].doi, "10.1/smith");
  assert.equal(compact.references[0].verified, true);
  assert.equal(compact.references[0].authors[0], "Smith, A.");
  assert.equal(compact.references[0].year, "2020");
  assert.equal(compact.references[0].title, "Smith Study");
  assert.equal(compact.references[0].venue, "Journal One");
  const result = report.assembleReport(project("citations_only", { references: [{ citation: "Legacy, A. (2018). Old entry." }, { ...refs[0], selected: false }] }), []);
  assert.match(result, /Legacy, A/);
  assert.match(result, /Metadata belum tersedia: id, DOI, status verifikasi, penulis, tahun, judul, venue/);
  assert.doesNotMatch(result, /Smith Study/);
});

test("IEEE uses stable global numbers across chapters, numeric ranges and audit", () => {
  const data = project("full_report", { citationStyle: "IEEE" });
  const compact = report.compactProject(data);
  const result = report.assembleReport(data, ["Bagian awal [2].", "Bagian berikut [1-2], tidak dikenal [9]."]);
  assert.match(result, /\[1\] Smith, A/);
  assert.match(result, /\[2\] Jones, B/);
  assert.ok(result.indexOf("[1] Smith") < result.indexOf("[2] Jones"));
  assert.deepEqual(Array.from(report.auditCitations("Hasil [2].", compact).citedNumbers), [2]);
  assert.match(result, /\[9\]/);
  assert.equal(report.countDistinctCitations("Hasil [1, 2-3] dan [2]."), 3);
  assert.match(report.citationInstructions(compact), /GLOBAL/);
  assert.doesNotMatch(report.citationInstructions(compact), /gunakan \(Nama, Tahun\)/);
});

test("APA/Harvard prompt and same-author same-year ambiguity remain consistent", () => {
  assert.match(report.citationInstructions(report.compactProject(project("full_report", { citationStyle: "Harvard" }))), /Harvard.*\(Nama, Tahun\)/);
  const data = project("full_report", { references: [refs[0], { ...refs[0], id: "other", title: "Different Study" }] });
  assert.match(report.auditCitations("(Smith, 2020)", report.compactProject(data)).unmatched[0], /ambigu/);
  const suffix = project("full_report", { references: [{ ...refs[0], year: "2020a" }, { ...refs[0], id: "other", year: "2020b", title: "Different Study" }] });
  assert.deepEqual(Array.from(report.auditCitations("Smith (2020b)", report.compactProject(suffix)).citedNumbers), [2]);
});

test("scope-aware compact/fallback/normalization retains short answers without full draft replacement", () => {
  const answer = project("answer");
  assert.equal(report.compactProject(answer).outline.length, 1);
  assert.match(report.compactProject(answer).outline[0].title, /Jawaban/);
  const review = report.compactProject(project("literature_review"));
  assert.equal(review.outline.length, 1);
  assert.equal(review.outline[0].title, "Tinjauan Pustaka");
  assert.doesNotMatch(report.fallbackReport(project("literature_review")), /## Metode|## Penutup/);
  const short = report.normalizeReportOutput("Regresi memodelkan hubungan antarvariabel.", answer);
  assert.match(short, /Regresi memodelkan/);
  assert.doesNotMatch(short, /ISI|Draft sementara|Pendahuluan|Daftar Pustaka/);
  const scoped = project("full_report", { intent: intent.classifyReportIntent("Hanya bagian Hasil, maksimal 50 kata") });
  assert.match(report.normalizeReportOutput("Hasil belum tersedia.", scoped), /Hasil belum tersedia/);
});

test("stale planned visuals are gated but approved assets retained unless explicitly omitted", () => {
  const visual = { diagrams: [{ id: "new", title: "New", status: "planned" }, { id: "old", title: "Old", status: "approved", diagramData: { nodes: [] } }], figures: [{ title: "Paid", prompt: "generate" }, { title: "Ready", done: true }] };
  const compact = report.compactProject(project("literature_review", visual));
  assert.deepEqual(Array.from(compact.diagrams, (asset) => asset.title), ["Old"]);
  assert.deepEqual(Array.from(compact.figures, (asset) => asset.title), ["Ready"]);
  const omit = project("answer", { ...visual, intent: intent.classifyReportIntent("Jelaskan regresi tanpa diagram") });
  assert.equal(report.compactProject(omit).diagrams.length, 0);
  assert.doesNotMatch(report.assembleReport(omit, ["Isi.\n[Gambar: Old - caption]"]), /Gambar:/);
  assert.equal(report.compactProject(project("full_report", { ...visual, intent: intent.classifyReportIntent("Buat laporan lengkap, sertakan diagram") })).diagrams.length, 2);
});

test("citations-only generation and audit return before any configured paid dependency", async () => {
  const data = project("citations_only");
  assert.equal((await report.generateReportDraft(data)).source, "deterministic");
  const audited = await report.auditChapter(data, { content: "", sectionTitle: "", index: 0, total: 0, mode: "lengkap" });
  assert.equal(audited.tokensUsed, 0);
  assert.equal(audited.model, "deterministic");
  const generated = await report.generateChapter(data, { index: 0, total: 0, section: { title: "", purpose: "", requiredDiagrams: [] }, previousSummaries: [], mode: "lengkap" });
  assert.equal(generated.finishReason, "deterministic");
});

function loadOffline<T>(relative: string, dependencies: Record<string, unknown>): T {
  const output: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports: output, process: { env: {} }, crypto: webcrypto,
    require(id: string) { if (Object.hasOwn(dependencies, id)) return dependencies[id]; throw new Error(`Unexpected paid/server import ${id}`); },
  });
  return output as T;
}

test("report-job admission creates zero-step done citation artifact without paid child jobs", async () => {
  let saved: Record<string, unknown> = {};
  const jobs = loadOffline<typeof Jobs>("../src/lib/report/report-jobs.ts", {
    "@prisma/client": {},
    "@/lib/db/prisma": { prisma: { $transaction: async (work: (tx: unknown) => unknown) => work({
      $executeRaw: async () => 0,
      reportJob: { updateMany: async () => ({ count: 0 }), count: async () => 0, create: async ({ data }: { data: Record<string, unknown> }) => { saved = data; return { ...data, steps: [], createdAt: new Date(), updatedAt: new Date() }; } },
    }) } },
    "@/lib/report/generate-report": report,
    "@/lib/uml/pipeline": {}, "@/lib/uml/render-svg": {}, "@/lib/uml/render-concept": {},
    "@/lib/server/image-jobs": { startImageJob: () => { throw new Error("paid image forbidden"); } },
    "@/lib/security/redact-secrets": { sanitizeForPersistence: (value: unknown) => value },
    "@/lib/errors": { sanitizePublicErrorText: (text: string) => text }, "@/lib/report/figure-placeholders": figures, "@/lib/server/ai-budget": {},
  });
  const result = await jobs.startReportJob(project("citations_only", { diagrams: [{ title: "Stale", type: "flowchart" }], figures: [{ title: "Stale paid", prompt: "do not generate" }] }), "owner", "lengkap");
  assert.equal(result.status, "done");
  assert.equal(result.totalSteps, 0);
  assert.equal(result.tokensUsed, 0);
  assert.match(result.result || "", /Smith Study/);
  assert.equal(saved.source, "deterministic");
});

test("tool and direct UI execution persist deterministic draft, export and retain a pollable done job", async () => {
  let row = { id: "session", ownerId: "owner", stage: "intake", brief: { title: "Citations", intent: intent.classifyReportIntent("Hanya sitasi") }, sources: refs.map((ref) => ({ ...ref, doiVerified: true, citationApa: ref.citation })), materials: [], plan: null, draft: null, jobId: null, title: "Citations", summary: null } as Record<string, unknown>;
  let payload: Record<string, unknown> = {};
  let exportsCalled = 0;
  const messages: Array<Record<string, unknown>> = [];
  const assistant = loadOffline<typeof Assistant>("../src/lib/server/laporan/assistant.ts", {
    "@/lib/db/prisma": { prisma: { reportSession: { findFirst: async () => row, update: async ({ data }: { data: Record<string, unknown> }) => { row = { ...row, ...data }; return row; } }, reportMessage: { create: async ({ data }: { data: Record<string, unknown> }) => { messages.push(data); return data; } } } },
    "@/lib/errors": { toPublicErrorMessage: String }, "@/lib/ai/client": {}, "@/lib/ai/guard": { UNTRUSTED_DATA_NOTICE: "Untrusted data", wrapUntrusted: (_name: string, value: string) => value, promptInline: (value: string) => value },
    "@/lib/server/image-jobs": { listImageJobs: () => { throw new Error("citations-only should not load images"); } },
    "@/lib/references/find-sources": { JOURNAL_REQUIREMENT_LABEL: {} }, "@/lib/references/fetch-fulltext": {},
    "@/lib/report/report-jobs": { getReportJob: async () => null, startReportJob: async (data: Record<string, unknown>) => { payload = data; return { id: "done-citations-job", status: "done", totalSteps: 0, result: report.assembleReport(data, []) }; } },
    "@/lib/report/generate-report": report, "@/lib/uml/render-svg": {}, "@/lib/uml/theme": {},
    "./export-docx": { exportSessionDocx: async ({ draft }: { draft: string }) => { exportsCalled += 1; assert.match(draft, /Smith Study/); return { name: "citations.docx", url: "/files/citations", size: 100, pendingFigures: 0, missingImages: 0, missingImageTitles: [], pendingFigureTitles: [] }; } },
    "./material-tools": { MATERIAL_TOOL_DEFS: [], MATERIAL_TOOL_IMPL: {} }, "@/lib/storage/upload": {}, "@/lib/server/ai-budget": {},
    "@/lib/report/report-intent": intent, "@/lib/server/agent-runs/engine": {},
  });
  const direct = await assistant.executeSession("session", "owner");
  assert.equal(direct.jobId, "done-citations-job");
  assert.equal(direct.stage, "drafted");
  assert.equal(exportsCalled, 1);
  assert.match(String(messages[0].content), /citations.docx/);
  const reference = (payload.references as Array<Record<string, unknown>>)[0];
  assert.equal(reference.id, "smith");
  assert.equal(reference.verified, true);
  assert.equal(reference.doi, "10.1/smith");
  const tool = await assistant.laporanAgentDriver.runTool("startExecution", { confirm: true }, { run: { sessionId: "session", ownerId: "owner" }, emit: () => {}, attachments: [] } as never) as { deterministic: boolean; draft: string };
  assert.equal(tool.deterministic, true);
  assert.match(tool.draft, /Jones Study/);
  const prompt = await assistant.laporanAgentDriver.systemPrompt!({ sessionId: "session", ownerId: "owner" } as never);
  assert.match(prompt, /Jangan wajibkan jenis dokumen, syarat SINTA\/Scopus/);
  assert.doesNotMatch(prompt, /briefKurang=[^;\n]*jenis dokumen/);
});

test("message intake persists explicit follow-up intent before resuming a running model", async () => {
  let brief = { title: "Review", intent: intent.classifyReportIntent("Hanya tinjauan pustaka, maksimal 250 kata, tanpa daftar pustaka, tanpa diagram, gaya Harvard") };
  const history: string[] = [];
  const assistant = loadOffline<typeof Assistant>("../src/lib/server/laporan/assistant.ts", {
    "@/lib/db/prisma": { prisma: {
      reportSession: { findFirst: async () => ({ id: "session", ownerId: "owner", stage: "intake", brief, sources: [], materials: [], plan: null, jobId: null, draft: null }), update: async ({ data }: { data: { brief: typeof brief } }) => { brief = data.brief; } },
      reportMessage: { create: async ({ data }: { data: { content: string } }) => { history.push(data.content); } },
    } },
    "@/lib/errors": {}, "@/lib/ai/client": {}, "@/lib/ai/guard": {}, "@/lib/server/image-jobs": {},
    "@/lib/references/find-sources": { JOURNAL_REQUIREMENT_LABEL: {} }, "@/lib/references/fetch-fulltext": {}, "@/lib/report/report-jobs": {},
    "@/lib/report/generate-report": report, "@/lib/uml/render-svg": {}, "@/lib/uml/theme": {}, "./export-docx": {},
    "./material-tools": { MATERIAL_TOOL_DEFS: [], MATERIAL_TOOL_IMPL: {} }, "@/lib/storage/upload": {}, "@/lib/server/ai-budget": {},
    "@/lib/report/report-intent": intent,
    "@/lib/server/agent-runs/engine": { findActiveAgentRun: async () => ({ id: "run", status: "running" }), isContinueKeyword: (text: string) => text === "lanjut" },
  });
  const original = structuredClone(brief.intent);
  await assistant.startReportAssistantRun({ sessionId: "session", ownerId: "owner", message: "Jelaskan lebih detail", deep: false });
  assert.deepEqual(brief.intent, original);
  assert.equal(history[0], "Jelaskan lebih detail");
  await assistant.startReportAssistantRun({ sessionId: "session", ownerId: "owner", message: "Tambahkan gambar", deep: true });
  assert.equal(brief.intent.diagrams, "include");
  assert.equal(brief.intent.outputMode, "literature_review");
  assert.equal(brief.intent.scope.targetWords, 250);
  assert.equal(brief.intent.citations.bibliography, false);
});
