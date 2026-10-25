import OpenAI from "openai";
import { AI_SECURITY_POLICY, AI_SECURITY_POLICY_MARKER, leaksSystemPrompt, sanitizeForPrompt } from "@/lib/ai/guard";
import { safeFetch } from "@/lib/server/safe-fetch";

/**
 * Model configuration (diukur 2026-10-08 di api.z0ne.ai):
 * - gpt-5.x / gpt-6.x: 0 token dalam 60 s (reasoning tersembunyi + antrean) → JANGAN dipakai.
 * - claude-sonnet-5: TTFT ~2-14 s, total ~16 s untuk 500 token → model utama.
 * - deepseek-v4-flash-fast: TTFT ~2.5 s, total ~3 s → model cepat (JSON, klasifikasi, ringkasan).
 * - gpt-image-2: ~95-140 s per gambar → hanya lewat job background.
 *
 * Env boleh override, tapi nama yang diketahui lambat dipetakan ulang ke default
 * supaya salah konfigurasi di hosting tidak melumpuhkan semua fitur.
 */
const SLOW_MODEL = /^gpt-(5|6)/i;
function pickModel(envValue: string | undefined, fallback: string) {
  const value = (envValue || "").trim();
  if (!value || SLOW_MODEL.test(value)) return fallback;
  return value;
}

export const AI_MODEL_DEFAULT = pickModel(process.env.AI_MODEL, "claude-sonnet-5");

export const AI_MODEL_FAST = pickModel(process.env.AI_MODEL_FAST || process.env.AI_MODEL_MINI, "deepseek-v4-flash-fast");
export const AI_MODEL_REVIEW = pickModel(process.env.AI_MODEL_REVIEW || process.env.AI_MODEL_LARGE, AI_MODEL_DEFAULT);
export const AI_MODEL = AI_MODEL_DEFAULT;
export const AI_MODEL_IMAGE = process.env.AI_MODEL_IMAGE || "gpt-image-2";

/** Helper to determine fallback fast model name if provider returns model not found or slow */
export function getFastModelName(): string {
  return AI_MODEL_FAST;
}

/** Helper untuk timeout default AI (ms) */
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 35000);
export const AI_FAST_TIMEOUT_MS = Number(process.env.AI_FAST_TIMEOUT_MS || 20000);

function getAiRuntimeConfig() {
  const apiKey = process.env.AI_API_KEY || "";
  const baseURL = process.env.AI_BASE_URL || "https://api.z0ne.ai/v1";

  return { apiKey, baseURL };
}

let runtimeClient: OpenAI | null = null;

/** Batas atas output per panggilan (anti penyalahgunaan biaya). Panggilan tanpa max_tokens dapat default. */
const MAX_OUTPUT_TOKENS_CAP = Number(process.env.AI_MAX_OUTPUT_TOKENS_CAP || 8_000);
const DEFAULT_OUTPUT_TOKENS = Number(process.env.AI_DEFAULT_OUTPUT_TOKENS || 2_500);
const LEAK_REPLACEMENT = "Maaf, permintaan itu tidak bisa diproses.";

type ChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParams;
type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Bersihkan karakter tersembunyi pada konten teks (string atau part teks). */
function sanitizeMessageContent(msg: ChatMsg): ChatMsg {
  if (msg.role === "system") return msg;
  if (typeof msg.content === "string") return { ...msg, content: sanitizeForPrompt(msg.content, 2_000_000) } as ChatMsg;
  if (Array.isArray(msg.content)) {
    const parts = (msg.content as Array<{ type: string; text?: string }>).map((part) =>
      part.type === "text" && typeof part.text === "string" ? { ...part, text: sanitizeForPrompt(part.text, 2_000_000) } : part,
    );
    return { ...msg, content: parts } as ChatMsg;
  }
  return msg;
}

/**
 * Pengerasan SETIAP request chat sebelum dikirim ke provider:
 *  1. Kebijakan keamanan (anti prompt injection) ditempel di system prompt pertama.
 *  2. Karakter tersembunyi di pesan user/tool/assistant dibuang.
 *  3. max_tokens wajib ada & dibatasi (anti boros biaya).
 *  4. Nama model lambat (gpt-5/6) dipetakan ke model cepat.
 */
function hardenChatRequest(body: ChatParams): ChatParams {
  const messages = body.messages.map(sanitizeMessageContent);
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const sys = messages[firstSystem];
    const text = typeof sys.content === "string" ? sys.content : (sys.content ?? []).map((p) => ("text" in p ? p.text : "")).join("\n");
    if (!text.includes(AI_SECURITY_POLICY_MARKER)) {
      messages[firstSystem] = { role: "system", content: `${AI_SECURITY_POLICY}\n\n${text}` };
    }
  } else {
    messages.unshift({ role: "system", content: AI_SECURITY_POLICY });
  }
  const requested = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : DEFAULT_OUTPUT_TOKENS;
  return {
    ...body,
    model: pickModel(body.model, AI_MODEL_FAST),
    messages,
    max_tokens: Math.min(requested, MAX_OUTPUT_TOKENS_CAP),
  };
}

/** Ganti output yang membocorkan system prompt (non-stream saja). */
function scrubCompletion(result: unknown) {
  const choices = (result as { choices?: Array<{ message?: { content?: string | null } }> })?.choices;
  if (!Array.isArray(choices)) return;
  for (const choice of choices) {
    const content = choice.message?.content;
    if (typeof content === "string" && leaksSystemPrompt(content)) {
      console.warn("[ai-guard] output terindikasi membocorkan system prompt, diganti.");
      choice.message!.content = LEAK_REPLACEMENT;
    }
  }
}

export function getAiClient() {
  const { apiKey, baseURL } = getAiRuntimeConfig();
  if (!apiKey) {
    throw new Error("AI_API_KEY belum diatur di environment variables.");
  }

  if (!runtimeClient) {
    const client = new OpenAI({ apiKey, baseURL });
    // Bungkus chat.completions.create sekali di sini supaya SEMUA pemanggil
    // (route lama maupun baru) otomatis lewat pengaman yang sama.
    const completions = client.chat.completions;
    const original = completions.create.bind(completions);
    const guarded = async (body: ChatParams, options?: Parameters<typeof original>[1]) => {
      const result = await original(hardenChatRequest(body) as never, options);
      if (!body.stream) scrubCompletion(result);
      return result;
    };
    completions.create = guarded as unknown as typeof completions.create;
    runtimeClient = client;
  }

  return runtimeClient;
}

export const aiClient = new Proxy({} as OpenAI, {
  get(_target, prop, receiver) {
    return Reflect.get(getAiClient(), prop, receiver);
  },
});

/** Small helper to choose model by purpose */
export function getModelForPurpose(purpose?: "fast" | "review" | "default") {
  if (purpose === "fast") return AI_MODEL_FAST;
  if (purpose === "review") return AI_MODEL_REVIEW;
  return AI_MODEL_DEFAULT;
}

export function assertAiConfigured() {
  const { apiKey } = getAiRuntimeConfig();
  if (!apiKey) {
    throw new Error("AI_API_KEY belum diatur di environment variables.");
  }
}

/** Model Claude via z0ne mengembalikan `<think>…</think>` di awal konten; buang sebelum diparse. */
export function stripThinking(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^<think>[\s\S]*$/i, "").trim();
}

/**
 * Buang em dash / en dash (ciri khas teks AI) dari output model.
 * Rentang angka jadi tanda hubung, sel tabel kosong jadi "-", sisanya jadi koma.
 */
export function stripDashes(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1-$2")
    .replace(/\|\s*[\u2013\u2014]\s*(?=\|)/g, "| - ")
    .replace(/^(\s*)[\u2013\u2014]\s+/gm, "$1- ")
    .replace(/\s*[\u2013\u2014]+\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.;:!?)\]])/g, "$1");
}

export interface GeneratedImage {
  png: Buffer;
  revisedPrompt?: string;
  model: string;
}

/**
 * Generate satu gambar PNG. LAMBAT (~1.5-2.5 menit), jangan panggil dari request
 * HTTP biasa; pakai job background (`src/lib/server/image-jobs.ts`).
 */
export async function generateImage(prompt: string, options: { size?: "1024x1024" | "1536x1024" | "1024x1536"; quality?: "low" | "medium" | "high"; timeoutMs?: number } = {}): Promise<GeneratedImage> {
  assertAiConfigured();
  const response = await aiClient.images.generate({
    model: AI_MODEL_IMAGE,
    prompt,
    n: 1,
    // Terukur: 1024x1024 low ≈ 95-140 s; medium/1536 bisa >6 menit dan kadang kosong.
    size: options.size || "1024x1024",
    quality: options.quality || "low",
  }, { timeout: options.timeoutMs ?? 240_000, maxRetries: 0 });
  const item = response.data?.[0];
  if (!item) throw new Error("Provider tidak mengembalikan gambar.");
  let png: Buffer;
  if (item.b64_json) {
    png = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    // safeFetch: URL dari provider tetap divalidasi (blok IP privat / redirect ke jaringan internal).
    const res = await safeFetch(item.url, { timeoutMs: 30_000, maxBytes: 25 * 1024 * 1024 });
    if (!res.ok) throw new Error(`Gagal mengunduh gambar (${res.status}).`);
    png = res.body;
  } else {
    throw new Error("Format respons gambar tidak dikenal.");
  }
  return { png, revisedPrompt: item.revised_prompt, model: AI_MODEL_IMAGE };
}

/**
 * sendToAI(prompt, system?, model?)
 * - prompt: user content (bungkus teks tak tepercaya dengan wrapUntrusted dari guard.ts)
 * - system: optional system prompt
 * - model: optional model name override; if omitted uses AI_MODEL_FAST
 *
 * Returns the AI text response (string).
 */
export async function sendToAI(prompt: string, system?: string, model?: string, options: { maxTokens?: number } = {}) {
  assertAiConfigured();

  const chosenModel = model || AI_MODEL_FAST;

  const response = await aiClient.chat.completions.create({
    model: chosenModel,
    messages: [
      {
        role: "system",
        content:
          system ||
          "Anda adalah asisten akademik untuk keluhkampus. Jawab dalam Bahasa Indonesia yang jelas, rinci, terstruktur, dan langsung dapat digunakan mahasiswa.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.25,
    max_tokens: options.maxTokens ?? DEFAULT_OUTPUT_TOKENS,
  }, { timeout: AI_TIMEOUT_MS });

  return stripThinking(response.choices[0].message.content) || "Tidak ada respons dari AI.";
}

/**
 * Convenience wrapper that accepts a purpose instead of explicit model name:
 * purpose = "fast" | "review" | "default"
 */
export async function sendToAIForPurpose(prompt: string, system?: string, purpose?: "fast" | "review" | "default") {
  const model = getModelForPurpose(purpose);
  return sendToAI(prompt, system, model);
}
