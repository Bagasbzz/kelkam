import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { createStarterDeck, slideSchema, type PresentationDeck, type PresentationTheme } from "@/lib/presentation/model";
import { assertRevision, enforceAiDeck, generateSchema, reviseSchema, nextEnvelope, PresentationError, projectPayload, readEnvelope, type PresentationEnvelope, type RunOperation } from "./state";
import { validatePresentationArt } from "./art";

type Transaction = Prisma.TransactionClient;

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
  return rows.map((row) => readEnvelope(row.metadata, row.projectId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((state) => ({ id: state.deck.id, title: state.deck.title, revision: state.revision, updatedAt: state.updatedAt }));
}

export async function createPresentation(ownerId: string, theme: PresentationTheme) {
  const deck = createStarterDeck(theme);
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
      await validatePresentationArt(ownerId, projectId, state.proposal.deck, state.deck, tx);
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

export async function commitPresentationRun(ownerId: string, projectId: string, runId: string, output: unknown, claimToken: string) {
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
    const deck = enforceAiDeck(state.deck, candidate, operation);
    await validatePresentationArt(ownerId, projectId, deck, state.deck, tx);
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
  const { operation, committedRevision: _receipt, proposedRevision: _proposalReceipt, ...input } = meta;
  void _receipt;
  void _proposalReceipt;
  if (operation === "generate") return { operation, ...generateSchema.parse(input) };
  if (operation === "revise") return { operation, ...reviseSchema.parse(input) };
  throw new PresentationError(400, "Jenis operasi presentasi tidak valid.");
}
