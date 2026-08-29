import { NextResponse } from "next/server";
import { sendToAI } from "@/lib/ai/client";
import { getErrorMessage } from "@/lib/errors";

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json({ success: false, error: "Teks tidak boleh kosong" }, { status: 400 });
    }

    const prompt = `Anda adalah asisten akademik yang bertugas menganalisis struktur laporan mahasiswa.
Tugas Anda adalah memeriksa apakah teks berikut memiliki komponen penting untuk laporan, makalah, capstone, proposal, atau skripsi.

Periksa apakah terdapat:
1. Latar belakang atau konteks masalah
2. Rumusan masalah / tujuan / pertanyaan utama
3. Metode, alur pengerjaan, atau rancangan solusi
4. Hasil, pembahasan, atau rencana analisis
5. Referensi, sitasi, atau dasar teori

Untuk setiap komponen:
- Jika ditemukan, beri tanda [OK]
- Jika tidak ditemukan atau tidak jelas, beri tanda [PERLU CEK]

Berikan jawaban dalam format berikut:

Analisis Struktur Laporan:
[OK] Latar belakang: ...
[PERLU CEK] Rumusan masalah / tujuan: ...

Saran Perbaikan Prioritas:
1. ...
2. ...
3. ...

Teks yang dianalisis:
"${text}"`;

    const aiResponse = await sendToAI(
      prompt,
      "Anda adalah pemeriksa struktur akademik keluhkampus. Berikan audit singkat, tegas, actionable, dan berbahasa Indonesia."
    );

    return NextResponse.json({
      success: true,
      data: aiResponse,
    });
  } catch (error: unknown) {
    console.error("API /api/ai/structure-check Error:", error);
    return NextResponse.json(
      { success: false, error: getErrorMessage(error, "Terjadi kesalahan internal pada server") },
      { status: 500 }
    );
  }
}
