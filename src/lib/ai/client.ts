import OpenAI from "openai";

const hasPrimaryKey = Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY);
const hasGroqFallback = Boolean(process.env.GROK_API_KEY) && !hasPrimaryKey;

export const AI_MODEL =
  process.env.AI_MODEL || (hasGroqFallback ? "llama-3.3-70b-versatile" : "gpt-5.5");

const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROK_API_KEY || "";
const baseURL =
  process.env.AI_BASE_URL ||
  process.env.OPENAI_BASE_URL ||
  (hasGroqFallback ? "https://api.groq.com/openai/v1" : "https://api.openai.com/v1");

export const aiClient = new OpenAI({
  apiKey,
  baseURL,
});

export function assertAiConfigured() {
  if (!apiKey) {
    throw new Error("AI_API_KEY belum diatur di environment variables.");
  }
}

export async function sendToAI(prompt: string, system?: string) {
  assertAiConfigured();

  const response = await aiClient.chat.completions.create({
    model: AI_MODEL,
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
