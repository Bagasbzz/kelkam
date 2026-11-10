import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { AiBudgetError, aiBudgetLimits, budgetLimit, createPostgresAiBudgetLock, estimateAiCharge, getAiOwnerContext, reserveAiBudget, runWithAiOwner, runWithAiBudgetLock, type AiBudgetLock, type BudgetLimits } from "../src/lib/server/ai-budget.ts";

const limits: BudgetLimits = { userUnits: 100, globalUnits: 150, userCalls: 100, globalCalls: 100, userImages: 2, globalImages: 3 };
const charge = { model: "offline", kind: "chat" as const, inputTokens: 10, outputTokens: 10, units: 25 };
const now = new Date("2026-10-31T12:00:00.000Z");
const context = (ownerId: string) => ({ ownerId, operation: "offline-test" });

async function readDebits(directory: string, day = "2026-10-31") {
  const folder = path.join(directory, `${day}.debits`);
  return Promise.all((await readdir(folder)).filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(path.join(folder, name), "utf8"))));
}

function createOfflineLock(): AiBudgetLock {
  let tail = Promise.resolve();
  return async <T>(work: () => Promise<T>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  };
}

test("purpose routing: default is the writer model, fast and review are explicit", async () => {
  const { AI_MODEL, AI_MODEL_FAST, AI_MODEL_REVIEW, getModelForPurpose } = await import("../src/lib/ai/client.ts");
  assert.equal(getModelForPurpose(), AI_MODEL);
  assert.equal(getModelForPurpose("default"), AI_MODEL);
  assert.equal(getModelForPurpose("fast"), AI_MODEL_FAST);
  assert.equal(getModelForPurpose("review"), AI_MODEL_REVIEW);
});

test("writer model is AI_MODEL (Claude by default) and known-slow GPT-5/6 IDs fall back to defaults", async () => {
  const source = await readFile(new URL("../src/lib/ai/client.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = (env: Record<string, string>) => {
    const exports: Record<string, unknown> = {};
    vm.runInNewContext(compiled, {
      exports,
      process: { env },
      require: (id: string) => {
        if (id === "openai" || id === "@/lib/ai/guard" || id === "@/lib/server/safe-fetch") return {};
        if (id === "@/lib/server/ai-budget") return { budgetLimit };
        if (id === "@/lib/server/analytics") return { recordAiUsage: () => undefined, usageFromResponse: async () => ({}) };
        throw new Error(`Unexpected dependency: ${id}`);
      },
    });
    return exports;
  };
  const defaults = load({});
  assert.equal(defaults.AI_MODEL, "claude-sonnet-5");
  assert.equal(defaults.AI_MODEL_FAST, "deepseek-v4-flash-fast");
  assert.equal(defaults.AI_MODEL_REVIEW, "claude-sonnet-5");
  const slow = load({ AI_MODEL: "gpt-5.2", AI_MODEL_FAST: " gpt-6-sol ", AI_MODEL_REVIEW: "gpt-5" });
  assert.equal(slow.AI_MODEL, "claude-sonnet-5");
  assert.equal(slow.AI_MODEL_FAST, "deepseek-v4-flash-fast");
  assert.equal(slow.AI_MODEL_REVIEW, "claude-sonnet-5");
  const custom = load({ AI_MODEL: "writer-x", AI_MODEL_FAST: "fast-x", AI_MODEL_REVIEW: "vision-model" });
  assert.equal(custom.AI_MODEL_DEFAULT, "writer-x");
  assert.equal(custom.AI_MODEL_FAST, "fast-x");
  assert.equal(custom.AI_MODEL_REVIEW, "vision-model");
});

test("per-user AI caps stay off until explicitly enabled; the site-wide cap always applies", () => {
  const keys = ["AI_USER_LIMITS_ENABLED", "AI_DAILY_UNITS_USER", "AI_DAILY_UNITS_GLOBAL", "AI_DAILY_CALLS_USER", "AI_DAILY_CALLS_GLOBAL", "AI_DAILY_IMAGES_USER", "AI_DAILY_IMAGES_GLOBAL"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.AI_DAILY_UNITS_USER = "10";
    const open = aiBudgetLimits();
    assert.equal(open.userUnits, open.globalUnits, "a stray per-user value has no effect while limits are off");
    assert.equal(open.userCalls, open.globalCalls);
    assert.equal(open.userImages, open.globalImages);
    process.env.AI_USER_LIMITS_ENABLED = "true";
    const limited = aiBudgetLimits();
    assert.equal(limited.userUnits, 10);
    assert.equal(limited.userCalls, 100);
    assert.ok(limited.globalUnits > limited.userUnits);
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});

test("owner contexts isolate concurrent asynchronous work and never leak", async () => {
  await Promise.all(["alice", "bob"].map((owner) => runWithAiOwner(owner, "test", async () => {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(getAiOwnerContext()?.ownerId, owner);
  })));
  assert.equal(getAiOwnerContext(), undefined);
  assert.throws(() => runWithAiOwner("", "test", () => null), AiBudgetError);
});

test("allowances include UTF8 input, tools, full output, vision and premium weight", () => {
  const body = { model: "fast", max_tokens: 100, messages: [{ role: "user", content: "秘密" }], tools: [{ type: "function", function: { name: "offline" } }] };
  const fast = estimateAiCharge(body, "chat", "fast");
  assert.ok(fast.inputTokens > Buffer.byteLength("秘密"));
  assert.equal(fast.units, fast.inputTokens + 100);
  const review = estimateAiCharge({ ...body, model: "review" }, "chat", "fast");
  assert.equal(review.units, (review.inputTokens + review.outputTokens) * 5);
  assert.ok(estimateAiCharge({ ...body, messages: [{ content: [{ image_url: { url: "data:image/png;base64,AA==" } }] }] }, "chat", "fast").inputTokens > 32768);
  for (const output of [NaN, Infinity, -1, 0, 8001]) assert.throws(() => estimateAiCharge({ ...body, max_tokens: output }, "chat", "fast"), AiBudgetError);
  assert.throws(() => estimateAiCharge({ ...body, n: 2 }, "chat", "fast"), AiBudgetError);
  assert.throws(() => estimateAiCharge({ ...body, messages: [{ content: "x".repeat(300000) }] }, "chat", "fast"), AiBudgetError);
  assert.throws(() => estimateAiCharge({ model: "image", n: 2, size: "1024x1024", quality: "low" }, "image", "fast"), AiBudgetError);
  for (const value of ["NaN", "Infinity", "0", "-1", "1.5"]) assert.throws(() => budgetLimit(value, 10), AiBudgetError);
});

test("atomic user AND global daily limits survive concurrent reservations and reload", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-"));
  try {
    const options = { directory, limits, now, lock: createOfflineLock() };
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => reserveAiBudget(context("alice"), charge, options)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 4);
    await reserveAiBudget(context("bob"), charge, options);
    await reserveAiBudget(context("bob"), charge, options);
    await assert.rejects(reserveAiBudget(context("charlie"), charge, options), AiBudgetError);
    const debits = await readDebits(directory);
    const raw = JSON.stringify(debits);
    assert.equal(debits.reduce((sum, debit) => sum + debit.units, 0), 150);
    assert.equal(debits.length, 6);
    assert.doesNotMatch(raw, /alice|bob|charlie|secret|prompt|apiKey/);
    assert.equal(debits[0].inputAllowance, 10);
    await reserveAiBudget(context("alice"), charge, { ...options, now: new Date("2026-11-01T00:00:00Z") });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("multiple Node processes share one atomic global ledger", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-process-"));
  try {
    const helper = fileURLToPath(new URL("../src/lib/server/ai-budget.ts", import.meta.url));
    // IPC coordinator models the DB transaction lock; no database/network or
    // persistent mkdir mutex is used by this cross-process accounting test.
    const lockCode = `async function lock(work){const granted=new Promise(resolve=>process.once('message',resolve));process.send('acquire');await granted;try{return await work()}finally{process.send('release')}}`;
    const code = `const {reserveAiBudget}=require(${JSON.stringify(helper)});${lockCode} (async()=>{try {await reserveAiBudget({ownerId:'worker',operation:'process-test'},${JSON.stringify(charge)},{...${JSON.stringify({ directory, limits: { ...limits, userUnits: 50, globalUnits: 50 } })},lock});process.exitCode=0;} catch {process.exitCode=2;} finally {process.disconnect();}})();`;
    const queue: Array<ReturnType<typeof spawn>> = [];
    let held: ReturnType<typeof spawn> | null = null;
    const grant = () => { if (!held && queue.length) { held = queue.shift()!; held.send("granted"); } };
    const exits = await Promise.all(Array.from({ length: 4 }, () => new Promise<number>((resolve, reject) => {
      // Use the project's TS loader on Node 20 too, not Node 22+ type stripping.
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=commonjs", "-e", code], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.on("message", (message) => {
        if (message === "acquire") { queue.push(child); grant(); }
        if (message === "release" && held === child) { held = null; grant(); }
      });
      child.on("error", reject);
      child.on("exit", (exit) => {
        if (held === child) { held = null; grant(); }
        if (exit !== 0 && exit !== 2) { reject(new Error(`Budget worker exited ${exit}: ${stderr}`)); return; }
        resolve(exit);
      });
    })));
    assert.equal(exits.filter((exit) => exit === 0).length, 2);
    assert.equal(exits.filter((exit) => exit === 2).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("PostgreSQL transaction adapter holds advisory lock through persisted debit and releases on every outcome", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-transaction-"));
  const serialize = createOfflineLock();
  let held = false;
  let releases = 0;
  const lock = createPostgresAiBudgetLock({
    $transaction: (work, options) => serialize(async () => {
      assert.deepEqual(options, { maxWait: 5000, timeout: 30000 });
      try {
        return await work({ $executeRaw: async (query) => {
          assert.match(query.join(""), /pg_advisory_xact_lock/);
          held = true;
        } });
      } finally { held = false; releases++; }
    }),
  });
  try {
    await lock(async () => {
      assert.equal(held, true);
      await reserveAiBudget(context("alice"), charge, { directory, limits, now, lock: async (work) => work() });
      assert.equal((await readDebits(directory))[0].units, 25);
      throw new Error("post-debit failure");
    }).then(() => assert.fail("must reject"), (error) => assert.match(error.message, /post-debit failure/));
    assert.equal(held, false);
    await reserveAiBudget(context("alice"), charge, { directory, limits, now, lock });
    const debits = await readDebits(directory);
    assert.equal(debits.reduce((sum, debit) => sum + debit.units, 0), 50);
    assert.equal(debits.length, 2);
    assert.equal(releases, 2);
    const unavailable = createPostgresAiBudgetLock({ $transaction: async () => { throw new Error("offline DB unavailable"); } });
    await assert.rejects(reserveAiBudget(context("bob"), charge, { directory, limits, now, lock: unavailable }), /offline DB unavailable/);
    assert.equal((await readDebits(directory)).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("corrupt ledger fails closed, injected lock releases on error, and legacy abandoned lock is harmless", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-fail-"));
  try {
    await writeFile(path.join(directory, "2026-10-31.json"), "not json");
    const lock = createOfflineLock();
    await assert.rejects(reserveAiBudget(context("alice"), charge, { directory, limits, now, lock }), AiBudgetError);
    await rm(path.join(directory, "2026-10-31.json"), { force: true });
    await mkdir(path.join(directory, "ledger.lock"));
    await reserveAiBudget(context("alice"), charge, { directory, limits, now, lock });
    const persisted = await readDebits(directory);
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].units, charge.units);
    await rm(path.join(directory, "ledger.lock"), { recursive: true, force: true });
    await reserveAiBudget(context("alice"), charge, { directory, limits, now, lock });
    assert.equal((await readDebits(directory)).length, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(reserveAiBudget({ ...context("alice"), signal: controller.signal }, charge, { directory, limits, now, lock }));
    await reserveAiBudget(context("bob"), charge, { directory, limits, now, lock });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy daily debits are preserved as an immutable baseline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-baseline-"));
  const owner = (await import("node:crypto")).createHash("sha256").update("alice").digest("hex");
  const baseline = JSON.stringify({ version: 1, day: "2026-10-31", total: { units: 75, calls: 3, images: 0 }, users: { [owner]: { units: 75, calls: 3, images: 0 } }, events: [] });
  try {
    await writeFile(path.join(directory, "2026-10-31.json"), baseline);
    const options = { directory, limits, now, lock: createOfflineLock() };
    await reserveAiBudget(context("alice"), charge, options);
    await assert.rejects(reserveAiBudget(context("alice"), charge, options), AiBudgetError);
    assert.equal(await readFile(path.join(directory, "2026-10-31.json"), "utf8"), baseline);
    assert.equal((await readDebits(directory)).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a late callback after transaction loss cannot overwrite newer debit records", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-late-"));
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => { resume = resolve; });
  let late: Promise<unknown> | undefined;
  const lostLock: AiBudgetLock = async (work) => {
    late = gate.then(work);
    throw new Error("simulated lost transaction");
  };
  try {
    await assert.rejects(reserveAiBudget(context("alice"), charge, { directory, limits, now, lock: lostLock }), /lost transaction/);
    const options = { directory, limits, now, lock: createOfflineLock() };
    await reserveAiBudget(context("bob"), charge, options);
    resume();
    await late;
    const debits = await readDebits(directory);
    assert.equal(debits.length, 2);
    assert.equal(debits.reduce((sum, debit) => sum + debit.units, 0), 50);
    await reserveAiBudget(context("bob"), charge, options);
    assert.equal((await readDebits(directory)).length, 3);
  } finally { resume(); await rm(directory, { recursive: true, force: true }); }
});

test("transport charges before network, charges failures, denies other SDK surfaces", async () => {
  const { AI_MODEL_FAST, budgetedAiFetch } = await import("../src/lib/ai/client.ts");
  const directory = await mkdtemp(path.join(os.tmpdir(), "security-ai-transport-"));
  const previousDirectory = process.env.AI_BUDGET_DIR;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  process.env.AI_BUDGET_DIR = directory;
  globalThis.fetch = async (_input, init) => { calls++; assert.equal(init?.redirect, "error"); throw new Error("offline transport failure"); };
  try {
    await runWithAiBudgetLock(createOfflineLock(), () => runWithAiOwner("transport-owner", "test", async () => {
      const request = { method: "POST", body: JSON.stringify({ model: AI_MODEL_FAST, max_tokens: 100, messages: [{ role: "user", content: "private prompt" }] }) };
      await assert.rejects(budgetedAiFetch("https://api.z0ne.ai/v1/chat/completions", request), /offline transport failure/);
      await assert.rejects(budgetedAiFetch("https://api.z0ne.ai/v1/chat/completions", request), /offline transport failure/);
      await assert.rejects(budgetedAiFetch("https://api.z0ne.ai/v1/responses", request), AiBudgetError);
      await assert.rejects(budgetedAiFetch("https://other.invalid/v1/chat/completions", request), AiBudgetError);
    }));
    assert.equal(calls, 2);
    const debits = await readDebits(directory, new Date().toISOString().slice(0, 10));
    assert.equal(debits.length, 2);
    assert.doesNotMatch(JSON.stringify(debits), /private prompt|transport-owner/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDirectory === undefined) delete process.env.AI_BUDGET_DIR; else process.env.AI_BUDGET_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});

test("owned execution surfaces retain claims and enforce cumulative bounds", async () => {
  const report = await readFile(new URL("../src/lib/report/report-jobs.ts", import.meta.url), "utf8");
  const image = await readFile(new URL("../src/lib/server/image-jobs.ts", import.meta.url), "utf8");
  const agent = await readFile(new URL("../src/lib/server/agent-runs/engine.ts", import.meta.url), "utf8");
  const revision = await readFile(new URL("../src/app/api/ai/revise-report/route.ts", import.meta.url), "utf8");
  assert.match(report, /FOR UPDATE/);
  assert.match(report, /updatedAt: next\.updatedAt/);
  assert.doesNotMatch(report, /attempts: 0|Promise\.race/);
  assert.match(report, /const MAX_STEPS = 20/);
  assert.match(report, /const MAX_TOTAL_ATTEMPTS = 400/);
  assert.match(image, /pg_advisory_xact_lock/);
  assert.match(image, /attempts: \{ lt: MAX_ATTEMPTS \}/);
  assert.match(agent, /const MAX_TOOLS_PER_RUN = 40/);
  assert.match(agent, /const MAX_TOOLS_PER_STEP = 4/);
  assert.match(revision, /revisionMode === "format"/);
  assert.doesNotMatch(revision, /task === "format"/);
});
