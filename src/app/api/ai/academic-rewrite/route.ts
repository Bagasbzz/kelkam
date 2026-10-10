import { NextResponse } from "next/server";
import { sendToAI } from "@/lib/ai/client";
import { publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

const MAX_TEXT_CHARS = 20_000;

export async function POST(req: Request) {
  try {
    const body = await readJsonBody<{ text?: unknown }>(req, 128 * 1024);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";

    if (!text) {
      return NextResponse.json({ success: false, error: "Teks tidak boleh kosong" }, { status: 400 });
    }

    const prompt = `Anda adalah asisten akademik yang ahli dalam penulisan ilmiah bahasa Indonesia.
Tugas Anda adalah mengubah teks berikut yang mungkin masih bergaya non-formal atau kurang baku menjadi teks dengan gaya bahasa akademik yang sangat formal, objektif, dan profesional.

Aturan pengerjaan:
1. Gunakan diksi yang tepat dan baku (sesuai PUEBI/KBBI).
2. Gunakan kalimat pasif jika lebih sesuai untuk objektivitas ilmiah.
3. Hindari penggunaan kata ganti orang pertama (seperti "saya", "kami") kecuali sangat diperlukan.
4. Pertahankan makna aslinya, hanya perbaiki gaya bahasanya.

Teks yang akan diperbaiki:
"${text}"

Tuliskan hasilnya langsung dalam bahasa akademik yang formal.`;
    
    const aiResponse = await sendToAI(
      prompt,
      "Anda adalah editor akademik keluhkampus. Jawab langsung dengan hasil revisi bahasa Indonesia yang formal, jelas, dan tetap mempertahankan makna asli.",
      "gpt-5-mini"
    );

    return NextResponse.json({ 
      success: true, 
      data: aiResponse 
    });
  } catch (error: unknown) {
    console.error("API /api/ai/academic-rewrite Error:", error);
    return publicErrorResponse(error, "Layanan AI sedang bermasalah. Coba lagi beberapa saat.");
  }
}
