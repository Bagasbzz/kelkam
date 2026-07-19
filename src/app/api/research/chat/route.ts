import { NextResponse } from "next/server";
import { sendToAI, assertAiConfigured } from "@/lib/ai/client";

function extractJson(text: string) {
  let json = String(text || "").trim();
  // strip code fences
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);
  // try to find the first {...} block
  const firstBrace = json.indexOf("{");
  const lastBrace = json.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = json.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // fall through
    }
  }
  // fallback: try to parse whole text
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    assertAiConfigured();
    const body = await req.json().catch(() => ({}));
    const { projectId = null, brief = {}, messages = [] } = body;

    if ((!brief || Object.keys(brief).length === 0) && (!Array.isArray(messages) || messages.length === 0)) {
      return NextResponse.json({ success: false, error: "Payload kosong. Kirim minimal brief atau pesan percakapan." }, { status: 400 });
    }

    // System instruction: produce strict JSON output only
    const systemPrompt = `Anda adalah asisten penyusunan laporan akademik KeluhKampus. Tugas Anda menghasilkan respon terstruktur JSON untuk memperbarui 'ResearchBrief' proyek serta mengajukan pertanyaan lanjutan bila perlu.
Keluaran harus berupa sebuah JSON tunggal (tanpa penjelasan lain) dengan schema:
{
  "patch": { /* partial ResearchBrief fields to merge */ },
  "summary": "Ringkasan singkat (1-3 kalimat) dari brief saat ini",
  "followupQuestions": [{ "id":"q1", "field":"title|yearRange|citationStyle|...","text":"Pertanyaan singkat untuk user" }],
  "finalized": false
}
- Jika brief sudah lengkap dan tidak perlu tanya lagi, followupQuestions harus kosong dan finalized: true.
- Jangan mengarang data (mis. nama jurnal atau angka) — hanya proses brief yang diberikan.
- Output harus valid JSON.`;

    const userPayload = {
      projectId,
      brief,
      recentMessages: Array.isArray(messages) ? messages.slice(-8) : [],
    };

    const userPrompt = `Input:\n${JSON.stringify(userPayload, null, 2)}\n\nInstruksi: Kembalikan JSON sesuai schema system prompt di atas.`;

    const aiText = await sendToAI(userPrompt, systemPrompt);

    const parsed = extractJson(aiText);

    if (!parsed) {
      // Return raw ai text for debugging if parsing failed
      return NextResponse.json({ success: true, source: "ai-raw", raw: aiText, warning: "Gagal parse JSON dari respons AI" });
    }

    // Basic normalization
    const patch = parsed.patch || {};
    const summary = parsed.summary || "";
    const followupQuestions = Array.isArray(parsed.followupQuestions) ? parsed.followupQuestions : [];
    const finalized = Boolean(parsed.finalized);

    return NextResponse.json({
      success: true,
      source: "ai-structured",
      data: { patch, summary, followupQuestions, finalized },
    });
  } catch (error: any) {
    console.error("API /api/research/chat Error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Gagal memproses chat research." }, { status: 500 });
  }
}