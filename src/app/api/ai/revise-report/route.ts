import { NextResponse } from "next/server";
import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

export const maxDuration = 60;

const revisionLabel: Record<string, string> = {
  format: "rapikan format, heading, numbering, dan konsistensi bahasa",
  expand: "tambahkan isi yang relevan pada bagian yang diminta",
  citation: "tambahkan sitasi dari referensi yang tersedia dan tandai placeholder jika kurang sumber",
  table: "tambahkan atau rapikan tabel markdown yang relevan",
  bibliography: "rapikan daftar pustaka sesuai gaya sitasi",
  diagram: "masukkan placeholder gambar/diagram dan caption pada bagian yang tepat",
  custom: "ikuti instruksi revisi pengguna",
};

function compactProject(project: any) {
  return {
    projectType: project.projectType,
    title: project.title,
    topic: String(project.topic || "").slice(0, 900),
    formality: project.formality,
    citationStyle: project.citationStyle,
    sources: (project.sources || []).slice(0, 6).map((source: any) => ({
      kind: source.kind || "note",
      title: source.title,
      content: String(source.content || "").slice(0, 700),
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
      status: diagram.status,
      caption: diagram.caption,
    })),
    tables: (project.tables || []).map((table: any) => ({
      title: table.title,
      purpose: table.purpose,
      columns: table.columns || [],
      status: table.status,
    })),
    references: (project.references || []).map((ref: any) => ({
      query: ref.query,
      purpose: ref.purpose,
      citation: ref.citation,
      url: ref.url,
      pdfUrl: ref.pdfUrl,
      abstract: String(ref.abstract || "").slice(0, 800),
    })),
  };
}

export async function POST(req: Request) {
  try {
    assertAiConfigured();
    const { project, draft, revisionMode, targetSection, instruction } = await req.json();

    if (!draft || String(draft).trim().length < 80) {
      return NextResponse.json({ success: false, error: "Draft laporan belum cukup untuk direvisi." }, { status: 400 });
    }

    const compact = compactProject(project || {});
    const task = revisionLabel[revisionMode] || revisionLabel.custom;

    const systemPrompt = `Anda adalah editor laporan akademik keluhkampus.
Tugas Anda merevisi draft laporan Bahasa Indonesia berdasarkan konteks proyek.
Aturan ketat:
1. Output hanya markdown laporan hasil revisi utuh, tanpa penjelasan tambahan.
2. Pertahankan struktur utama draft kecuali instruksi meminta perubahan struktur.
3. Jika target bagian diberikan, fokus ubah bagian itu dan jaga bagian lain tetap stabil.
4. Jangan mengarang data, hasil penelitian, angka, nama jurnal, atau link. Gunakan placeholder [ISI DATA ...] jika data belum ada.
5. Untuk sitasi, gunakan referensi tersimpan. Jika belum cukup, tulis [butuh referensi: topik].
6. Untuk tabel, buat tabel markdown yang rapi dengan kolom yang jelas.
7. Untuk diagram/gambar, masukkan placeholder [Gambar: Judul - sumber/diagram] dan caption singkat.
8. Bahasa harus ${compact.formality || "formal"}, jelas, akademik, dan siap ditempel ke laporan.`;

    const userPayload = {
      revisi: {
        jenis: task,
        targetBagian: targetSection || "seluruh draft bila perlu",
        instruksiTambahan: instruction || "Ikuti jenis revisi secara wajar dan efisien.",
      },
      konteksProyek: compact,
      draft: String(draft).slice(0, 18000),
    };

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
      temperature: 0.18,
      max_tokens: 3600,
    });

    return NextResponse.json({ success: true, data: response.choices[0].message.content || "" });
  } catch (error: any) {
    console.error("API /api/ai/revise-report Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal merevisi laporan." },
      { status: 500 }
    );
  }
}
