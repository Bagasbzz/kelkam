import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { AgentDriver, Msg } from "../src/lib/server/agent-runs/engine.ts";

// Execute the actual engine, replacing every application dependency before loading it.
// No Prisma client, environment configuration, driver modules or AI transport is loaded.
const source = readFileSync(new URL("../src/lib/server/agent-runs/engine.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
type Engine = typeof import("../src/lib/server/agent-runs/engine.ts");
class OfflineBudgetError extends Error {}
const call = (id: string, name = "write") => ({ id, type: "function" as const, function: { name, arguments: "{}" } });
const answer = (content = "Complete") => ({ choices: [{ message: { content }, finish_reason: "stop" }] });
const toolAnswer = (...ids: string[]) => ({ choices: [{ message: { content: "", tool_calls: ids.map((id) => call(id)) }, finish_reason: "tool_calls" }] });
function seed() {
  return {
    id: "run", ownerId: "owner", kind: "laporan", sessionId: "session", model: "offline", meta: {},
    status: "queued", lockToken: null as string | null, control: null as string | null,
    createdAt: new Date(), updatedAt: new Date(), heartbeatAt: new Date(), startedAt: null as Date | null,
    finishedAt: null as Date | null, stepCount: 0, maxSteps: 20,
    messages: [{ role: "user", content: "Do work" }] as Msg[], events: [], toolsUsed: [] as string[], attachments: [],
    pendingQuestion: null, reply: null as string | null, error: null as string | null,
  };
}
type Row = ReturnType<typeof seed>;
type Write = { where: Record<string, unknown>; data: Record<string, unknown> };
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((part) => matches(row, part));
    const actual = (row as unknown as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as { in?: unknown[]; not?: unknown; gte?: Date; lt?: Date };
      if (filter.in && !filter.in.includes(actual)) return false;
      if ("not" in filter && actual === filter.not) return false;
      if (filter.gte && (!(actual instanceof Date) || actual < filter.gte)) return false;
      if (filter.lt && (!(actual instanceof Date) || actual >= filter.lt)) return false;
      return true;
    }
    return actual === value;
  });
}
function harness(overrides: Partial<Row> = {}) {
  const row = Object.assign(seed(), overrides);
  const rows = [row];
  const writes: Write[] = [];
  const requests: Record<string, unknown>[] = [];
  const finishes: unknown[] = [];
  let heartbeat: (() => void) | undefined;
  let timeout: (() => void) | undefined;
  let inTransaction = false;
  let admissionLocked = false;
  const hooks = {
    beforeWrite: (_write: Write) => { void _write; },
    afterRead: () => {},
    complete: async (_request: Record<string, unknown>): Promise<unknown> => { void _request; return answer(); },
  };
  const read = () => {
    const snapshot = structuredClone(row);
    hooks.afterRead();
    return snapshot;
  };
  const agentRun = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => matches(row, where) ? read() : null,
    findUnique: async () => read(),
    findUniqueOrThrow: async () => read(),
    updateMany: async (write: Write) => {
      hooks.beforeWrite(write);
      writes.push(structuredClone(write));
      if (!matches(row, write.where)) return { count: 0 };
      Object.assign(row, structuredClone(Object.fromEntries(Object.entries(write.data).filter(([, value]) => value !== undefined))));
      return { count: 1 };
    },
    count: async ({ where }: { where: Record<string, unknown> }) => {
      assert.ok(inTransaction && admissionLocked, "admission count must hold transaction lock");
      return rows.filter((candidate) => matches(candidate, where)).length;
    },
    create: async ({ data }: { data: Partial<Row> }) => Object.assign(seed(), data),
  };
  const driver: AgentDriver = {
    kind: "laporan", tools: [{ type: "function", function: { name: "write", parameters: { type: "object" } } }],
    systemPrompt: async () => "Offline", runTool: async () => ({ ok: true }),
    onFinish: async (run) => { finishes.push(run); },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, AbortController,
    setTimeout: (callback: () => void) => { timeout = callback; return 2; }, clearTimeout: () => {},
    setInterval: (callback: () => void) => { heartbeat = callback; return 1; }, clearInterval: () => {},
    console: { warn: () => {}, error: () => {} },
    require: (id: string) => {
      if (id === "node:crypto") return { randomUUID: () => "worker-token" };
      if (id === "@/lib/db/prisma") return { prisma: {
        agentRun,
        $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
          inTransaction = true;
          try { return await work({ agentRun, $executeRaw: async () => { admissionLocked = true; } }); }
          finally { inTransaction = false; admissionLocked = false; }
        },
      } };
      if (id === "@/lib/ai/client") return {
        AI_MODEL_FAST: "offline", stripDashes: (s: string) => s, stripThinking: (s: string | null) => s || "",
        aiClient: { chat: { completions: { create: async (request: Record<string, unknown>) => {
          requests.push(structuredClone(request));
          return hooks.complete(request);
        } } } },
      };
      if (id === "@/lib/ai/guard") return { detectInjection: () => [], injectionWarning: () => "" };
      if (id === "@/lib/errors") return {
        sanitizePublicErrorText: (s: string) => s, toPublicAssistantMessage: (s: string) => s,
        toPublicErrorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
      };
      if (id === "@/lib/server/ai-budget") return { AiBudgetError: OfflineBudgetError, runWithAiOwner: (_owner: string, _operation: string, work: () => unknown) => work() };
      if (id === "@/lib/server/laporan/assistant") return { laporanAgentDriver: driver };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { engine: exports as Engine, row, rows, writes, requests, finishes, driver, hooks,
    serve: () => (exports as Engine).serveAgentRun("run", "owner", { budgetMs: 80_000 }),
    interrupt: async (control: string | null) => { row.control = control; if (control) heartbeat!(); else timeout!(); await new Promise<void>((resolve) => setImmediate(resolve)); },
  };
}
function toolResults(messages: Msg[]) { return messages.filter((message) => message.role === "tool"); }
function assertCompleteProtocol(messages: Msg[]) {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.tool_calls?.length) continue;
    const results = messages.slice(i + 1, i + 1 + message.tool_calls.length);
    assert.ok(results.every((result) => result.role === "tool"));
    assert.equal(JSON.stringify(results.map((result) => result.role === "tool" ? result.tool_call_id : "").sort()), JSON.stringify(message.tool_calls.map((item) => item.id).sort()));
  }
}

for (const status of ["done", "failed", "waiting_user", "cancelled"] as const) {
  test(`stale worker cannot finalize ${status} or invoke onFinish after takeover`, async () => {
    const h = harness();
    if (status === "failed") h.hooks.complete = async () => { throw new OfflineBudgetError("limit"); };
    if (status === "waiting_user") { h.driver.askUserTool = "write"; h.hooks.complete = async () => toolAnswer("ask"); }
    if (status === "cancelled") h.hooks.complete = async () => { await h.interrupt("cancel"); throw new Error("abort"); };
    h.hooks.beforeWrite = ({ data }) => {
      if (data.finishedAt) { h.row.lockToken = "new-worker"; h.row.reply = "new state"; }
    };
    const result = await h.serve();
    assert.equal(result.status, "running");
    assert.equal(h.row.lockToken, "new-worker");
    assert.equal(h.row.finishedAt, null);
    assert.equal(h.row.reply, "new state");
    assert.equal(h.finishes.length, 0);
    assert.equal(h.writes.find((write) => write.data.finishedAt)?.where.lockToken, "worker-token");
  });
}

for (const action of ["pause", "cancel", "resume"] as const) {
  test(`user ${action} CAS cannot overwrite a newly acquired claim`, async () => {
    const h = harness({ status: action === "resume" ? "paused" : "queued" });
    let first = true;
    h.hooks.afterRead = () => {
      if (!first) return;
      first = false;
      Object.assign(h.row, { status: "running", lockToken: "new-worker", control: null });
    };
    const result = await h.engine.controlAgentRun("run", "owner", action);
    assert.equal(result?.status, "running");
    assert.equal(h.row.lockToken, "new-worker");
    assert.equal(h.row.control, null);
    assert.equal(h.finishes.length, 0);
    assert.equal(h.writes[0].where.lockToken, null);
  });
}

test("resume repairs dangling calls before provider, preserves results, and never replays tools", async () => {
  const completed = '{"ok":true,"receipt":"already committed"}';
  const h = harness({ messages: [
    { role: "assistant", content: "", tool_calls: [call("finished"), call("uncertain")] },
    { role: "tool", tool_call_id: "finished", content: completed },
    { role: "user", content: "continue" },
    { role: "assistant", content: "", tool_calls: [call("never-checkpointed")] },
  ] });
  let executions = 0;
  h.driver.runTool = async () => { executions++; return {}; };
  h.hooks.complete = async (request) => {
    assertCompleteProtocol(request.messages as Msg[]);
    assertCompleteProtocol(h.row.messages);
    const results = toolResults(request.messages as Msg[]);
    assert.equal(results[0].content, completed);
    for (const result of results.slice(1)) assert.deepEqual(JSON.parse(String(result.content)).outcome, "unknown");
    return answer();
  };
  assert.equal((await h.serve()).status, "done");
  assert.equal(executions, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.finishes.length, 1);
});

test("forced final answer also receives repaired persisted tool protocol", async () => {
  const h = harness({ toolsUsed: Array(40).fill("write"), messages: [{ role: "assistant", content: "", tool_calls: [call("lost")] }] });
  h.hooks.complete = async (request) => { assertCompleteProtocol(request.messages as Msg[]); assertCompleteProtocol(h.row.messages); return answer(); };
  await h.serve();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].tools, undefined);
});

for (const control of ["pause", "cancel", null]) {
  test(`abort (${control ?? "timeout"}) preserves a tool that actually completed and marks only remaining calls unknown`, async () => {
    const h = harness();
    h.hooks.complete = async () => toolAnswer("completed", "not-started");
    let executed = 0;
    h.driver.runTool = async (_name, _args, ctx) => {
      executed++;
      assert.equal(toolResults(h.row.messages).length, 0);
      assert.equal(h.row.toolsUsed.length, 1);
      ctx.attachments.push({ fileId: "file", name: "receipt", url: "/file", size: 1 });
      await h.interrupt(control);
      return { receipt: "committed", __images: [{ dataUrl: "data:image/png;base64,AA==", label: "receipt" }] };
    };
    const result = await h.serve();
    assert.equal(result.status, control === "pause" ? "paused" : control === "cancel" ? "cancelled" : "queued");
    assert.equal(executed, 1);
    assert.equal(h.row.lockToken, null);
    const results = toolResults(h.row.messages);
    assert.equal(JSON.parse(String(results[0].content)).receipt, "committed");
    assert.equal(JSON.parse(String(results[1].content)).outcome, "unknown");
    assert.equal(h.row.attachments.length, 1);
    assert.ok(h.row.messages.some((message) => message.role === "user" && Array.isArray(message.content)));
    assert.equal(h.row.stepCount, 1);
    assertCompleteProtocol(h.row.messages);
  });
}

test("each completed batch result is durable before the next tool; thrown abort stays unknown", async () => {
  const h = harness();
  h.hooks.complete = async () => toolAnswer("first", "interrupted");
  let executed = 0;
  h.driver.runTool = async () => {
    executed++;
    if (executed === 1) return { receipt: "first committed" };
    assert.equal(JSON.parse(String(toolResults(h.row.messages)[0].content)).receipt, "first committed");
    await h.interrupt("pause");
    throw new Error("side effect may have happened before abort");
  };
  await h.serve();
  assert.equal(executed, 2);
  assert.equal(h.row.status, "paused");
  assert.equal(JSON.parse(String(toolResults(h.row.messages)[0].content)).receipt, "first committed");
  assert.equal(JSON.parse(String(toolResults(h.row.messages)[1].content)).outcome, "unknown");
});

const createInput = { ownerId: "owner", kind: "laporan" as const, sessionId: "session", model: "offline", messages: [] };
const expired = () => new Date(Date.now() - 25 * 60 * 60 * 1000);
test("admission ignores expired inactive queued/running/paused runs", async () => {
  const h = harness({ createdAt: expired(), status: "queued" });
  h.rows.push(Object.assign(seed(), { status: "paused", createdAt: expired() }), Object.assign(seed(), { status: "running", createdAt: expired(), lockToken: "stale", heartbeatAt: expired() }));
  assert.equal((await h.engine.createAgentRun(createInput)).status, "queued");
});

test("admission still counts old live locks and recent paused runs against owner cap", async () => {
  const h = harness({ createdAt: expired(), status: "running", lockToken: "live" });
  h.rows.push(Object.assign(seed(), { status: "paused" }), seed());
  await assert.rejects(h.engine.createAgentRun(createInput), OfflineBudgetError);
});

test("global admission retains old live claims even for another owner", async () => {
  const h = harness({ ownerId: "other", createdAt: expired(), status: "running", lockToken: "live" });
  for (let i = 1; i < 20; i++) h.rows.push(Object.assign(seed(), { ownerId: `other-${i}`, createdAt: expired(), status: "running", lockToken: "live" }));
  await assert.rejects(h.engine.createAgentRun(createInput), OfflineBudgetError);
});
