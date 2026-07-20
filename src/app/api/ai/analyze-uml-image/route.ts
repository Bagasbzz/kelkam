import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

export const maxDuration = 60;

function extractJson(text: string) {
  let json = text.trim();
  if (json.startsWith("```json")) json = json.slice(7);
  if (json.startsWith("```")) json = json.slice(3);
  if (json.endsWith("```")) json = json.slice(0, -3);
  const firstBrace = json.indexOf("{");
  const lastBrace = json.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) json = json.slice(firstBrace, lastBrace + 1);
  return JSON.parse(json.trim()) as { summary?: string; reconstructionPrompt?: string };
}

export async function POST(req: Request) {
  try {
    assertAiConfigured();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const diagramType = String(formData.get("diagramType") || "flowchart");
    const prompt = String(formData.get("prompt") || "").trim();

    if (!file) {
      return NextResponse.json({ success: false, error: "File gambar tidak ditemukan." }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ success: false, error: "Upload harus berupa gambar diagram UML." }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const dataUrl = `data:${file.type};base64,${bytes.toString("base64")}`;

    const analysisPrompt = [
      `Analisis diagram ${diagramType} dari gambar UML ini.`,
      "Fokus pada aktor, langkah utama, cabang keputusan, participant, urutan pesan, dan lane bila ada.",
      "Jika garis bengkok, bentuk agak salah, atau label kurang rapi, simpulkan versi struktur yang paling masuk akal dan formal.",
      prompt ? `Tambahan dari user: ${prompt}` : "",
      "Balas JSON saja dengan schema: {\"summary\":\"...\",\"reconstructionPrompt\":\"...\"}.",
      "reconstructionPrompt harus berupa instruksi teks yang siap dikirim ke generator UML agar hasilnya rapi, formal, garis tegas, dan sesuai isi diagram.",
    ].filter(Boolean).join("\n");

    const analysis = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: "Anda adalah analis diagram UML. Baca gambar, pahami struktur, dan ubah ke instruksi teks yang rapi untuk direkonstruksi ulang.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ] as any,
        },
      ],
      temperature: 0.1,
      max_tokens: 900,
    });

    const extracted = extractJson(analysis.choices[0].message.content || "{}");
    const reconstructionPrompt = extracted.reconstructionPrompt || prompt;
    if (!reconstructionPrompt) {
      return NextResponse.json({ success: false, error: "AI belum berhasil menangkap struktur diagram dari gambar ini." }, { status: 422 });
    }

    const url = new URL("/api/ai/generate-uml", req.url);
    const regeneration = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: reconstructionPrompt,
        diagramType,
        reportContext: {
          purpose: "rekonstruksi dari gambar UML referensi",
          topic: extracted.summary || file.name,
        },
      }),
    });

    const data = await regeneration.json();
    if (!regeneration.ok || !data?.success) {
      return NextResponse.json({
        success: false,
        error: data?.clarification || data?.error || "Generator UML gagal merekonstruksi diagram dari gambar.",
        analysisSummary: extracted.summary || null,
      }, { status: regeneration.status || 500 });
    }

    return NextResponse.json({
      success: true,
      analysisSummary: extracted.summary || "Struktur diagram berhasil dibaca dari gambar referensi.",
      reconstructionPrompt,
      data: data.data,
      spec: data.spec,
      validation: data.validation,
    });
  } catch (error: any) {
    console.error("API /api/ai/analyze-uml-image Error:", error);
    return NextResponse.json({ success: false, error: error.message || "Gagal menganalisis gambar UML." }, { status: 500 });
  }
}
