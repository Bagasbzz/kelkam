import { NextResponse } from "next/server";
import { sendToGrok } from "@/lib/ai/grokClient";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

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
    
    const aiResponse = await sendToGrok(prompt);

    return NextResponse.json({ 
      success: true, 
      data: aiResponse 
    });
  } catch (error: any) {
    console.error("API /api/ai/academic-rewrite Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Terjadi kesalahan internal pada server" },
      { status: 500 }
    );
  }
}
