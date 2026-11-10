import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

export class AiBudgetError extends Error {
  readonly status = 429;
  constructor(message = "Batas pemakaian AI tercapai. Coba lagi besok.") { super(message); }
}

export interface AiOwnerContext { ownerId: string; operation: string; signal?: AbortSignal }
const owners = new AsyncLocalStorage<AiOwnerContext>();
export function runWithAiOwner<T>(ownerId: string, operation: string, fn: () => T, signal?: AbortSignal): T {
  if (!ownerId || typeof ownerId !== "string" || ownerId.length > 200) throw new AiBudgetError("Pemilik permintaan AI tidak valid.");
  return owners.run({ ownerId, operation: operation.replace(/[^\w:.-]/g, "_").slice(0, 80), signal }, fn);
}
export function getAiOwnerContext() { return owners.getStore(); }

export function budgetLimit(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AiBudgetError("Konfigurasi batas AI tidak valid.");
  return n;
}

export interface BudgetCharge { model: string; kind: "chat" | "image"; inputTokens: number; outputTokens: number; units: number; provider?: string }
export interface BudgetLimits { userUnits: number; globalUnits: number; userCalls: number; globalCalls: number; userImages: number; globalImages: number }
interface Counter { units: number; calls: number; images: number }
interface Ledger { version: 1; day: string; total: Counter; users: Record<string, Counter>; events: Array<Record<string, string | number>> }
const empty = (): Counter => ({ units: 0, calls: 0, images: 0 });

/**
 * Serializes the read/validate/admit/write sequence. Production uses a
 * transaction-scoped PostgreSQL advisory lock, which PostgreSQL releases on
 * commit, rollback, connection loss, or process crash. Tests inject an offline
 * implementation so they never need a database.
 */
export type AiBudgetLock = <T>(work: () => Promise<T>) => Promise<T>;
const budgetLocks = new AsyncLocalStorage<AiBudgetLock>();
/** Scoped dependency injection for offline callers/tests; never changes admission rules. */
export function runWithAiBudgetLock<T>(lock: AiBudgetLock, work: () => T): T {
  return budgetLocks.run(lock, work);
}

interface BudgetTransaction { $executeRaw: (query: TemplateStringsArray) => Promise<unknown> }
interface BudgetDatabase {
  $transaction: <T>(work: (tx: BudgetTransaction) => Promise<T>, options: { maxWait: number; timeout: number }) => Promise<T>;
}

export function createPostgresAiBudgetLock(database: BudgetDatabase): AiBudgetLock {
  return <T>(work: () => Promise<T>) => database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('keluhkampus:ai-budget:v1'))`;
    return work();
  }, { maxWait: 5000, timeout: 30_000 });
}

async function withPostgresAiBudgetLock<T>(work: () => Promise<T>): Promise<T> {
  try {
    const { prisma } = await import("@/lib/db/prisma");
    return await createPostgresAiBudgetLock(prisma as unknown as BudgetDatabase)(work);
  } catch (error) {
    if (error instanceof AiBudgetError) throw error;
    // A missing/unavailable DB must fail closed; do not fall back to an
    // uncoordinated filesystem lock that can diverge across hosts.
    throw new AiBudgetError("Anggaran AI tidak tersedia. Coba lagi nanti.");
  }
}

/**
 * Per-user caps are off until the owner decides to limit users (AI_USER_LIMITS_ENABLED=true);
 * while off, a user may use up to the site-wide cap. The site-wide cap is the emergency brake
 * on provider spend and always applies.
 */
export function aiBudgetLimits(): BudgetLimits {
  const globalUnits = budgetLimit(process.env.AI_DAILY_UNITS_GLOBAL, 200_000_000);
  const globalCalls = budgetLimit(process.env.AI_DAILY_CALLS_GLOBAL, 20_000);
  const globalImages = budgetLimit(process.env.AI_DAILY_IMAGES_GLOBAL, 300);
  const perUser = process.env.AI_USER_LIMITS_ENABLED === "true";
  return {
    userUnits: perUser ? budgetLimit(process.env.AI_DAILY_UNITS_USER, 600_000) : globalUnits,
    globalUnits,
    userCalls: perUser ? budgetLimit(process.env.AI_DAILY_CALLS_USER, 100) : globalCalls,
    globalCalls,
    userImages: perUser ? budgetLimit(process.env.AI_DAILY_IMAGES_USER, 3) : globalImages,
    globalImages,
  };
}

// These are deliberately conservative admission units, NOT a provider billing guarantee.
// Each retry is a separate transport call and is debited again, even on timeout/error.
export function estimateAiCharge(body: Record<string, unknown>, kind: "chat" | "image", fastModel: string): BudgetCharge {
  if (typeof body.model !== "string" || !body.model) throw new AiBudgetError("Model AI tidak valid.");
  let images = 0;
  if (body.audio || (Array.isArray(body.modalities) && body.modalities.some((item) => item !== "text"))) throw new AiBudgetError("Output AI nonteks belum didukung.");
  const input = JSON.stringify(body, (key, value: unknown) => {
    if (key === "image_url") { images++; return "[image]"; }
    if (key === "input_audio" || key === "file") throw new AiBudgetError("Jenis input AI belum didukung.");
    return value;
  });
  const bytes = Buffer.byteLength(input, "utf8");
  if (images > 8 || bytes + 1024 > 300_000) throw new AiBudgetError("Konteks AI terlalu besar. Persempit permintaan.");
  // Units follow estimated tokens (about 3 bytes per token for Indonesian/JSON text), not raw bytes,
  // so the daily brake matches real provider usage instead of counting 3-4x too high.
  const inputTokens = Math.ceil(bytes / 3) + images * 32_768 + 1024;
  const requested = body.max_completion_tokens ?? body.max_tokens;
  const outputTokens = kind === "image" ? 0 : Number(requested);
  if (kind === "chat" && (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || outputTokens > 8000 || (body.n !== undefined && body.n !== 1))) throw new AiBudgetError("Batas output AI tidak valid.");
  if (kind === "image" && (body.n !== 1 || body.size !== "1024x1024" || body.quality !== "low")) throw new AiBudgetError("Gunakan satu gambar 1024x1024 kualitas low.");
  return { model: body.model, kind, inputTokens, outputTokens, units: kind === "image" ? 150_000 + inputTokens : (inputTokens + outputTokens) * (body.model === fastModel ? 1 : 5) };
}

export async function reserveAiBudget(context: AiOwnerContext, charge: BudgetCharge, options: { directory?: string; limits?: BudgetLimits; now?: Date; lock?: AiBudgetLock } = {}) {
  if (!context.ownerId || !context.operation || !Number.isSafeInteger(charge.units) || charge.units <= 0) throw new AiBudgetError("Konteks anggaran AI tidak valid.");
  context.signal?.throwIfAborted();
  const lock = options.lock ?? budgetLocks.getStore() ?? withPostgresAiBudgetLock;
  return lock(() => reserveAiBudgetLocked(context, charge, options));
}

async function reserveAiBudgetLocked(context: AiOwnerContext, charge: BudgetCharge, options: { directory?: string; limits?: BudgetLimits; now?: Date; lock?: AiBudgetLock }) {
  context.signal?.throwIfAborted();
  const directory = options.directory ?? process.env.AI_BUDGET_DIR ?? path.join(process.cwd(), "uploads", ".ai-budget");
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
  const limits = options.limits ?? aiBudgetLimits();
  const owner = createHash("sha256").update(context.ownerId).digest("hex");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${day}.json`);
  const debits = path.join(directory, `${day}.debits`);
  await mkdir(debits, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  const temporary = path.join(debits, `${id}.tmp`);
  try {
    let ledger: Ledger;
    try { ledger = JSON.parse(await readFile(file, "utf8")) as Ledger; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AiBudgetError("Catatan anggaran AI tidak tersedia.");
      ledger = { version: 1, day, total: empty(), users: {}, events: [] };
    }
    const validCounter = (counter: Counter) => counter && [counter.units, counter.calls, counter.images].every((n) => Number.isSafeInteger(n) && n >= 0);
    if (ledger.version !== 1 || ledger.day !== day || !ledger.users || typeof ledger.users !== "object" || Array.isArray(ledger.users) || !validCounter(ledger.total) || !Object.values(ledger.users).every(validCounter) || !Array.isArray(ledger.events)) throw new AiBudgetError("Catatan anggaran AI tidak valid.");
    const sum = Object.values(ledger.users).reduce((total, counter) => ({ units: total.units + counter.units, calls: total.calls + counter.calls, images: total.images + counter.images }), empty());
    if (sum.units !== ledger.total.units || sum.calls !== ledger.total.calls || sum.images !== ledger.total.images) throw new AiBudgetError("Catatan anggaran AI tidak konsisten.");
    // Existing daily JSON is an immutable migration baseline. New debits are
    // immutable records: a transaction timeout cannot let a late filesystem
    // callback overwrite another writer's accounting. A failed transaction may
    // leave an extra debit, but its caller never receives provider admission.
    for (const name of await readdir(debits)) {
      if (!name.endsWith(".json")) continue;
      let debit: Record<string, unknown>;
      try { debit = JSON.parse(await readFile(path.join(debits, name), "utf8")); }
      catch { throw new AiBudgetError("Catatan debit AI tidak tersedia."); }
      if (!debit || typeof debit !== "object" || debit.day !== day || typeof debit.owner !== "string" || !/^[a-f0-9]{64}$/.test(debit.owner) || !Number.isSafeInteger(debit.units) || Number(debit.units) <= 0 || !["chat", "image"].includes(String(debit.kind))) throw new AiBudgetError("Catatan debit AI tidak valid.");
      const counter = ledger.users[debit.owner] ?? empty();
      for (const value of [counter, ledger.total]) { value.units += Number(debit.units); value.calls++; value.images += debit.kind === "image" ? 1 : 0; }
      ledger.users[debit.owner] = counter;
    }
    const currentUser = ledger.users[owner] ?? empty();
    const images = charge.kind === "image" ? 1 : 0;
    if (currentUser.units + charge.units > limits.userUnits || ledger.total.units + charge.units > limits.globalUnits || currentUser.calls + 1 > limits.userCalls || ledger.total.calls + 1 > limits.globalCalls || currentUser.images + images > limits.userImages || ledger.total.images + images > limits.globalImages) throw new AiBudgetError();
    const debit = { id, day, owner, operation: context.operation.replace(/[^\w:.-]/g, "_").slice(0, 80), kind: charge.kind, provider: (charge.provider ?? "configured-provider").replace(/[^\w.-]/g, "_").slice(0, 100), model: charge.model.replace(/[^\w.-]/g, "_").slice(0, 100), inputAllowance: charge.inputTokens, outputAllowance: charge.outputTokens, units: charge.units, accounting: "allowance-not-billed-usage", at: (options.now ?? new Date()).toISOString() };
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(debit)); await handle.sync(); } finally { await handle.close(); }
    context.signal?.throwIfAborted();
    await rename(temporary, path.join(debits, `${id}.json`));
    return id;
  } finally {
    await rm(temporary, { force: true });
  }
}
