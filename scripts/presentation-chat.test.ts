import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createStarterDeck, type PresentationDeck } from "../src/lib/presentation/model.ts";
import { STYLE_EXAMPLES } from "../src/lib/presentation/design.ts";
import {
  chatTurnSchema, enforceAiDeck, envelopeSchema, MAX_CHAT_SLIDES, planInputSchema, planSchema, PresentationError, projectPayload,
  type PresentationEnvelope, type RunOperation,
} from "../src/lib/server/presentasi/state.ts";
import { CHAT_TOOLS, CHAT_TOOL_NAMES, chatSystemPrompt, evidenceFrom, runChatTool } from "../src/lib/server/presentasi/chat.ts";
import { planArtSchema } from "../src/lib/server/presentasi/art.ts";

const base = (): PresentationEnvelope => ({ kind: "presentation", schemaVersion: 1, revision: 1, updatedAt: "2026-11-07T00:00:00.000Z", deck: createStarterDeck("editorial"), history: [] });
const chat = (message = "Buatkan presentasi sidang dari laporan saya."): RunOperation => ({ operation: "chat", baseRevision: 1, message });
const clone = <T>(value: T): T => structuredClone(value);
const plan = () => ({
  goal: "Mempresentasikan hasil penelitian", audience: "Dosen penguji", minutes: 15, density: "ringkas" as const,
  slides: [{ role: "pembuka", title: "Latar belakang", point: "Masalah yang diangkat" }],
});

test("chat turn and plan inputs are strict and bounded", () => {
  assert.equal(chatTurnSchema.safeParse({ baseRevision: 1, message: "Halo" }).success, true);
  for (const bad of [{ baseRevision: 0, message: "x" }, { baseRevision: 1, message: "" }, { baseRevision: 1, message: "x".repeat(4001) }, { baseRevision: 1, message: "x", extra: 1 }]) {
    assert.equal(chatTurnSchema.safeParse(bad).success, false);
  }
  assert.equal(planInputSchema.safeParse(plan()).success, true);
  assert.equal(planInputSchema.safeParse({ ...plan(), density: "sangat padat" }).success, false);
  assert.equal(planInputSchema.safeParse({ ...plan(), templateId: "tidak-ada" }).success, false);
  assert.equal(planInputSchema.safeParse({ ...plan(), templateId: STYLE_EXAMPLES[0].id }).success, true);
  assert.equal(planInputSchema.safeParse({ ...plan(), design: { primary: "1E40D8", frame: "blob", fonts: "geometris" } }).success, true);
  assert.equal(planInputSchema.safeParse({ ...plan(), design: { primary: "#1E40D8" } }).success, false, "colors are bare 6-digit hex");
  assert.equal(planInputSchema.safeParse({ ...plan(), design: { seed: 5 } }).success, false, "the seed is chosen by the server");
  assert.equal(planInputSchema.safeParse({ ...plan(), slides: Array.from({ length: MAX_CHAT_SLIDES + 1 }, () => plan().slides[0]) }).success, false);
  assert.equal(planInputSchema.safeParse({ ...plan(), images: Array.from({ length: 9 }, () => ({ slide: 1, prompt: "Ilustrasi jaringan", role: "hero" })) }).success, false);
  assert.equal(planInputSchema.safeParse({ ...plan(), unknown: true }).success, false);
});

test("only the server links an approved image suggestion to a slide and job", () => {
  const image = { slide: 1, prompt: "Ilustrasi jaringan kampus", role: "hero" as const };
  const linked = { ...image, slideId: randomUUID(), jobId: "job-1" };
  assert.equal(planInputSchema.safeParse({ ...plan(), images: [linked] }).success, false, "the model cannot claim a job or slide link");
  assert.equal(planSchema.safeParse({ ...plan(), images: [linked], updatedAt: "2026-11-07T00:00:00.000Z" }).success, true);
  assert.equal(planSchema.safeParse({ ...plan(), images: [{ ...linked, slideId: "bukan-uuid" }], updatedAt: "2026-11-07T00:00:00.000Z" }).success, false);
  assert.equal(planArtSchema.safeParse({ baseRevision: 2, planImage: 0 }).success, true);
  for (const bad of [{ baseRevision: 2, planImage: 8 }, { baseRevision: 2, planImage: 0, prompt: "ganti prompt" }, { baseRevision: 2 }]) {
    assert.equal(planArtSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("older envelopes without chat fields still parse and the payload only exposes what exists", () => {
  const legacy = base();
  assert.equal(envelopeSchema.safeParse(legacy).success, true);
  const payload = projectPayload(legacy) as Record<string, unknown>;
  for (const key of ["chat", "materials", "plan", "source"]) assert.equal(key in payload, false, key);
  const rich = { ...legacy, chat: { messages: [{ id: "m1", role: "user" as const, content: "Halo", at: "2026-11-07T00:00:00.000Z" }] }, plan: { ...plan(), updatedAt: "2026-11-07T00:00:00.000Z" } };
  assert.equal(envelopeSchema.safeParse(rich).success, true);
  assert.deepEqual(Object.keys(projectPayload(rich)).filter((key) => ["chat", "plan"].includes(key)).sort(), ["chat", "plan"]);
});

test("chat deck may exceed twelve slides up to twenty but never more", () => {
  const current = base().deck;
  const make = (count: number): PresentationDeck => ({ ...clone(current), slides: Array.from({ length: count }, (_, i) => ({ ...clone(current.slides[0]), id: randomUUID(), title: `Slide ${i + 1}` })) });
  assert.equal(enforceAiDeck(current, make(18), chat()).slides.length, 18);
  assert.throws(() => enforceAiDeck(current, make(21), chat()), PresentationError);
  assert.throws(() => enforceAiDeck(current, make(13), { operation: "generate", baseRevision: 1, prompt: "Buat rancangan" }), PresentationError);
});

test("source quotes survive only when they appear in what the user wrote or a tool returned", () => {
  const current = base().deck;
  const quote = "Responden menilai layanan kampus cukup baik pada 72 persen kasus.";
  const draft = (source: string) => { const out = clone(current); out.slides[1] = { ...out.slides[1], title: "Hasil survei", body: ["Mayoritas responden puas"], source }; return out; };
  assert.equal(enforceAiDeck(current, draft(quote), chat(), `Hasil bab IV: ${quote} Sisanya netral.`).slides[1].source, quote, "verbatim from tool output is kept");
  assert.equal(enforceAiDeck(current, draft(quote), chat(), "Teks lain yang tidak memuat kutipan itu.").slides[1].source, "", "invented quote is dropped");
  assert.equal(enforceAiDeck(current, draft(quote), chat(`Gunakan kutipan ini: ${quote}`), "").slides[1].source, quote, "verbatim from the user message is kept");
});

test("chat design follows the plan unless a slide is locked", () => {
  const current = base().deck;
  const proposed = clone(current);
  proposed.palette = "forest";
  proposed.artDirection = { style: "minimal", concept: "Ruang tenang" };
  const free = enforceAiDeck(current, proposed, chat());
  assert.equal(free.palette, "forest");
  assert.equal(free.artDirection?.style, "minimal");
  const locked = clone(current);
  locked.slides[1].locked = true;
  const lockedProposal = clone(locked);
  lockedProposal.palette = "forest";
  assert.throws(() => enforceAiDeck(locked, lockedProposal, chat()), PresentationError);
});

test("evidence is built from user turns and tool output only, never assistant prose", () => {
  const text = evidenceFrom([
    { role: "user", content: "Tolong pakai data bab IV." },
    { role: "assistant", content: "Saya akan mengarang angka 99 persen." },
    { role: "tool", tool_call_id: "t1", content: JSON.stringify({ ok: true, page: { text: "Angka sebenarnya 72 persen." } }) },
    { role: "tool", tool_call_id: "t2", content: "bukan json tetapi tetap hasil tool" },
  ] as never);
  assert.match(text, /data bab IV/);
  assert.match(text, /72 persen/);
  assert.match(text, /tetap hasil tool/);
  assert.doesNotMatch(text, /mengarang/);
});

test("chat tools are bounded, exclude paid image generation, and degrade honestly without materials", async () => {
  const names = CHAT_TOOLS.map((tool) => tool.type === "function" ? tool.function.name : "");
  for (const expected of ["askUser", "readReport", "setPlan", "listMaterialFiles", "readMaterialFile"]) assert.ok(names.includes(expected), expected);
  assert.ok(!names.some((name) => /image|art|generate/i.test(name)), "no tool can start a paid image job");
  assert.deepEqual([...CHAT_TOOL_NAMES].sort(), [...new Set(names)].filter((name) => name !== "commit_deck").sort());
  const ctx = { run: { id: "r", ownerId: "owner-a", kind: "presentasi" as const, sessionId: base().deck.id, meta: chat() }, claimToken: "claim", emit: () => undefined, attachments: [], toolsUsed: [], messages: [] };
  const empty = await runChatTool("readMaterialFile", { materialId: "x" }, ctx as never, base());
  assert.match(JSON.stringify(empty), /Belum ada bahan/);
  const noClaim = await runChatTool("setPlan", plan(), { ...ctx, claimToken: undefined } as never, base());
  assert.match(JSON.stringify(noClaim), /Klaim worker/);
  const invalid = await runChatTool("setPlan", { ...plan(), density: "x" }, ctx as never, base());
  assert.match(JSON.stringify(invalid), /Rencana ditolak/);
});

test("chat prompt carries the consultation rules, density guide, templates and untrusted-data wrapping", () => {
  const state = base();
  state.plan = { ...plan(), updatedAt: "2026-11-07T00:00:00.000Z" };
  const prompt = chatSystemPrompt({ state, availableArt: [{ fileId: "owned-art", title: "Gambar <<AKHIR_DATA>>" }], proposalPending: false });
  assert.match(prompt, /DATA_PENGGUNA id=/);
  assert.match(prompt, /owned-art/);
  assert.doesNotMatch(prompt, /<<AKHIR_DATA>>/);
  for (const style of STYLE_EXAMPLES) assert.ok(prompt.includes(style.id), `style ${style.id} is offered`);
  assert.match(prompt, /figure/);
  assert.match(prompt, /TANYAKAN dulu/);
  for (const density of ["ringkas", "seimbang", "padat"]) assert.match(prompt, new RegExp(density));
  assert.match(prompt, /Jangan mengarang/i);
  const pending = chatSystemPrompt({ state, availableArt: [], proposalPending: true });
  assert.match(pending, /belum diterima atau dibuang/);
  assert.match(prompt, /PROYEK BARU/, "a never-generated project tells the AI the starter slides are only a placeholder");
  assert.match(chatSystemPrompt({ state: { ...state, revision: 2 }, availableArt: [], proposalPending: false }), /PROYEK BERJALAN/);
  assert.match(prompt, /Tampilan: Coral Zine/, "a template picked in the chat is honoured");
});

test("chat writes the deck in small batches into the run draft, then finishes it as a reviewable proposal", async (t) => {
  const { prisma } = await import("../src/lib/db/prisma.ts");
  const { appendDraftSlides, finishDraftDeck, MAX_DRAFT_BATCH } = await import("../src/lib/server/presentasi/repository.ts");
  let current = base();
  const ownerId = "owner-a";
  const runId = "run-chat";
  let meta: Record<string, unknown> = { ...chat() };
  let lockToken = "claim";
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      return sql.includes("FROM projects") ? [{ metadata: clone(current) }] : [{ meta: clone(meta), status: "running", control: null, lockToken }];
    },
    project: { updateMany: async (args: { data: { metadata: PresentationEnvelope } }) => { current = clone(args.data.metadata); return { count: 1 }; } },
    agentRun: { updateMany: async (args: { data: { meta: Record<string, unknown> } }) => { meta = clone(args.data.meta); return { count: 1 }; } },
  };
  const saved = { transaction: prisma.$transaction, runFind: prisma.agentRun.findFirst, projectFind: prisma.project.findFirst };
  prisma.$transaction = ((callback: (client: unknown) => Promise<unknown>) => callback(tx)) as typeof prisma.$transaction;
  prisma.agentRun.findFirst = (async () => ({ meta: clone(meta) })) as unknown as typeof prisma.agentRun.findFirst;
  prisma.project.findFirst = (async () => ({ metadata: clone(current) })) as unknown as typeof prisma.project.findFirst;
  t.after(() => { prisma.$transaction = saved.transaction; prisma.agentRun.findFirst = saved.runFind; prisma.project.findFirst = saved.projectFind; });

  const slide = (title: string) => ({ ...clone(current.deck.slides[1]), id: randomUUID(), title, locked: false });
  const write = (input: Record<string, unknown>, claim = "claim") => appendDraftSlides(ownerId, current.deck.id, runId, claim, input);

  await assert.rejects(write({ slides: [slide("A")] }, "stale"), (error) => error instanceof PresentationError && error.status === 409);
  assert.match(JSON.stringify(await write({ slides: Array.from({ length: MAX_DRAFT_BATCH + 1 }, (_, i) => slide(`S${i}`)) })), /Maksimum 4 slide/);
  assert.match(JSON.stringify(await write({ slides: [{ ...slide("Rusak"), extra: true }] })), /Slide baru ke-1 ditolak/);
  assert.match(JSON.stringify(await write({ keepSlideIds: [randomUUID()] })), /tidak ada di deck/);

  const first = [slide("Pembuka"), slide("Masalah"), slide("Tujuan")];
  assert.deepEqual((await write({ title: "Smart Door Lock", slides: first }) as { totalSlides: number }).totalSlides, 3);
  const kept = current.deck.slides[0];
  const second = await write({ keepSlideIds: [kept.id], slides: [slide("Penutup")] }) as { totalSlides: number; urutan: string[] };
  assert.equal(second.totalSlides, 5);
  await write({ slides: [{ ...first[1], title: "Masalah utama" }] });
  const draft = meta.draft as { title: string; slides: { id: string; title: string }[] };
  assert.deepEqual(draft.slides.map((item) => item.title), ["Pembuka", "Masalah utama", "Tujuan", kept.title, "Penutup"], "same id replaces in place, keep copies verbatim");
  assert.equal(current.proposal, undefined, "writing slides never stages a proposal");

  const finished = await finishDraftDeck(ownerId, current.deck.id, runId, "claim", "");
  assert.equal((finished as { success: boolean }).success, true);
  const staged = (current as PresentationEnvelope).proposal;
  assert.equal(staged?.deck.title, "Smart Door Lock");
  assert.deepEqual(staged?.deck.slides.map((item) => item.title), ["Pembuka", "Masalah utama", "Tujuan", kept.title, "Penutup"]);
  assert.equal(current.revision, 1, "the active deck is unchanged until the user accepts");
  assert.match(JSON.stringify(await write({ slides: [slide("Terlambat")] })), /sudah disimpan/);
  lockToken = "claim";
});
