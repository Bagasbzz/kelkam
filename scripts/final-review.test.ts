import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as intent from "../src/lib/report/report-intent.ts";
import * as figures from "../src/lib/report/figure-placeholders.ts";
import type * as Report from "../src/lib/report/generate-report.ts";
import type * as Review from "../src/lib/report/final-review.ts";

function load<T>(relative: string, dependencies: Record<string, unknown>): T {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports, process: { env: {} }, AbortController, setTimeout, clearTimeout,
    require(id: string) { if (Object.hasOwn(dependencies, id)) return dependencies[id]; throw new Error(`Unexpected import ${id}`); },
  });
  return exports as T;
}

const guard = { UNTRUSTED_DATA_NOTICE: "Untrusted data", promptInline: (value: string) => value };
const report = load<typeof Report>("../src/lib/report/generate-report.ts", {
  "@/lib/report/report-intent": intent,
  "@/lib/report/figure-placeholders": figures,
  "@/lib/ai/client": { assertAiConfigured: () => { throw new Error("paid dependency forbidden"); } },
  "@/lib/ai/guard": guard,
  "@/lib/errors": {},
});

function reviewWith(create: (request: { messages: Array<{ content: string }> }) => unknown) {
  return load<typeof Review>("../src/lib/report/final-review.ts", {
    "@/lib/ai/client": {
      aiClient: { chat: { completions: { create: async (request: { messages: Array<{ content: string }> }) => create(request) } } },
      AI_MODEL_REVIEW: "review-model",
      assertAiConfigured: () => undefined,
      stripThinking: (value: string) => value || "",
    },
    "@/lib/ai/guard": guard,
    "@/lib/report/generate-report": report,
    "@/lib/report/report-intent": intent,
  });
}

const refs = [{ id: "smith", doi: "10.1/smith", verified: true, authors: ["Smith, A."], year: "2020", title: "Smith Study", venue: "Journal One", citation: "Smith, A. (2020). Smith Study. Journal One." }];
const project = {
  title: "Sistem Perpustakaan",
  intent: intent.normalizeReportIntent({ outputMode: "full_report" }),
  references: refs,
  outline: [{ id: "intro", title: "Pendahuluan" }, { id: "review", title: "Tinjauan Pustaka" }, { id: "method", title: "Metode" }],
  auditContext: { userMessages: ["Buat laporan sistem perpustakaan dengan metode Waterfall"], notes: ["Metode Waterfall"] },
};
const chapters = [
  { title: "Pendahuluan", content: "## Pendahuluan\n\nPerpustakaan membutuhkan sistem (Smith, 2020).", placeholder: false },
  { title: "Tinjauan Pustaka", content: "## Tinjauan Pustaka\n\nTeori sistem informasi (Doe, 2019). [ISI DATA jumlah buku]", placeholder: false },
];

test("local checks flag missing chapters, data placeholders, and citations outside the selected sources", () => {
  const review = reviewWith(() => { throw new Error("not used"); });
  const issues = review.checkReportLocally(project, chapters);
  assert.ok(issues.some((issue) => issue.chapter === null && issue.severity === "berat" && /Metode/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.chapter === "Tinjauan Pustaka" && /ISI DATA/.test(issue.problem)));
  assert.ok(issues.some((issue) => issue.chapter === "Tinjauan Pustaka" && /Doe, 2019/.test(issue.problem)));
  assert.ok(!issues.some((issue) => issue.chapter === "Pendahuluan" && issue.severity !== "ringan"));
  const placeholder = review.checkReportLocally(project, [{ title: "Metode", content: "## Metode\n\n[ISI METODE: respons AI gagal]", placeholder: true }]);
  assert.ok(placeholder.some((issue) => issue.chapter === "Metode" && issue.severity === "berat"));
});

test("auditor verdict is derived from issue severity and chapter names are matched to real titles", async () => {
  let prompt = "";
  const review = reviewWith((request) => {
    prompt = request.messages.map((message) => message.content).join("\n");
    return { usage: { total_tokens: 1234 }, choices: [{ message: { content: '```json\n{"vonis":"lulus","ringkasan":"Hampir baik.","masalah":[{"bab":"BAB I Pendahuluan","tingkat":"sedang","masalah":"Metode Waterfall yang diminta pengguna tidak disebut.","perbaikan":"Sebutkan metode Waterfall."},{"bab":"","tingkat":"ringan","masalah":"Gaya kecil."}]}\n```' } }] };
  });
  const verdict = await review.reviewReport(project, { chapters, round: 1, localIssues: [] });
  assert.equal(verdict.verdict, "perbaiki");
  assert.equal(verdict.tokensUsed, 1234);
  assert.equal(verdict.issues[0].chapter, "Pendahuluan");
  assert.equal(verdict.issues[0].origin, "auditor");
  assert.equal(verdict.issues[1].chapter, null);
  assert.match(prompt, /Waterfall/);
  assert.match(prompt, /AUDITOR AKHIR/);
  assert.deepEqual(review.fixInstructions([verdict.issues[0]]), ["[sedang] Metode Waterfall yang diminta pengguna tidak disebut. → Sebutkan metode Waterfall."]);
  assert.equal(review.parseVerdict(JSON.stringify(verdict))?.verdict, "perbaiki");
  assert.equal(review.parseVerdict("bukan json"), null);
});

test("only light issues still pass, and an unavailable auditor falls back to local checks", async () => {
  const pass = reviewWith(() => ({ choices: [{ message: { content: '{"vonis":"lulus","ringkasan":"Rapi.","masalah":[{"bab":"Pendahuluan","tingkat":"ringan","masalah":"Typo."}]}' } }] }));
  assert.equal((await pass.reviewReport(project, { chapters, round: 2, localIssues: [] })).verdict, "lulus");
  const down = reviewWith(() => { throw new Error("timeout"); });
  const local = [{ chapter: "Pendahuluan", severity: "sedang" as const, problem: "x", fix: "", origin: "otomatis" as const }];
  const verdict = await down.reviewReport(project, { chapters, round: 1, localIssues: local });
  assert.equal(verdict.aiUnavailable, true);
  assert.equal(verdict.verdict, "perbaiki");
  const clean = await down.reviewReport(project, { chapters, round: 1, localIssues: [] });
  assert.equal(clean.verdict, "lulus");
  assert.equal(clean.aiUnavailable, true);
});

test("chapter writing survives a gateway that rejects streaming and gives the plain request the chapter budget", async () => {
  const calls: Array<{ stream: boolean; timeout?: number; extra: boolean }> = [];
  const writer = load<typeof Report>("../src/lib/report/generate-report.ts", {
    "@/lib/report/report-intent": intent,
    "@/lib/report/figure-placeholders": figures,
    "@/lib/ai/client": {
      AI_MODEL: "writer", AI_MODEL_FAST: "writer", AI_MODEL_REVIEW: "review-model",
      assertAiConfigured: () => undefined,
      stripThinking: (value: string) => value || "",
      stripDashes: (value: string) => value,
      aiClient: { chat: { completions: { create: async (body: Record<string, unknown>, options: { timeout?: number }) => {
        calls.push({ stream: Boolean(body.stream), timeout: options?.timeout, extra: "stream_options" in body });
        if (body.stream) throw Object.assign(new Error("400 unsupported parameter"), { status: 400 });
        return { choices: [{ message: { content: `## Pendahuluan\n\n${"Kalimat lengkap tentang topik ini. ".repeat(40)}` }, finish_reason: "stop" }], usage: { total_tokens: 10 } };
      } } } },
    },
    "@/lib/ai/guard": guard,
    "@/lib/errors": { isAbortLikeError: (error: unknown) => /timeout|timed out|aborted/i.test(String((error as Error)?.message)) },
  });
  const notes: string[] = [];
  const result = await writer.generateChapter(project, { index: 0, total: 3, section: { id: "intro", title: "Pendahuluan", purpose: "Latar belakang", requiredDiagrams: [] }, previousSummaries: [], mode: "lengkap", onEvent: (note: string) => notes.push(note) });
  assert.equal(result.source, "ai");
  assert.deepEqual(calls.map((call) => [call.stream, call.extra]), [[true, true], [true, false], [false, false]]);
  assert.ok((calls[2].timeout ?? 0) > 35_000, "plain request must not inherit the 35 s client default");
  assert.ok(notes.some((note) => /HTTP 400/.test(note)));
});

test("chapter title matching tolerates numbering and case", () => {
  const review = reviewWith(() => null);
  const titles = ["Pendahuluan", "Tinjauan Pustaka", "Hasil dan Pembahasan"];
  assert.equal(review.matchChapterTitle("BAB II TINJAUAN PUSTAKA", titles), "Tinjauan Pustaka");
  assert.equal(review.matchChapterTitle("4. Hasil dan Pembahasan", titles), "Hasil dan Pembahasan");
  assert.equal(review.matchChapterTitle("Lampiran", titles), null);
  assert.equal(review.matchChapterTitle("", titles), null);
});
