import OpenAI from "openai";

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

export function getAiClient() {
  const { apiKey, baseURL } = getAiRuntimeConfig();
  if (!apiKey) {
    throw new Error("AI_API_KEY belum diatur di environment variables.");
  }

  if (!runtimeClient) {
    runtimeClient = new OpenAI({ apiKey, baseURL });
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

export interface GeneratedImage {
  png: Buffer;
  revisedPrompt?: string;
  model: string;
}

/**
 * Generate satu gambar PNG. LAMBAT (~1.5-2.5 menit) — jangan panggil dari request
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
    const res = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Gagal mengunduh gambar (${res.status}).`);
    png = Buffer.from(await res.arrayBuffer());
  } else {
    throw new Error("Format respons gambar tidak dikenal.");
  }
  return { png, revisedPrompt: item.revised_prompt, model: AI_MODEL_IMAGE };
}

/**
 * sendToAI(prompt, system?, model?)
 * - prompt: user content
 * - system: optional system prompt
 * - model: optional model name override; if omitted uses AI_MODEL_DEFAULT
 *
 * Returns the AI text response (string).
 */
export async function sendToAI(prompt: string, system?: string, model?: string) {
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
