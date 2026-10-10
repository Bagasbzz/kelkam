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
      "Anda adalah pemeriksa struktur akademik keluhkampus. Berikan audit singkat, tegas, actionable, dan berbahasa Indonesia.",
      "gpt-5-mini"
    );

    return NextResponse.json({
      success: true,
      data: aiResponse,
    });
  } catch (error: unknown) {
    console.error("API /api/ai/structure-check Error:", error);
    return publicErrorResponse(error, "Layanan AI sedang bermasalah. Coba lagi beberapa saat.");
  }
}
