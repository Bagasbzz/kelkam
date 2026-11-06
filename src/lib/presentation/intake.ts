import { z } from "zod";
import type { PresentationDeck } from "./model";

export const MAX_INTAKE_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_REFERENCE_BYTES = 4 * 1024 * 1024;
export const MAX_INTAKE_CHARS = 40_000;
export const MAX_INTAKE_FILES = 8;
export const BRIEF_QUESTION_IDS = ["audience", "duration", "tone", "intent"] as const;

const boundedText = (max: number) => z.string().trim().max(max).refine(
  (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value),
  "Teks mengandung karakter yang tidak didukung.",
);
const publicText = (max: number) => boundedText(max).min(1).refine(
  (value) => !/(?:https?:\/\/|www\.|data:|javascript:)/iu.test(value), "Jawaban tidak boleh berisi tautan.",
);

export const presentationBriefInputSchema = z.object({
  materialText: boundedText(MAX_INTAKE_CHARS).default(""),
  notes: boundedText(4000).default(""),
  referenceFileId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
}).strict().superRefine((input, ctx) => {
  if (!input.materialText && !input.notes) ctx.addIssue({ code: "custom", message: "Tambahkan bahan atau ceritakan topik presentasi." });
  if (input.materialText.length + input.notes.length > MAX_INTAKE_CHARS) ctx.addIssue({ code: "custom", message: "Gabungan bahan maksimum 40.000 karakter." });
});

export const presentationBriefSchema = z.object({
  summary: publicText(800),
  questions: z.array(z.object({
    id: z.enum(BRIEF_QUESTION_IDS),
    label: publicText(180),
    options: z.array(publicText(100)).min(2).max(4).refine((items) => new Set(items).size === items.length),
  }).strict()).length(4),
}).strict().superRefine((brief, ctx) => {
  if (new Set(brief.questions.map((question) => question.id)).size !== brief.questions.length) {
    ctx.addIssue({ code: "custom", message: "Pertanyaan harus berbeda dan mencakup keempat preferensi." });
  }
});

export type PresentationBriefInput = z.infer<typeof presentationBriefInputSchema>;
export type PresentationBrief = z.infer<typeof presentationBriefSchema>;
export type BriefQuestionId = (typeof BRIEF_QUESTION_IDS)[number];
export interface PresentationIntakeResult {
  deck: PresentationDeck;
  prompt: string;
  materialText: string;
  audience: string;
  minutes: number;
  slideCount: number;
}

export const DEFAULT_INTAKE_ANSWERS: Record<BriefQuestionId, string> = {
  audience: "Mahasiswa di kelas", duration: "10 menit", tone: "Rapi dan ramah", intent: "Menjelaskan gagasan dengan jelas",
};

/** This is a manual form, never presented as a successful AI consultation. */
export function manualPresentationBrief(): PresentationBrief {
  return {
    summary: "Atur sendiri kebutuhan presentasi Anda. Ringkasan AI belum tersedia.",
    questions: [
      { id: "audience", label: "Siapa yang akan melihat presentasi ini?", options: ["Mahasiswa di kelas", "Dosen atau penguji", "Tim kerja", "Masyarakat umum"] },
      { id: "duration", label: "Berapa lama Anda akan berbicara?", options: ["5 menit", "10 menit", "15 menit", "20 menit"] },
      { id: "tone", label: "Suasana seperti apa yang Anda inginkan?", options: ["Rapi dan ramah", "Formal dan tenang", "Kreatif dan berani", "Sederhana dan ringan"] },
      { id: "intent", label: "Apa yang ingin Anda capai setelah presentasi?", options: ["Menjelaskan gagasan dengan jelas", "Meyakinkan untuk bertindak", "Memaparkan hasil dari bahan", "Membuka diskusi"] },
    ],
  };
}

/** Parse the complete response, not a JSON fragment hidden inside arbitrary prose. */
export function parsePresentationBrief(content: string): PresentationBrief {
  if (content.length > 12_000) throw new Error("Jawaban konsultasi terlalu panjang.");
  return presentationBriefSchema.parse(JSON.parse(content.trim()));
}

export function combineIntakeMaterials(notes: string, materials: readonly string[]): string {
  const combined = [notes.trim(), ...materials.map((text) => text.trim())].filter(Boolean).join("\n\n");
  if (combined.length > MAX_INTAKE_CHARS) throw new Error("Gabungan bahan melebihi 40.000 karakter. Kurangi catatan atau hapus sebagian dokumen.");
  return combined;
}

export function intakeMinutes(answer: string): number | null {
  // Custom answers use minutes explicitly; do not reinterpret hours as minutes.
  const match = answer.trim().match(/^(\d{1,3})(?:\s*(?:menit|min|minutes?))?$/iu);
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= 180 ? value : null;
}
