import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

const REPORT_TIMEOUT_MS = Number(process.env.AI_REPORT_TIMEOUT_MS || 8500);

export function compactProject(project: any) {
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
      pdfUrl: ref.pdfUrl,
      abstract: String(ref.abstract || "").slice(0, 1200),
    })),
  };
}

function tableMarkdown(table: any) {
  const columns = Array.isArray(table.columns) && table.columns.length ? table.columns : ["Aspek", "Keterangan"];
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    `| ${columns.map((column: string) => `[ISI ${String(column).toUpperCase()}]`).join(" | ")} |`,
  ].join("\n");
}

export function fallbackReport(project: any) {
  const compact = compactProject(project);
  const title = compact.title || compact.topic || "Laporan Proyek";
  const outline = compact.outline.length ? compact.outline : [
    { title: "Pendahuluan", purpose: "Menjelaskan latar belakang, tujuan, dan batasan laporan.", requiredDiagrams: [] },
    { title: "Pembahasan", purpose: "Menjelaskan hasil analisis dan implementasi berdasarkan konteks.", requiredDiagrams: [] },
    { title: "Penutup", purpose: "Memuat kesimpulan dan saran.", requiredDiagrams: [] },
  ];

  const sourceSummary = compact.sources.map((source: any, index: number) => (
    `- Sumber ${index + 1}: ${source.title} (${source.kind}) - ${String(source.content || "").slice(0, 180)}${String(source.content || "").length > 180 ? "..." : ""}`
  )).join("\n") || "- [ISI SUMBER UTAMA]";

  const diagramBlock = compact.diagrams.length
    ? compact.diagrams.map((diagram: any, index: number) => `${index + 1}. [Gambar: ${diagram.title} - ${diagram.approved ? "sudah disetujui" : "perlu dibuat/approve"}]\n   Caption: ${diagram.caption || diagram.purpose}`).join("\n")
    : "[Gambar: Tambahkan diagram bila dibutuhkan]";

  const tableBlock = compact.tables.length
    ? compact.tables.map((table: any, index: number) => `### Tabel ${index + 1}. ${table.title}\n${table.purpose}\n\n${tableMarkdown(table)}`).join("\n\n")
    : "[Tabel belum direncanakan]";

  const references = compact.references.length
    ? compact.references.map((ref: any) => ref.citation || `[Cari jurnal: ${ref.query}]${ref.url ? ` - ${ref.url}` : ""}`).join("\n")
    : "[Tambahkan referensi/jurnal yang relevan]";

  return `# ${title}\n\n> Draft cepat dibuat otomatis karena respons AI utama terlalu lama. Draft ini sudah mengikuti konteks, outline, tabel, diagram, dan referensi yang tersimpan. Gunakan fitur revisi untuk memperpanjang BAB tertentu, menambah sitasi, atau merapikan format.\n\n## Ringkasan Konteks\n${sourceSummary}\n\n${outline.map((section: any, index: number) => `## ${section.title}\n\n${section.purpose}\n\n${index === 0 ? `Laporan ini membahas ${title} berdasarkan konteks proyek, pedoman, dan bahan yang telah dimasukkan. Bagian ini perlu memuat latar belakang, rumusan masalah, tujuan, manfaat, dan batasan pembahasan secara runtut.` : `Bagian ini perlu dikembangkan berdasarkan bahan mentah dan sumber yang tersedia. Hindari penambahan data spesifik yang belum ada; gunakan placeholder bila data belum lengkap.`}\n\n${Array.isArray(section.requiredDiagrams) && section.requiredDiagrams.length ? section.requiredDiagrams.map((diagramId: string) => `[Gambar: ${diagramId} - masukkan dari UML Builder]`).join("\n") : ""}`).join("\n\n")}\n\n## Daftar Gambar dan Diagram\n${diagramBlock}\n\n## Rencana Tabel\n${tableBlock}\n\n## Daftar Pustaka Awal\n${references}\n`;
}

export async function generateReportDraft(project: any) {
  assertAiConfigured();
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

  try {
    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(compact) },
      ],
      temperature: 0.2,
      max_tokens: 1800,
    }, { timeout: REPORT_TIMEOUT_MS });

    return { content: response.choices[0].message.content || "", source: "ai" };
  } catch (error: any) {
    if (/timeout|timed out|aborted|deadline/i.test(String(error?.message || error))) {
      return { content: fallbackReport(project), source: "fallback-timeout" };
    }
    throw error;
  }
}
