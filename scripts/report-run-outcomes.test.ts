import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getErrorMessage, toPublicAssistantMessage, toPublicErrorMessage } from "../src/lib/errors.ts";
import type { AgentRunPublic } from "../src/lib/server/agent-runs/engine.ts";

const assistantSource = readFileSync(new URL("../src/lib/server/laporan/assistant.ts", import.meta.url), "utf8");
const dashboardSource = readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
const assistantAst = ts.createSourceFile("assistant.ts", assistantSource, ts.ScriptTarget.Latest, true);
const dashboardAst = ts.createSourceFile("page.tsx", dashboardSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function findNode(node: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node | undefined {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => findNode(child, predicate));
}
function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }, fileName: "isolated.tsx" }).outputText;
}

interface SavedMessage {
  sessionId: string;
  role: string;
  content: string;
  toolCalls?: {
    tools: string[];
    events: string[];
    runId: string;
    status: AgentRunPublic["status"];
    error?: string;
    attachments?: AgentRunPublic["attachments"];
  };
}
const finish = findNode(assistantAst, (node) => ts.isMethodDeclaration(node) && node.name.getText(assistantAst) === "onFinish");
assert.ok(finish, "actual onFinish implementation must exist");
const finishCode = compile(`const driver = { ${finish.getText(assistantAst)} }; exports.onFinish = driver.onFinish;`);
function harness() {
  const saved: SavedMessage[] = [];
  const exports = {} as { onFinish: (run: AgentRunPublic) => Promise<void> };
  // Only execute the actual method; application modules, Prisma and provider code never load.
  vm.runInNewContext(finishCode, {
    exports, toPublicErrorMessage,
    prisma: { reportMessage: { create: async ({ data }: { data: SavedMessage }) => { saved.push(JSON.parse(JSON.stringify(data))); } } },
  });
  return { saved, onFinish: exports.onFinish };
}
function run(overrides: Partial<AgentRunPublic> = {}): AgentRunPublic {
  return {
    id: "run", kind: "laporan", sessionId: "session", status: "done", stepCount: 1, maxSteps: 20,
    events: [], toolsUsed: [], attachments: [], pendingQuestion: null, reply: "Jawaban biasa.", error: null,
    idleSeconds: 0, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", finishedAt: "2026-11-05T00:00:00Z",
    ...overrides,
  };
}

const messageMap = findNode(dashboardAst, (node) => ts.isCallExpression(node) && node.expression.getText(dashboardAst) === "messages.map");
assert.ok(messageMap && ts.isCallExpression(messageMap));
const renderer = {} as { renderMessage: (message: { id: string; role: string; content: string; toolCalls?: SavedMessage["toolCalls"] | null }) => ReactNode };
// Server-render the actual message JSX, not a fake DOM or a copy of its status logic.
vm.runInNewContext(compile(`exports.renderMessage = ${messageMap.arguments[0].getText(dashboardAst)};`), {
  exports: renderer, getErrorMessage, toPublicAssistantMessage, Bot: () => null,
  SimpleMarkdown: ({ text }: { text: string }) => createElement("div", { "data-reply": true }, text),
  require: (id: string) => {
    assert.equal(id, "react/jsx-runtime", "no application dependencies may load");
    return jsxRuntime;
  },
});
function render(message: SavedMessage) {
  return renderToStaticMarkup(renderer.renderMessage({ ...message, id: "message" }));
}

test("failed run with zero tools persists its status and sanitized error after reload", async () => {
  const h = harness();
  await h.onFinish(run({ status: "failed", reply: null, error: "402 No active plan at https://provider.example/billing sk-private-secret" }));
  assert.equal(h.saved.length, 1);
  const message = h.saved[0];
  assert.equal(message.sessionId, "session");
  assert.equal(message.role, "assistant");
  assert.deepEqual(message.toolCalls, {
    tools: [], events: [], runId: "run", status: "failed", error: toPublicErrorMessage("402 No active plan"),
  });
  assert.doesNotMatch(JSON.stringify(message), /402|https?:|provider|billing|sk-private/i);
  const html = render(JSON.parse(JSON.stringify(message)));
  assert.match(html, /role="status"/);
  assert.match(html, /Proses gagal, permintaan belum selesai/);
  assert.ok(html.indexOf("Proses gagal") < html.indexOf("data-reply"));
  assert.doesNotMatch(html, /Periksa langkah yang sudah tersimpan/);
});

test("a partial reply cannot hide a failed outcome or imply tools succeeded", async () => {
  const h = harness();
  await h.onFinish(run({ status: "failed", reply: "Berikut temuan sementara.", toolsUsed: ["findSources"], error: "timeout" }));
  assert.equal(h.saved[0].content, "Berikut temuan sementara.");
  const html = render(h.saved[0]);
  assert.match(html, /Proses gagal, permintaan belum selesai/);
  assert.match(html, /Berikut temuan sementara/);
  assert.match(html, /Periksa langkah yang sudah tersimpan/);
  assert.doesNotMatch(html, /berhasil disimpan|semua.*selesai|Sebagian langkah.*sudah tersimpan/i);
});

test("ordinary completion always persists metadata without a success badge", async () => {
  const h = harness();
  await h.onFinish(run());
  assert.deepEqual(h.saved[0].toolCalls, { tools: [], events: [], runId: "run", status: "done" });
  const html = render(h.saved[0]);
  assert.match(html, /Jawaban biasa/);
  assert.doesNotMatch(html, /role="status"|permintaan belum selesai|Periksa langkah|berhasil/i);
});

test("normal tool metadata keeps deduplication, recent tool events and attachments", async () => {
  const h = harness();
  const attachments = [{ fileId: "file", name: "laporan.docx", url: "/api/files/file", size: 2048 }];
  const events = Array.from({ length: 24 }, (_, i) => ({ t: String(i), level: "tool" as const, text: `Langkah ${i}` }));
  await h.onFinish(run({ toolsUsed: ["findSources", "exportDocx", "findSources"], attachments, events: [...events, { t: "25", level: "info", text: "Info" }] }));
  assert.deepEqual(h.saved[0].toolCalls, {
    tools: ["findSources", "exportDocx"], events: events.slice(-20).map((event) => event.text), runId: "run", status: "done", attachments,
  });
  assert.match(render(h.saved[0]), /findSources, exportDocx/);
  assert.doesNotMatch(render(h.saved[0]), /role="status"|Periksa langkah/);
});

test("cancelled partial replies are labelled, but empty cancellation and empty completion guards remain", async () => {
  const h = harness();
  await h.onFinish(run({ status: "cancelled", reply: null, toolsUsed: ["findSources"] }));
  await h.onFinish(run({ reply: null }));
  assert.equal(h.saved.length, 0);
  await h.onFinish(run({ status: "cancelled", reply: "Temuan sementara.", toolsUsed: ["findSources"] }));
  const html = render(h.saved[0]);
  assert.equal(h.saved[0].toolCalls?.status, "cancelled");
  assert.match(html, /Proses dibatalkan, permintaan belum selesai/);
  assert.match(html, /Periksa langkah yang sudah tersimpan/);
  assert.doesNotMatch(html, /Proses gagal/);
});

test("legacy messages without outcome metadata keep their ordinary rendering", () => {
  for (const toolCalls of [undefined, null, { tools: ["findSources"], events: [] }]) {
    const html = renderToStaticMarkup(renderer.renderMessage({ id: "old", role: "assistant", content: "Pesan lama.", toolCalls: toolCalls as SavedMessage["toolCalls"] | null }));
    assert.match(html, /Pesan lama/);
    assert.doesNotMatch(html, /role="status"|permintaan belum selesai|Periksa langkah/);
  }
  const messageType = findNode(dashboardAst, (node) => ts.isInterfaceDeclaration(node) && node.name.text === "ChatMessage");
  assert.ok(messageType);
  assert.match(messageType.getText(dashboardAst), /status\?: AgentRunPublic\["status"\]/);
});
