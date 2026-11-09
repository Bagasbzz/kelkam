import { z } from "zod";
import { deckSchema, SLIDE_MOTIONS, type PresentationDeck, type PresentationSlide } from "@/lib/presentation/model";
import { deckDesignSchema } from "@/lib/presentation/model";
import { STYLE_EXAMPLES } from "@/lib/presentation/design";

export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
export const generateSchema = z.object({
  baseRevision: revisionSchema,
  prompt: z.string().trim().min(1).max(4000),
  materialText: z.string().trim().max(40000).optional(),
  audience: z.string().trim().max(200).optional(),
  minutes: z.number().int().min(1).max(180).optional(),
  slideCount: z.number().int().min(1).max(12).optional(),
  motion: z.enum(SLIDE_MOTIONS).optional(),
}).strict();
export const reviseSchema = z.object({
  baseRevision: revisionSchema,
  slideId: z.string().uuid(),
  instruction: z.string().trim().min(1).max(4000),
  preserve: z.enum(["content", "design", "none"]),
}).strict();
export const chatTurnSchema = z.object({
  baseRevision: revisionSchema,
  message: z.string().trim().min(1).max(4000),
}).strict();
export type GenerationInput = z.infer<typeof generateSchema>;
export type RevisionInput = z.infer<typeof reviseSchema>;
export type ChatInput = z.infer<typeof chatTurnSchema>;
export type RunOperation =
  | ({ operation: "generate" } & GenerationInput)
  | ({ operation: "revise" } & RevisionInput)
  | ({ operation: "chat" } & ChatInput);

export const MAX_CHAT_MESSAGES = 60;
export const MAX_CHAT_CONTENT = 4000;
export const MAX_PRESENTATION_MATERIALS = 12;
export const MAX_CHAT_SLIDES = 20;
export const PLAN_DENSITIES = ["ringkas", "seimbang", "padat"] as const;
const short = (max: number) => z.string().trim().max(max);

const chatMessageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  content: z.string().max(MAX_CHAT_CONTENT),
  at: z.string().datetime(),
  runId: z.string().min(1).max(100).optional(),
  options: z.array(short(120).min(1)).max(6).optional(),
}).strict();
export type PresentationChatMessage = z.infer<typeof chatMessageSchema>;

const materialSchema = z.object({
  id: z.string().min(1).max(40),
  fileId: z.string().min(1).max(100).refine((value) => !/[:/\\?#]/u.test(value), "Gunakan ID file."),
  title: short(200).min(1), fileName: short(200).min(1), kind: short(40).min(1),
}).strict();
export type PresentationMaterial = z.infer<typeof materialSchema>;

const planSlideSchema = z.object({
  role: short(40).min(1), title: short(120).min(1), point: short(400).min(1),
  material: short(300).optional(), visual: short(300).optional(),
}).strict();
const planImageSchema = z.object({
  slide: z.number().int().min(1).max(MAX_CHAT_SLIDES),
  prompt: short(2000).min(8),
  role: z.enum(["hero", "background", "cutout"]),
}).strict();
export const planInputSchema = z.object({
  goal: short(600).min(1), audience: short(200).min(1),
  minutes: z.number().int().min(1).max(180),
  density: z.enum(PLAN_DENSITIES),
  templateId: z.enum(STYLE_EXAMPLES.map((style) => style.id) as [string, ...string[]]).optional(),
  // Colors, frame and fonts chosen for this topic; the server adds the seed and checks the logo file.
  design: deckDesignSchema.omit({ seed: true }).partial().optional(),
  slides: z.array(planSlideSchema).min(1).max(MAX_CHAT_SLIDES),
  images: z.array(planImageSchema).max(8).optional(),
  omitted: short(800).optional(),
}).strict();
// The server records which slide and image job an approved suggestion became; the model never writes these.
const storedPlanImageSchema = planImageSchema.extend({
  slideId: z.string().uuid().optional(),
  jobId: z.string().min(1).max(100).optional(),
}).strict();
export const planSchema = planInputSchema.extend({
  images: z.array(storedPlanImageSchema).max(8).optional(),
  updatedAt: z.string().datetime(),
}).strict();
export type PresentationPlan = z.infer<typeof planSchema>;
export type PresentationPlanInput = z.infer<typeof planInputSchema>;

const sourceSchema = z.object({
  kind: z.literal("report"),
  sessionId: z.string().min(1).max(100),
  linkedAt: z.string().datetime(),
  title: short(200),
  draftChars: z.number().int().min(0),
  figures: z.array(z.object({ fileId: materialSchema.shape.fileId, title: short(200) }).strict()).max(20),
}).strict();
export type PresentationSource = z.infer<typeof sourceSchema>;

const snapshotSchema = z.object({ revision: revisionSchema, deck: deckSchema, createdAt: z.string().datetime() }).strict();
export const envelopeSchema = z.object({
  kind: z.literal("presentation"),
  schemaVersion: z.literal(1),
  revision: revisionSchema,
  updatedAt: z.string().datetime(),
  deck: deckSchema,
  history: z.array(snapshotSchema).max(5),
  proposal: z.object({ runId: z.string().min(1).max(100), baseRevision: revisionSchema, deck: deckSchema }).strict().optional(),
  // Optional and bounded so rows written before the chat flow still parse. They never bump `revision`.
  chat: z.object({ messages: z.array(chatMessageSchema).max(MAX_CHAT_MESSAGES) }).strict().optional(),
  materials: z.array(materialSchema).max(MAX_PRESENTATION_MATERIALS).optional(),
  plan: planSchema.optional(),
  source: sourceSchema.optional(),
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
    ...(state.chat ? { chat: state.chat } : {}),
    ...(state.materials ? { materials: state.materials } : {}),
    ...(state.plan ? { plan: state.plan } : {}),
    ...(state.source ? { source: state.source } : {}),
    history: state.history.map(({ revision, deck, createdAt }) => ({ revision, title: deck.title, createdAt })),
  };
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const content = (slide: PresentationSlide) => ({ title: slide.title, eyebrow: slide.eyebrow, body: slide.body, notes: slide.notes, source: slide.source });

/** Model output is never authority for locks, scope, identity or preserve mode. */
export function enforceAiDeck(current: PresentationDeck, output: unknown, operation: RunOperation, evidenceText = ""): PresentationDeck {
  const parsed = deckSchema.safeParse(output);
  if (!parsed.success) throw new PresentationError(400, "Hasil AI tidak sesuai format atau melewati batas presentasi.");
  const proposed = parsed.data;
  if (proposed.id !== current.id) throw new PresentationError(400, "AI tidak boleh mengganti ID presentasi.");
  if (operation.operation === "generate" || operation.operation === "chat") {
    const maxSlides = operation.operation === "chat" ? MAX_CHAT_SLIDES : 12;
    const requested = operation.operation === "generate" ? operation.slideCount : undefined;
    if (current.slides.some((slide) => slide.locked) && (!equal(proposed.artDirection, current.artDirection) || proposed.palette !== current.palette)) {
      throw new PresentationError(409, "Arah seni dan palet tidak boleh berubah selama ada slide terkunci.");
    }
    const locked = current.slides.some((slide) => slide.locked);
    if (proposed.slides.length > maxSlides || (requested && proposed.slides.length !== requested)
      || (proposed.theme !== current.theme && (operation.operation === "generate" || locked))) {
      throw new PresentationError(400, `Tema atau jumlah slide hasil AI tidak sesuai permintaan (maksimum ${maxSlides}).`);
    }
    current.slides.forEach((slide, index) => {
      if (slide.locked && !equal(slide, proposed.slides[index])) throw new PresentationError(409, "Slide terkunci tidak boleh diubah, dipindah, atau dihapus oleh AI.");
    });
    // Quotes must exist verbatim in what the user typed or what a tool actually returned to the model.
    const sources = operation.operation === "generate" ? `${operation.materialText ?? ""}\n${operation.prompt}` : `${operation.message}\n${evidenceText}`;
    const motion = operation.operation === "generate" ? operation.motion : undefined;
    proposed.slides = proposed.slides.map((slide) => {
      const original = current.slides.find((item) => item.id === slide.id);
      if (original?.locked) return original;
      return {
        ...slide, locked: original?.locked ?? false,
        ...(motion !== undefined ? { visual: { motif: "none" as const, background: "solid" as const, ...slide.visual, motion } } : {}),
        source: slide.source && (sources.includes(slide.source) || (original && equal(content(original), content(slide)))) ? slide.source : "",
      };
    });
    // Design cannot change after a manual lock; otherwise the AI plan may choose the look.
    if (operation.operation === "generate" || current.slides.some((slide) => slide.locked)) {
      proposed.artDirection = current.artDirection;
      proposed.palette = current.palette;
    }
    return proposed;
  }

  const index = current.slides.findIndex((slide) => slide.id === operation.slideId);
  if (index < 0) throw new PresentationError(404, "Slide tidak ditemukan.");
  const original = current.slides[index];
  if (original.locked) throw new PresentationError(409, "Buka kunci slide sebelum meminta revisi AI.");
  if (proposed.title !== current.title || proposed.theme !== current.theme || proposed.palette !== current.palette || !equal(proposed.artDirection, current.artDirection) || proposed.slides.length !== current.slides.length) {
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
    if (original.adjustments) revised.adjustments = original.adjustments;
    else delete revised.adjustments;
  }
  if (operation.preserve !== "content" && !equal(content(original), content(revised)) && !operation.instruction.includes(revised.source)) revised.source = "";
  return { ...current, slides: current.slides.map((slide, i) => i === index ? revised : slide) };
}
