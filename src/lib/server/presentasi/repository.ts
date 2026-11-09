import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { createStarterDeck, slideSchema, type PresentationDeck, type PresentationSlide, type PresentationTheme } from "@/lib/presentation/model";
import { assertRevision, enforceAiDeck, generateSchema, reviseSchema, chatTurnSchema, nextEnvelope, PresentationError, projectPayload, readEnvelope, planInputSchema, MAX_CHAT_CONTENT, MAX_CHAT_MESSAGES, MAX_CHAT_SLIDES, MAX_PRESENTATION_MATERIALS, type PresentationChatMessage, type PresentationEnvelope, type PresentationPlanInput, type RunOperation } from "./state";
import { validatePresentationArt } from "./art";
import { STYLE_EXAMPLES } from "@/lib/presentation/design";
import { deckDesignSchema, type DeckDesign } from "@/lib/presentation/model";
import { saveUpload } from "@/lib/storage/upload";
import { svgToPngServer } from "@/lib/server/laporan/svg-raster";
import { stripDashes } from "@/lib/ai/client";
import { extractMaterialImages, LOGO_MARKER } from "./material-images";

type Transaction = Prisma.TransactionClient;

/** Files the user already attached; the AI may place these on slides without a paid image job. */
const attachedArt = (state: PresentationEnvelope) => new Set([
  ...(state.source?.figures ?? []).map((item) => item.fileId),
  ...(state.materials ?? []).flatMap((item) => [item.fileId, ...(item.images ?? []).map((image) => image.fileId)]),
]);

/** Logo candidate found in the attached documents (first one wins). */
export function detectedLogo(state: PresentationEnvelope): string | undefined {
  return (state.materials ?? []).flatMap((item) => item.images ?? []).find((image) => image.logo)?.fileId
    ?? (state.source?.figures ?? []).find((item) => item.title.includes(LOGO_MARKER))?.fileId;
}

async function lockedProject(tx: Transaction, ownerId: string, projectId: string) {
  // Owner predicate belongs in the lock query, not only in an earlier lookup.
  const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
    SELECT metadata FROM projects WHERE project_id = ${projectId} AND owner_id = ${ownerId} FOR UPDATE
  `;
  if (!rows.length) throw new PresentationError(404, "Presentasi tidak ditemukan.");
  return readEnvelope(rows[0].metadata, projectId);
}

async function writeProject(tx: Transaction, ownerId: string, state: PresentationEnvelope) {
  await tx.project.updateMany({
    where: { projectId: state.deck.id, ownerId },
    data: { metadata: state as unknown as Prisma.InputJsonValue },
  });
  return projectPayload(state);
}

export async function listPresentations(ownerId: string) {
  const rows = await prisma.project.findMany({
    where: { ownerId, metadata: { path: ["kind"], equals: "presentation" } },
    select: { projectId: true, metadata: true },
  });
  // One unreadable row must not hide the whole library.
  const states = rows.flatMap((row) => { try { return [readEnvelope(row.metadata, row.projectId)]; } catch { return []; } });
  return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((state) => ({ id: state.deck.id, title: state.deck.title, revision: state.revision, updatedAt: state.updatedAt }));
}

export async function createPresentation(ownerId: string, theme: PresentationTheme) {
  // Content comes from the chat; the starter slides only keep the deck valid until the first AI result.
  const deck = { ...createStarterDeck(theme), title: "Presentasi baru" };
  const state: PresentationEnvelope = { kind: "presentation", schemaVersion: 1, revision: 1, updatedAt: new Date().toISOString(), deck, history: [] };
  await prisma.project.create({ data: { projectId: deck.id, ownerId, metadata: state as unknown as Prisma.InputJsonValue } });
  return projectPayload(state);
}

export async function getPresentation(ownerId: string, projectId: string) {
  const row = await prisma.project.findFirst({ where: { ownerId, projectId }, select: { metadata: true } });
  if (!row) throw new PresentationError(404, "Presentasi tidak ditemukan.");
  return projectPayload(readEnvelope(row.metadata, projectId));
}

export async function snapshotPresentation(ownerId: string, projectId: string, baseRevision: number, forGeneration = false) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    assertRevision(state, baseRevision);
    if (forGeneration && state.proposal) throw new PresentationError(409, "Terima atau buang proposal yang ada sebelum meminta perubahan AI baru.");
    return projectPayload(state);
  });
}

export async function savePresentation(ownerId: string, projectId: string, baseRevision: number, deck: PresentationDeck) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    assertRevision(state, baseRevision);
    await validatePresentationArt(ownerId, projectId, deck, state.deck, tx, "manual");
    return writeProject(tx, ownerId, nextEnvelope(state, deck));
  });
}

export async function restorePresentation(ownerId: string, projectId: string, baseRevision: number, revision: number) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    assertRevision(state, baseRevision);
    const snapshot = state.history.find((item) => item.revision === revision);
    if (!snapshot) throw new PresentationError(404, "Riwayat revisi tidak ditemukan (tersimpan maksimum lima).");
    await validatePresentationArt(ownerId, projectId, snapshot.deck, snapshot.deck, tx);
    return writeProject(tx, ownerId, nextEnvelope(state, snapshot.deck));
  });
}

export async function resolvePresentationProposal(ownerId: string, projectId: string, baseRevision: number, action: "accept" | "discard", runId: string) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    assertRevision(state, baseRevision);
    if (!state.proposal) throw new PresentationError(409, "Proposal tidak ditemukan atau sudah diproses.");
    if (state.proposal.runId !== runId) throw new PresentationError(409, "Proposal sudah berubah. Muat ulang pratinjau sebelum melanjutkan.");
    if (action === "accept") {
      assertRevision(state, state.proposal.baseRevision);
      await validatePresentationArt(ownerId, projectId, state.proposal.deck, state.deck, tx, "generated", attachedArt(state));
      return writeProject(tx, ownerId, nextEnvelope(state, state.proposal.deck));
    }
    const { proposal, ...current } = state;
    void proposal;
    return writeProject(tx, ownerId, current);
  });
}

export async function deletePresentation(ownerId: string, projectId: string) {
  await prisma.$transaction(async (tx) => {
    await lockedProject(tx, ownerId, projectId);
    await tx.project.deleteMany({ where: { ownerId, projectId } });
    await tx.agentRun.updateMany({
      where: { ownerId, kind: "presentasi", sessionId: projectId, status: { in: ["queued", "running", "paused"] } },
      data: { status: "cancelled", control: "cancel", finishedAt: new Date() },
    });
  });
}

export async function importReportText(ownerId: string, projectId: string, baseRevision: number, sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    assertRevision(state, baseRevision);
    const report = await tx.reportSession.findFirst({ where: { id: sessionId, ownerId }, select: { draft: true } });
    if (!report) throw new PresentationError(404, "Laporan tidak ditemukan.");
    if (!report.draft?.trim()) throw new PresentationError(409, "Laporan belum mempunyai draft.");
    if (report.draft.length > 40000) throw new PresentationError(413, "Draft melebihi 40.000 karakter. Tempel bagian yang relevan sebagai bahan.");
    return report.draft;
  });
}

// ---------------------------------------------------------------------------
// Conversation state. These writes keep `revision` untouched: it is the deck conflict token.
// ---------------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
function trimChat(messages: PresentationChatMessage[]) {
  return messages.slice(-MAX_CHAT_MESSAGES).map((message) => ({ ...message, content: message.content.slice(0, MAX_CHAT_CONTENT) }));
}

export async function appendChatMessage(ownerId: string, projectId: string, message: Omit<PresentationChatMessage, "id" | "at"> & { id?: string }) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const messages = state.chat?.messages ?? [];
    // A reconnect can deliver the same finished run twice; one run answers once.
    if (message.runId && messages.some((item) => item.runId === message.runId && item.role === message.role)) return projectPayload(state);
    const next = { ...message, id: message.id ?? crypto.randomUUID(), at: nowIso(), content: message.content.slice(0, MAX_CHAT_CONTENT) };
    return writeProject(tx, ownerId, { ...state, chat: { messages: trimChat([...messages, next]) } });
  });
}

export async function readPresentationState(ownerId: string, projectId: string) {
  const row = await prisma.project.findFirst({ where: { ownerId, projectId }, select: { metadata: true } });
  if (!row) throw new PresentationError(404, "Presentasi tidak ditemukan.");
  return readEnvelope(row.metadata, projectId);
}

/** Saves the plan and the chosen look. A stale run cannot overwrite a newer plan. */
export async function savePresentationPlan(ownerId: string, projectId: string, runId: string, claimToken: string, input: PresentationPlanInput) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const runs = await tx.$queryRaw<Array<{ status: string; control: string | null; lockToken: string | null }>>`
      SELECT status, control, lock_token AS "lockToken" FROM agent_runs
      WHERE id = ${runId} AND owner_id = ${ownerId} AND kind = 'presentasi' AND session_id = ${projectId} FOR UPDATE
    `;
    const run = runs[0];
    if (!run) throw new PresentationError(404, "Run tidak ditemukan.");
    if (!claimToken || run.lockToken !== claimToken) throw new PresentationError(409, "Klaim worker sudah berubah. Rencana worker lama ditolak.");
    if (run.status !== "running" || run.control) throw new PresentationError(409, "Run telah dijeda atau dihentikan.");
    const parsed = planInputSchema.parse(input);
    // A re-plan keeps the link to images the user already approved for the same suggestion.
    const images = parsed.images?.map((image) => {
      const known = state.plan?.images?.find((item) => item.slide === image.slide && item.prompt === image.prompt && item.role === image.role);
      return known?.jobId ? { ...image, slideId: known.slideId, jobId: known.jobId } : image;
    });
    await writeProject(tx, ownerId, { ...state, plan: { ...parsed, ...(images ? { images } : {}), updatedAt: nowIso() } });
    return { success: true, slides: parsed.slides.length, density: parsed.density };
  });
}

/** Registers uploaded files as readable materials. Ownership is checked against the upload row. */
export async function addPresentationMaterial(ownerId: string, projectId: string, input: { fileId: string; title: string; fileName: string; kind: string }) {
  const file = await prisma.fileUpload.findFirst({ where: { id: input.fileId, ownerId }, select: { id: true } });
  if (!file) throw new PresentationError(404, "File bahan tidak ditemukan.");
  // Embedded pictures (logo on the cover) become usable slide images; failures never block the material.
  const images = await extractMaterialImages(ownerId, input.fileId, input.fileName).catch(() => []);
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const materials = state.materials ?? [];
    if (materials.some((item) => item.fileId === input.fileId)) return projectPayload(state);
    if (materials.length >= MAX_PRESENTATION_MATERIALS) throw new PresentationError(413, `Maksimum ${MAX_PRESENTATION_MATERIALS} bahan per presentasi.`);
    const id = `m${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    return writeProject(tx, ownerId, { ...state, materials: [...materials, { id, fileId: input.fileId, title: input.title.slice(0, 200) || input.fileName.slice(0, 200), fileName: input.fileName.slice(0, 200), kind: input.kind.slice(0, 40), ...(images.length ? { images: images.map((image) => ({ ...image, title: image.title.slice(0, 200) })) } : {}) }] });
  });
}

export async function removePresentationMaterial(ownerId: string, projectId: string, materialId: string) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    return writeProject(tx, ownerId, { ...state, materials: (state.materials ?? []).filter((item) => item.id !== materialId) });
  });
}

/** Remembers which slide and job an approved image suggestion became, so the result can be placed later. */
export async function recordPlanImageJob(ownerId: string, projectId: string, index: number, slideId: string, jobId: string) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const images = state.plan?.images;
    if (!state.plan || !images?.[index]) return projectPayload(state);
    const next = images.map((image, i) => i === index ? { ...image, slideId, jobId } : image);
    return writeProject(tx, ownerId, { ...state, plan: { ...state.plan, images: next } });
  });
}

/** Per-deck identity: a style example adjusted by the AI's colors, with a fresh seed so every generate differs. */
export function planDesign(state: PresentationEnvelope, seed = Math.floor(Math.random() * 1_000_000)): DeckDesign | undefined {
  const plan = state.plan;
  if (!plan || (!plan.templateId && !plan.design)) return undefined;
  const base = STYLE_EXAMPLES.find((style) => style.id === plan.templateId) ?? STYLE_EXAMPLES[0];
  const candidate = { ...base.design, ...plan.design, seed };
  const parsed = deckDesignSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { ...base.design, seed };
}

const MAX_REPORT_DIAGRAMS = 8;

/** Approved report diagrams become owned PNG files so slides and the PPTX can show them. */
async function rasterizeReportDiagrams(ownerId: string, plan: Record<string, unknown>) {
  const diagrams = (Array.isArray(plan.diagrams) ? plan.diagrams : []).flatMap((item) => {
    const diagram = item as { svg?: unknown; title?: unknown; status?: unknown };
    return typeof diagram.svg === "string" && diagram.svg.length < 2_000_000 && diagram.status === "approved"
      ? [{ svg: diagram.svg, title: typeof diagram.title === "string" ? diagram.title.slice(0, 200) : "Diagram laporan" }] : [];
  }).slice(0, MAX_REPORT_DIAGRAMS);
  const figures: { fileId: string; title: string }[] = [];
  for (const diagram of diagrams) {
    try {
      const png = Buffer.from(await svgToPngServer(diagram.svg));
      if (png.length > 4 * 1024 * 1024) continue;
      const saved = await saveUpload({ ownerId, buffer: png, originalName: `${diagram.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "diagram"}.png`, mime: "image/png" });
      figures.push({ fileId: saved.id, title: `Diagram: ${diagram.title}` });
    } catch { /* A diagram that cannot be drawn is skipped; the text report still links. */ }
  }
  return figures;
}

async function buildReportSource(ownerId: string, sessionId: string) {
  const report = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId }, select: { id: true, title: true, draft: true, plan: true, materials: true } });
  if (!report) throw new PresentationError(404, "Laporan tidak ditemukan.");
  if (!report.draft?.trim()) throw new PresentationError(409, "Laporan belum mempunyai draft. Selesaikan laporan sebelum membuat presentasi.");
  const plan = report.plan && typeof report.plan === "object" && !Array.isArray(report.plan) ? report.plan as { figures?: unknown; diagrams?: unknown } : {};
  const candidates = (Array.isArray(plan.figures) ? plan.figures : []).flatMap((item) => {
    const figure = item as { fileId?: unknown; title?: unknown };
    return typeof figure.fileId === "string" && figure.fileId && figure.fileId.length <= 100 && !/[:/\\?#]/u.test(figure.fileId)
      ? [{ fileId: figure.fileId, title: typeof figure.title === "string" ? figure.title.slice(0, 200) : "Gambar laporan" }] : [];
  }).slice(0, 20);
  const owned = candidates.length ? await prisma.fileUpload.findMany({ where: { ownerId, id: { in: candidates.map((item) => item.fileId) } }, select: { id: true } }) : [];
  const ownedIds = new Set(owned.map((item) => item.id));
  const diagrams = await rasterizeReportDiagrams(ownerId, plan as Record<string, unknown>);
  // Logo and pictures embedded in the documents the user uploaded to Laporan (e.g. the cover page).
  const documents = (Array.isArray(report.materials) ? report.materials : []).flatMap((item) => {
    const material = item as { fileId?: unknown; fileName?: unknown };
    return typeof material.fileId === "string" && typeof material.fileName === "string" && /\.(docx|pptx|pdf)$/i.test(material.fileName) ? [{ fileId: material.fileId, fileName: material.fileName }] : [];
  }).slice(0, 2);
  const embedded: { fileId: string; title: string }[] = [];
  for (const document of documents) {
    const images = await extractMaterialImages(ownerId, document.fileId, document.fileName).catch(() => []);
    embedded.push(...images.slice(0, 3).map((image) => ({ fileId: image.fileId, title: image.title.slice(0, 200) })));
  }
  return { kind: "report" as const, sessionId: report.id, linkedAt: nowIso(), title: (report.title ?? "Laporan").slice(0, 200), draftChars: report.draft.length, figures: [...embedded.filter((item) => item.title.includes(LOGO_MARKER)), ...candidates.filter((item) => ownedIds.has(item.fileId)), ...diagrams, ...embedded.filter((item) => !item.title.includes(LOGO_MARKER))].slice(0, 20) };
}

/**
 * Links a report session. The text itself is not copied: the AI reads it page by page at run time,
 * so reports of any length stay usable. Only owned report sessions can be linked.
 */
export async function linkReportSession(ownerId: string, projectId: string, sessionId: string) {
  const source = await buildReportSource(ownerId, sessionId);
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    return writeProject(tx, ownerId, { ...state, source });
  });
}

/** One step for the "Buat presentasi" button in Laporan: validate the report first, so no orphan project is left. */
export async function createPresentationFromReport(ownerId: string, sessionId: string) {
  const source = await buildReportSource(ownerId, sessionId);
  const starter = createStarterDeck("editorial");
  const deck = { ...starter, title: source.title.trim().slice(0, 120) || starter.title };
  const state: PresentationEnvelope = { kind: "presentation", schemaVersion: 1, revision: 1, updatedAt: nowIso(), deck, history: [], source };
  await prisma.project.create({ data: { projectId: deck.id, ownerId, metadata: state as unknown as Prisma.InputJsonValue } });
  return projectPayload(state);
}

/** Paged, bounded read of the linked report for the AI. Ownership is rechecked on every call. */
export async function readLinkedReport(ownerId: string, projectId: string, part: "outline" | "draft", offset: number, limit: number) {
  const state = await readPresentationState(ownerId, projectId);
  if (!state.source) throw new PresentationError(404, "Presentasi ini belum tertaut ke laporan.");
  const report = await prisma.reportSession.findFirst({ where: { id: state.source.sessionId, ownerId }, select: { draft: true, plan: true, brief: true } });
  if (!report) throw new PresentationError(404, "Laporan sumber sudah dihapus.");
  if (part === "outline") return { part, brief: report.brief ?? null, outline: (report.plan as { outline?: unknown } | null)?.outline ?? [], totalKarakterDraft: report.draft?.length ?? 0 };
  const draft = report.draft ?? "";
  const start = Math.max(0, Math.floor(offset));
  const size = Math.min(Math.max(Math.floor(limit), 500), 10_000);
  return { part, totalKarakter: draft.length, offset: start, isi: draft.slice(start, start + size), adaLanjutan: start + size < draft.length };
}

// ---------------------------------------------------------------------------
// Chat deck draft. One model reply cannot write a whole deck inside one server step,
// so the AI writes a few slides per step into the run, then finishes the deck.
// ---------------------------------------------------------------------------

export const MAX_DRAFT_BATCH = 4;
const draftSchema = z.object({ title: z.string().trim().max(120).optional(), slides: z.array(slideSchema).max(MAX_CHAT_SLIDES) }).strict();
export type DeckDraft = z.infer<typeof draftSchema>;

export function readRunDraft(meta: unknown): DeckDraft {
  const value = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>).draft : undefined;
  const parsed = draftSchema.safeParse(value);
  return parsed.success ? parsed.data : { slides: [] };
}

/** Adds or replaces slides (by id) in the run's draft. Existing slides can be kept verbatim by id. */
export async function appendDraftSlides(ownerId: string, projectId: string, runId: string, claimToken: string, input: { title?: unknown; slides?: unknown; keepSlideIds?: unknown; reset?: unknown }) {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const runs = await tx.$queryRaw<Array<{ meta: unknown; status: string; control: string | null; lockToken: string | null }>>`
      SELECT meta, status, control, lock_token AS "lockToken" FROM agent_runs
      WHERE id = ${runId} AND owner_id = ${ownerId} AND kind = 'presentasi' AND session_id = ${projectId} FOR UPDATE
    `;
    const run = runs[0];
    if (!run) throw new PresentationError(404, "Run tidak ditemukan.");
    if (!claimToken || run.lockToken !== claimToken) throw new PresentationError(409, "Klaim worker sudah berubah. Draft worker lama ditolak.");
    if (run.status !== "running" || run.control) throw new PresentationError(409, "Run telah dijeda atau dihentikan.");
    const meta = z.record(z.string(), z.unknown()).parse(run.meta);
    if (typeof meta.proposedRevision === "number" || typeof meta.committedRevision === "number") return { error: "Deck sudah disimpan pada percakapan ini. Jangan menulis slide lagi." };

    const keepIds = Array.isArray(input.keepSlideIds) ? input.keepSlideIds.filter((id): id is string => typeof id === "string") : [];
    const incoming = Array.isArray(input.slides) ? input.slides : [];
    if (!keepIds.length && !incoming.length) return { error: "Kirim minimal satu slide di slides atau keepSlideIds." };
    if (incoming.length > MAX_DRAFT_BATCH) return { error: `Maksimum ${MAX_DRAFT_BATCH} slide baru per panggilan. Pecah menjadi beberapa panggilan writeSlides.` };

    const additions: PresentationSlide[] = [];
    for (const id of keepIds) {
      const existing = state.deck.slides.find((slide) => slide.id === id);
      if (!existing) return { error: `Slide ${id} tidak ada di deck saat ini, jadi tidak bisa dipertahankan.` };
      additions.push(existing);
    }
    for (const [index, raw] of incoming.entries()) {
      const parsed = slideSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { error: `Slide baru ke-${index + 1} ditolak: ${issue?.path.join(".") || "slide"} ${issue?.message ?? "tidak valid"}. Perbaiki lalu kirim ulang slide itu.` };
      }
      const locked = state.deck.slides.find((slide) => slide.id === parsed.data.id && slide.locked);
      additions.push(locked ?? parsed.data);
    }

    const draft = input.reset === true ? { slides: [] as PresentationSlide[] } : readRunDraft(meta);
    const slides = [...draft.slides];
    for (const slide of additions) {
      const at = slides.findIndex((item) => item.id === slide.id);
      if (at >= 0) slides[at] = slide; else slides.push(slide);
    }
    if (slides.length > MAX_CHAT_SLIDES) return { error: `Deck maksimum ${MAX_CHAT_SLIDES} slide. Kurangi jumlah slide.` };
    const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 120) : draft.title;
    const next: DeckDraft = { ...(title ? { title } : {}), slides };
    await tx.agentRun.updateMany({
      where: { id: runId, ownerId, kind: "presentasi", sessionId: projectId, lockToken: claimToken },
      data: { meta: { ...meta, draft: next } as Prisma.InputJsonValue },
    });
    return { success: true, totalSlides: slides.length, urutan: slides.map((slide, i) => `${i + 1}. ${slide.title}`) };
  });
}

/** Turns the run's draft into the review proposal through the same fenced commit as commit_deck. */
export async function finishDraftDeck(ownerId: string, projectId: string, runId: string, claimToken: string, evidenceText: string) {
  const row = await prisma.agentRun.findFirst({ where: { id: runId, ownerId, kind: "presentasi", sessionId: projectId }, select: { meta: true } });
  if (!row) throw new PresentationError(404, "Run tidak ditemukan.");
  const draft = readRunDraft(row.meta);
  if (!draft.slides.length) return { success: false, error: "Draft masih kosong. Tulis slide dengan writeSlides terlebih dahulu." };
  const state = await readPresentationState(ownerId, projectId);
  const deck = { ...state.deck, title: draft.title || state.deck.title, slides: draft.slides };
  return commitPresentationRun(ownerId, projectId, runId, deck, claimToken, evidenceText);
}

export async function commitPresentationRun(ownerId: string, projectId: string, runId: string, output: unknown, claimToken: string, evidenceText = "") {
  return prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const runs = await tx.$queryRaw<Array<{ meta: unknown; status: string; control: string | null; lockToken: string | null }>>`
      SELECT meta, status, control, lock_token AS "lockToken" FROM agent_runs
      WHERE id = ${runId} AND owner_id = ${ownerId} AND kind = 'presentasi' AND session_id = ${projectId} FOR UPDATE
    `;
    const run = runs[0];
    if (!run) throw new PresentationError(404, "Run tidak ditemukan.");
    if (!claimToken || run.lockToken !== claimToken) throw new PresentationError(409, "Klaim worker sudah berubah. Hasil worker lama ditolak.");
    const meta = z.record(z.string(), z.unknown()).parse(run.meta);
    // Receipt survives acceptance/discard and history eviction; replay never restages.
    if (typeof meta.proposedRevision === "number") return { success: true, revision: meta.proposedRevision, alreadyCommitted: true, staged: true };
    if (typeof meta.committedRevision === "number") return { success: true, revision: meta.committedRevision, alreadyCommitted: true };
    if (run.status !== "running" || run.control) throw new PresentationError(409, "Run telah dijeda atau dihentikan.");
    const operation = parseRunOperation(meta);
    assertRevision(state, operation.baseRevision);
    if (state.proposal) throw new PresentationError(409, "Terima atau buang proposal yang ada sebelum meminta perubahan AI baru.");
    const candidate = operation.operation === "revise"
      ? { ...state.deck, slides: state.deck.slides.map((slide) => slide.id === operation.slideId ? slideSchema.parse(output) : slide) }
      : output;
    let deck = enforceAiDeck(state.deck, candidate, operation, evidenceText);
    // Em/en dash are an AI hallmark: never stored in slide text (source stays an exact quote).
    deck = { ...deck, title: stripDashes(deck.title), slides: deck.slides.map((slide) => slide.locked ? slide : { ...slide, title: stripDashes(slide.title), eyebrow: slide.eyebrow ? stripDashes(slide.eyebrow) : slide.eyebrow, body: slide.body.map((item) => stripDashes(item)), notes: slide.notes ? stripDashes(slide.notes) : slide.notes }) };
    // The look is applied by the server from the plan, never taken from model-written deck fields.
    const locked = state.deck.slides.some((slide) => slide.locked);
    deck = { ...deck, design: operation.operation === "chat" && !locked ? planDesign(state) ?? state.deck.design : state.deck.design };
    // The campus logo from the attached document is used even when the AI did not pick it.
    const logo = detectedLogo(state);
    if (deck.design && !deck.design.logo && logo) deck = { ...deck, design: { ...deck.design, logo } };
    if (!deck.design) delete deck.design;
    await validatePresentationArt(ownerId, projectId, deck, state.deck, tx, "generated", attachedArt(state));
    const proposedRevision = state.revision + 1;
    await writeProject(tx, ownerId, { ...state, proposal: { runId, baseRevision: state.revision, deck } });
    await tx.agentRun.updateMany({
      where: { id: runId, ownerId, kind: "presentasi", sessionId: projectId },
      data: { meta: { ...meta, proposedRevision, baseRevision: state.revision } as Prisma.InputJsonValue },
    });
    return { success: true, revision: proposedRevision, alreadyCommitted: false, staged: true };
  });
}

export function parseRunOperation(meta: Record<string, unknown>): RunOperation {
  const { operation, committedRevision: _receipt, proposedRevision: _proposalReceipt, draft: _draft, ...input } = meta;
  void _receipt;
  void _proposalReceipt;
  void _draft;
  if (operation === "generate") return { operation, ...generateSchema.parse(input) };
  if (operation === "revise") return { operation, ...reviseSchema.parse(input) };
  if (operation === "chat") return { operation, ...chatTurnSchema.parse(input) };
  throw new PresentationError(400, "Jenis operasi presentasi tidak valid.");
}

/** Adds a cover illustration suggestion when the AI plan has none, so every accepted deck gets a real cover picture. */
export async function ensureCoverPlanImage(ownerId: string, projectId: string) {
  await prisma.$transaction(async (tx) => {
    const state = await lockedProject(tx, ownerId, projectId);
    const plan = state.plan;
    const images = plan?.images ?? [];
    if (!plan || images.some((image) => image.slide === 1) || images.length >= 8 || state.deck.slides[0]?.art) return;
    const colors = state.deck.design ? ` Warna dominan #${state.deck.design.primary} dengan aksen #${state.deck.design.accent}.` : "";
    const prompt = `Ilustrasi pembuka yang kuat untuk presentasi berjudul "${state.deck.title}". Tujuan presentasi: ${plan.goal}. Tampilkan objek atau suasana nyata yang paling mewakili topik, komposisi lega dengan satu fokus.${colors}`.slice(0, 2000);
    await writeProject(tx, ownerId, { ...state, plan: { ...plan, images: [{ slide: 1, prompt, role: "hero" as const }, ...images] } });
  });
}
