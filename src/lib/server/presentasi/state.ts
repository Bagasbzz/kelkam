import { z } from "zod";
import { deckSchema, type PresentationDeck, type PresentationSlide } from "@/lib/presentation/model";

export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
export const generateSchema = z.object({
  baseRevision: revisionSchema,
  prompt: z.string().trim().min(1).max(4000),
  materialText: z.string().trim().max(40000).optional(),
  audience: z.string().trim().max(200).optional(),
  minutes: z.number().int().min(1).max(180).optional(),
  slideCount: z.number().int().min(1).max(12).optional(),
}).strict();
export const reviseSchema = z.object({
  baseRevision: revisionSchema,
  slideId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4000),
  preserve: z.enum(["content", "design", "none"]),
}).strict();
export type GenerationInput = z.infer<typeof generateSchema>;
export type RevisionInput = z.infer<typeof reviseSchema>;
export type RunOperation =
  | ({ operation: "generate" } & GenerationInput)
  | ({ operation: "revise" } & RevisionInput);

const snapshotSchema = z.object({ revision: revisionSchema, deck: deckSchema, createdAt: z.string().datetime() }).strict();
export const envelopeSchema = z.object({
  kind: z.literal("presentation"),
  schemaVersion: z.literal(1),
  revision: revisionSchema,
  updatedAt: z.string().datetime(),
  deck: deckSchema,
  history: z.array(snapshotSchema).max(5),
  proposal: z.object({ runId: z.string().min(1).max(100), baseRevision: revisionSchema, deck: deckSchema }).strict().optional(),
}).strict();
export type PresentationEnvelope = z.infer<typeof envelopeSchema>;

export class PresentationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function readEnvelope(metadata: unknown, projectId: string): PresentationEnvelope {
  const parsed = envelopeSchema.safeParse(metadata);
  if (!parsed.success || parsed.data.deck.id !== projectId || (parsed.data.proposal && parsed.data.proposal.deck.id !== projectId)) throw new PresentationError(404, "Presentasi tidak ditemukan.");
  return parsed.data;
}

export function assertRevision(state: PresentationEnvelope, baseRevision: number) {
  if (state.revision !== baseRevision) throw new PresentationError(409, "Presentasi sudah berubah. Muat ulang sebelum melanjutkan.");
}

export function nextEnvelope(state: PresentationEnvelope, deck: PresentationDeck, now = new Date().toISOString()): PresentationEnvelope {
  if (deck.id !== state.deck.id) throw new PresentationError(400, "ID presentasi tidak boleh berubah.");
  const { proposal, ...current } = state;
  void proposal;
  return envelopeSchema.parse({
    ...current, revision: state.revision + 1, deck, updatedAt: now,
    history: [{ revision: state.revision, deck: state.deck, createdAt: state.updatedAt }, ...state.history].slice(0, 5),
  });
}

export function projectPayload(state: PresentationEnvelope) {
  return {
    id: state.deck.id, revision: state.revision, deck: state.deck,
    ...(state.proposal ? { proposal: state.proposal } : {}),
    history: state.history.map(({ revision, deck, createdAt }) => ({ revision, title: deck.title, createdAt })),
  };
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const content = (slide: PresentationSlide) => ({ title: slide.title, eyebrow: slide.eyebrow, body: slide.body, notes: slide.notes, source: slide.source });

/** Model output is never authority for locks, scope, identity or preserve mode. */
export function enforceAiDeck(current: PresentationDeck, output: unknown, operation: RunOperation): PresentationDeck {
  const parsed = deckSchema.safeParse(output);
  if (!parsed.success) throw new PresentationError(400, "Hasil AI tidak sesuai format atau melewati batas presentasi.");
  const proposed = parsed.data;
  if (proposed.id !== current.id) throw new PresentationError(400, "AI tidak boleh mengganti ID presentasi.");
  if (operation.operation === "generate") {
    if (current.slides.some((slide) => slide.locked) && !equal(proposed.artDirection, current.artDirection)) {
      throw new PresentationError(409, "Arah seni tidak boleh berubah selama ada slide terkunci.");
    }
    if (proposed.theme !== current.theme || proposed.slides.length > 12 || (operation.slideCount && proposed.slides.length !== operation.slideCount)) {
      throw new PresentationError(400, "Tema atau jumlah slide hasil AI tidak sesuai permintaan (maksimum 12).");
    }
    current.slides.forEach((slide, index) => {
      if (slide.locked && !equal(slide, proposed.slides[index])) throw new PresentationError(409, "Slide terkunci tidak boleh diubah, dipindah, atau dihapus oleh AI.");
    });
    const sources = `${operation.materialText ?? ""}\n${operation.prompt}`;
    proposed.slides = proposed.slides.map((slide) => {
      const original = current.slides.find((item) => item.id === slide.id);
      if (original?.locked) return original;
      return { ...slide, locked: original?.locked ?? false, source: slide.source && (sources.includes(slide.source) || (original && equal(content(original), content(slide)))) ? slide.source : "" };
    });
    return proposed;
  }

  const index = current.slides.findIndex((slide) => slide.id === operation.slideId);
  if (index < 0) throw new PresentationError(404, "Slide tidak ditemukan.");
  const original = current.slides[index];
  if (original.locked) throw new PresentationError(409, "Buka kunci slide sebelum meminta revisi AI.");
  if (proposed.title !== current.title || proposed.theme !== current.theme || !equal(proposed.artDirection, current.artDirection) || proposed.slides.length !== current.slides.length) {
    throw new PresentationError(400, "Revisi slide tidak boleh mengubah pengaturan atau jumlah slide.");
  }
  current.slides.forEach((slide, i) => {
    if (proposed.slides[i].id !== slide.id || (i !== index && !equal(slide, proposed.slides[i]))) {
      throw new PresentationError(400, "Revisi hanya boleh mengubah slide yang dipilih.");
    }
  });
  let revised = { ...proposed.slides[index], id: original.id, locked: original.locked };
  if (operation.preserve === "content") revised = { ...revised, ...content(original) };
  if (operation.preserve === "design") {
    revised.layout = original.layout;
    if (original.visual) revised.visual = original.visual;
    else delete revised.visual;
    if (original.art) revised.art = original.art;
    else delete revised.art;
  }
  if (operation.preserve !== "content" && !equal(content(original), content(revised)) && !operation.instruction.includes(revised.source)) revised.source = "";
  return { ...current, slides: current.slides.map((slide, i) => i === index ? revised : slide) };
}
