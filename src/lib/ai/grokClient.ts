import OpenAI from "openai";

const grokApiKey = process.env.GROK_API_KEY || "";

const openai = new OpenAI({
  apiKey: grokApiKey,
  baseURL: "https://api.groq.com/openai/v1",
});

export async function sendToGrok(prompt: string) {
  if (!grokApiKey) {
    throw new Error("GROK_API_KEY is not defined in environment variables.");
  }

  try {
    const response = await openai.chat.completions.create({
      model: "groq/compound", // Model Compound Reasoning di Groq Cloud
      messages: [
        {
          role: "system",
          content: "Anda adalah asisten peneliti AI untuk keluhkampus, membantu mahasiswa menyempurnakan konten skripsi mereka, meningkatkan kualitas penulisan, dan memeriksa struktur akademik. Berikan jawaban dalam Bahasa Indonesia."
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
    });

    return response.choices[0].message.content || "No response content from AI.";
  } catch (error: any) {
    console.error("Grok Client Error:", error);
    throw new Error(error.message || "Failed to communicate with Grok API");
  }
}
