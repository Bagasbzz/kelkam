import { NextResponse } from "next/server";
import { sendToAI } from "@/lib/ai/client";
import { UNTRUSTED_DATA_NOTICE, wrapUntrusted } from "@/lib/ai/guard";
import { guardAiRequest } from "@/lib/server/ai-access";
import { publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";

const MAX_TEXT_CHARS = 20_000;

// Instruksi hanya di system prompt; teks laporan masuk sebagai DATA berpembatas.
const SYSTEM_PROMPT = `Anda adalah pemeriksa struktur laporan akademik keluhkampus. Berikan audit singkat, tegas, actionable, dan berbahasa Indonesia.
Tugas satu-satunya: memeriksa apakah teks dari pengguna memiliki komponen penting laporan, makalah, capstone, proposal, atau skripsi.

Periksa apakah terdapat:
1. Latar belakang atau konteks masalah
2. Rumusan masalah / tujuan / pertanyaan utama
3. Metode, alur pengerjaan, atau rancangan solusi
4. Hasil, pembahasan, atau rencana analisis
5. Referensi, sitasi, atau dasar teori

Untuk setiap komponen: jika ditemukan beri tanda [OK], jika tidak ditemukan atau tidak jelas beri tanda [PERLU CEK].

Format jawaban:
Analisis Struktur Laporan:
[OK] Latar belakang: ...
[PERLU CEK] Rumusan masalah / tujuan: ...

Saran Perbaikan Prioritas:
1. ...
2. ...
3. ...

${UNTRUSTED_DATA_NOTICE}`;

export async function POST(req: Request) {
  try {
    const gate = await guardAiRequest("structure-check", { limit: 20 });
    if (!gate.ok) return gate.response;

    const body = await readJsonBody<{ text?: unknown }>(req, 128 * 1024);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS) : "";

    if (!text) {
      return NextResponse.json({ success: false, error: "Teks tidak boleh kosong" }, { status: 400 });
    }

    const aiResponse = await sendToAI(
      `Analisis struktur laporan berikut.\n\n${wrapUntrusted("Teks yang dianalisis", text)}`,
      SYSTEM_PROMPT,
      undefined,
      { maxTokens: 1_500 },
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
