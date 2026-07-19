import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";

const REPORT_TIMEOUT_MS = Number(process.env.AI_REPORT_TIMEOUT_MS || 25000);

function truncate(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function summarizeDiagramData(diagramData: any) {
  const nodes = Array.isArray(diagramData?.nodes) ? diagramData.nodes : [];
  const edges = Array.isArray(diagramData?.edges) ? diagramData.edges : [];
  const mainElements = nodes
    .slice(0, 12)
    .map((node: any) => truncate(node?.text, 70))
    .filter(Boolean);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    mainElements,
    lanes: Array.isArray(diagramData?.meta?.lanes) ? diagramData.meta.lanes.slice(0, 6) : [],
  };
}

export function compactProject(project: any) {
  return {
    projectType: project.projectType,
    title: project.title,
    topic: truncate(project.topic, 1800),
    course: project.course,
    formality: project.formality,
    citationStyle: project.citationStyle,
    sources: (project.sources || []).slice(0, 12).map((source: any) => ({
      kind: source.kind || "note",
      title: source.title,
      content: truncate(source.content, 1600),
    })),
    outline: (project.outline || []).map((section: any) => ({
      title: section.title,
      purpose: section.purpose,
      requiredDiagrams: section.requiredDiagrams || [],
    })),
    diagrams: (project.diagrams || []).map((diagram: any) => ({
      id: diagram.id,
      title: diagram.title,
      type: diagram.type,
      purpose: diagram.purpose,
      approved: diagram.status === "approved" && Boolean(diagram.diagramData),
      status: diagram.status,
      caption: diagram.caption,
      dataSummary: diagram.diagramData ? summarizeDiagramData(diagram.diagramData) : null,
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
      abstract: truncate(ref.abstract, 1400),
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

function diagramCaption(diagram: any, index: number) {
  const status = diagram.approved ? "sudah disetujui dari UML Builder" : "perlu dibuat/approve";
  const elements = Array.isArray(diagram.dataSummary?.mainElements) && diagram.dataSummary.mainElements.length
    ? ` Elemen utama: ${diagram.dataSummary.mainElements.join("; ")}.`
    : "";

  return `${index + 1}. [Gambar: ${diagram.title || `Diagram ${index + 1}`} - ${status}]\n   Caption: ${diagram.caption || diagram.purpose || "Menjelaskan alur/struktur sistem."}${elements}`;
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
    ? compact.diagrams.map(diagramCaption).join("\n")
    : "[Gambar: Tambahkan diagram bila dibutuhkan]";

  const tableBlock = compact.tables.length
    ? compact.tables.map((table: any, index: number) => `### Tabel ${index + 1}. ${table.title}\n${table.purpose}\n\n${tableMarkdown(table)}`).join("\n\n")
    : "[Tabel belum direncanakan]";

  const references = compact.references.length
    ? compact.references.map((ref: any) => ref.citation || `[Cari jurnal: ${ref.query}]${ref.url ? ` - ${ref.url}` : ""}`).join("\n")
    : "[Tambahkan referensi/jurnal yang relevan]";

  return `# ${title}\n\n> Draft cepat dibuat otomatis karena respons AI utama terlalu lama. Draft ini sudah mengikuti konteks, outline, tabel, diagram, dan referensi yang tersimpan. Gunakan fitur revisi untuk memperpanjang BAB tertentu, menambah sitasi, atau merapikan format.\n\n## Ringkasan Konteks\n${sourceSummary}\n\n${outline.map((section: any, index: number) => `## ${section.title}\n\n${section.purpose}\n\n${index === 0 ? `Laporan ini membahas ${title} berdasarkan konteks proyek, pedoman, dan bahan yang telah dimasukkan. Bagian ini perlu memuat latar belakang, rumusan masalah, tujuan, manfaat, dan batasan pembahasan secara runtut.` : `Bagian ini perlu dikembangkan berdasarkan bahan mentah dan sumber yang tersedia. Hindari penambahan data spesifik yang belum ada; gunakan placeholder bila data belum lengkap.`}\n\n${Array.isArray(section.requiredDiagrams) && section.requiredDiagrams.length ? section.requiredDiagrams.map((diagramId: string) => `[Gambar: ${diagramId} - masukkan dari UML Builder]`).join("\n") : ""}`).join("\n\n")}\n\n## Daftar Gambar dan Diagram\n${diagramBlock}\n\n## Rencana Tabel\n${tableBlock}\n\n## Daftar Pustaka Awal\n${references}\n`;
}

function normalizeReportOutput(content: string, project: any) {
  let output = String(content || "").trim();

  output = output.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
  output = output.replace(/^(berikut|tentu|baik)[^\n]*\n+/i, "").trim();

  if (output.length < 900) {
    return fallbackReport(project);
  }

  if (!/^#\s+/m.test(output)) {
    const compact = compactProject(project);
    output = `# ${compact.title || compact.topic || "Laporan Proyek"}\n\n${output}`;
  }

  if (!/daftar pustaka|referensi/i.test(output)) {
    const compact = compactProject(project);
    const references = compact.references.length
      ? compact.references.map((ref: any) => ref.citation || `[Cari jurnal: ${ref.query || ref.purpose || "topik terkait"}]${ref.url ? ` - ${ref.url}` : ""}`).join("\n")
      : "[Tambahkan referensi/jurnal yang relevan]";
    output += `\n\n## Daftar Pustaka\n${references}`;
  }

  return output;
}

export async function generateReportDraft(project: any) {
  assertAiConfigured();
  const compact = compactProject(project);
  const systemPrompt = `Anda adalah penyusun laporan akademik keluhkampus untuk mahasiswa Indonesia.
Buat draft laporan lengkap dalam Bahasa Indonesia berdasarkan konteks yang diberikan.

Aturan kualitas wajib:
1. Output hanya markdown laporan utuh, tanpa basa-basi, tanpa code fence.
2. Ikuti outline yang tersedia secara berurutan. Setiap bagian outline harus muncul sebagai heading.
3. Tulis dengan gaya ${compact.formality || "formal akademik"}, koheren, tidak repetitif, dan siap diedit.
4. Jangan mengarang data spesifik, angka hasil, nama institusi, nama narasumber, nama jurnal, atau link yang tidak ada. Gunakan placeholder spesifik seperti [ISI DATA HASIL PENGUJIAN] jika belum tersedia.
5. Gunakan semua sumber/konteks yang relevan. Jika sumber tidak cukup, jelaskan sebagai kebutuhan data, bukan fakta baru.
6. Masukkan placeholder gambar/diagram dengan format [Gambar: Judul - status] dan caption singkat pada bagian yang paling tepat.
7. Jika diagram sudah approved dan punya ringkasan elemen, gunakan elemen itu untuk menjelaskan isi diagram secara naratif.
8. Buat tabel markdown sesuai daftar table plan. Jangan menambah kolom yang tidak relevan.
9. Daftar pustaka mengikuti gaya ${compact.citationStyle || "sitasi yang dipilih"}. Jika referensi baru berupa query, tulis [Cari jurnal: query].
10. Struktur minimal memuat: judul, pendahuluan/konteks, pembahasan sesuai outline, tabel/diagram bila ada, kesimpulan, dan daftar pustaka.`;

  try {
    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(compact) },
      ],
      temperature: 0.12,
      max_tokens: 4800,
    }, { timeout: REPORT_TIMEOUT_MS });

    return { content: normalizeReportOutput(response.choices[0].message.content || "", project), source: "ai" };
  } catch (error: any) {
    if (/timeout|timed out|aborted|deadline/i.test(String(error?.message || error))) {
      return { content: fallbackReport(project), source: "fallback-timeout" };
    }
    throw error;
  }
}
