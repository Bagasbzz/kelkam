import { sendToAI } from "./client";

export async function sendToGrok(prompt: string) {
  return sendToAI(
    prompt,
    "Anda adalah asisten peneliti AI untuk keluhkampus. Bantu mahasiswa menyempurnakan konten skripsi, meningkatkan kualitas penulisan, dan memeriksa struktur akademik. Berikan jawaban dalam Bahasa Indonesia yang jelas, rinci, dan terstruktur."
  );
}
