import OpenAI from "openai";

const hasPrimaryKey = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
const hasGroqFallback = Boolean(process.env.GROK_API_KEY) && !hasPrimaryKey;

/**
 * Model configuration:
 * - AI_MODEL_DEFAULT: primary model used when no special purpose specified
 * - AI_MODEL_FAST: lower-cost / faster model for routine tasks
 * - AI_MODEL_REVIEW: stronger model for synthesis/review tasks
 *
 * These can be set in environment variables to allow runtime switching.
 */
export const AI_MODEL_DEFAULT =
  process.env.AI_MODEL || (hasGroqFallback ? "llama-3.3-70b-versatile" : "gpt-5.5");

export const AI_MODEL_FAST = process.env.AI_MODEL_FAST || process.env.AI_MODEL_MINI || "gpt-5-mini";
export const AI_MODEL_REVIEW = process.env.AI_MODEL_REVIEW || process.env.AI_MODEL_LARGE || AI_MODEL_DEFAULT;
export const AI_MODEL = AI_MODEL_DEFAULT;

const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROK_API_KEY || "";
const baseURL =
  process.env.AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  (hasGroqFallback ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1");

export const aiClient = new OpenAI({
  apiKey,
  baseURL,
});

/** Small helper to choose model by purpose */
export function getModelForPurpose(purpose?: "fast" | "review" | "default") {
  if (purpose === "fast") return AI_MODEL_FAST;
  if (purpose === "review") return AI_MODEL_REVIEW;
  return AI_MODEL_DEFAULT;
}

export function assertAiConfigured() {
  if (!apiKey) {
    throw new Error("AI_API_KEY belum diatur di environment variables.");
  }
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

  const chosenModel = model || AI_MODEL_DEFAULT;

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
  });

  return response.choices[0].message.content || "Tidak ada respons dari AI.";
}

/**
 * Convenience wrapper that accepts a purpose instead of explicit model name:
 * purpose = "fast" | "review" | "default"
 */
export async function sendToAIForPurpose(prompt: string, system?: string, purpose?: "fast" | "review" | "default") {
  const model = getModelForPurpose(purpose);
  return sendToAI(prompt, system, model);
}