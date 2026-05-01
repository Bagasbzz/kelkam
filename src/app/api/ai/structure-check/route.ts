import { NextResponse } from "next/server";
import { sendToGrok } from "@/lib/ai/grokClient";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ success: false, error: "Teks tidak boleh kosong" }, { status: 400 });
    }

    const prompt = `Anda adalah asisten akademik yang bertugas menganalisis struktur skripsi mahasiswa.
Tugas Anda adalah memeriksa apakah teks berikut memiliki komponen penting skripsi.

Periksa apakah terdapat:
1. Latar Belakang
2. Rumusan Masalah
3. Tujuan Penelitian
4. Metodologi Penelitian
5. Referensi atau sitasi

Untuk setiap komponen:
Jika ditemukan → beri tanda ✓
Jika tidak ditemukan atau tidak jelas → beri tanda ⚠

Berikan jawaban dalam format berikut:

Analisis Struktur Skripsi:
✓ Latar Belakang ditemukan/tidak...
... dan seterusnya ...

Serta berikan saran perbaikan singkat di bagian akhir.

Teks yang dianalisis:
"${text}"`;
    
    const aiResponse = await sendToGrok(prompt);

    return NextResponse.json({ 
      success: true, 
      data: aiResponse 
    });
  } catch (error: any) {
    console.error("API /api/ai/structure-check Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Terjadi kesalahan internal pada server" },
      { status: 500 }
    );
  }
}
