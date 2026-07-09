import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

export const maxDuration = 60;

function compactProject(project: any) {
  return {
    projectType: project.projectType,
    title: project.title,
    topic: String(project.topic || "").slice(0, 1200),
    course: project.course,
    formality: project.formality,
    citationStyle: project.citationStyle,
    sources: (project.sources || []).slice(0, 8).map((source: any) => ({
      kind: source.kind || "note",
      title: source.title,
      content: String(source.content || "").slice(0, 900),
    })),
    outline: (project.outline || []).map((section: any) => ({
      title: section.title,
      purpose: section.purpose,
      requiredDiagrams: section.requiredDiagrams || [],
    })),
    diagrams: (project.diagrams || []).map((diagram: any) => ({
      title: diagram.title,
      type: diagram.type,
      purpose: diagram.purpose,
      approved: diagram.status === "approved" && Boolean(diagram.diagramData),
      caption: diagram.caption,
    })),
    tables: (project.tables || []).map((table: any) => ({
      title: table.title,
      purpose: table.purpose,
      columns: table.columns || [],
    })),
    references: (project.references || []).map((ref: any) => ({
      query: ref.query,
      purpose: ref.purpose,
      citation: ref.citation,
      url: ref.url,
    })),
  };
}

export async function POST(req: Request) {
  try {
    assertAiConfigured();
    const { project } = await req.json();

    if (!project?.title && !project?.topic) {
      return NextResponse.json({ success: false, error: "Judul atau topik belum diisi." }, { status: 400 });
    }

    const compact = compactProject(project);
    const systemPrompt = `Anda adalah penyusun laporan akademik keluhkampus.
Buat draft laporan lengkap dalam Bahasa Indonesia berdasarkan konteks yang diberikan.
Aturan:
1. Ikuti outline yang tersedia.
2. Jangan mengarang data spesifik yang tidak ada; gunakan placeholder [ISI DATA ...] jika belum tersedia.
3. Masukkan placeholder gambar/diagram dengan format [Gambar: Judul - status].
4. Masukkan tabel markdown sesuai daftar table plan.
5. Buat daftar pustaka awal sesuai gaya sitasi; jika baru berupa query jurnal, tulis sebagai [Cari jurnal: query].
6. Output hanya markdown laporan, tanpa basa-basi.`;

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(compact) },
      ],
      temperature: 0.2,
      max_tokens: 4200,
    });

    return NextResponse.json({ success: true, data: response.choices[0].message.content || "" });
  } catch (error: any) {
    console.error("API /api/ai/generate-report Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal membuat laporan lengkap." },
      { status: 500 }
    );
  }
}
