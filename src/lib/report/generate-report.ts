import { aiClient, AI_MODEL, assertAiConfigured } from "@/lib/ai/client";
import { isAbortLikeError } from "@/lib/errors";

const REPORT_TIMEOUT_MS = Number(process.env.AI_REPORT_TIMEOUT_MS || 25000);

function truncate(value: unknown, max: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const records = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function summarizeDiagramData(diagramData: unknown) {
  const data = isRecord(diagramData) ? diagramData : {};
  const nodes = records(data.nodes);
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const meta = isRecord(data.meta) ? data.meta : {};
  const mainElements = nodes
    .slice(0, 12)
    .map((node) => truncate(node.text, 70))
    .filter(Boolean);

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    mainElements,
    lanes: strings(meta.lanes).slice(0, 6),
  };
}

export function compactProject(project: unknown) {
  const source = isRecord(project) ? project : {};
  return {
    projectType: truncate(source.projectType, 80),
    title: truncate(source.title, 240),
    topic: truncate(source.topic, 1800),
    course: truncate(source.course, 180),
    formality: truncate(source.formality, 40),
    citationStyle: truncate(source.citationStyle, 40),
    sources: records(source.sources).slice(0, 12).map((item) => ({
      kind: truncate(item.kind, 40) || "note",
      title: truncate(item.title, 180),
      content: truncate(item.content, 1600),
    })),
    outline: records(source.outline).slice(0, 50).map((section) => ({
      title: truncate(section.title, 180),
      purpose: truncate(section.purpose, 600),
      requiredDiagrams: strings(section.requiredDiagrams).slice(0, 20),
    })),
    diagrams: records(source.diagrams).slice(0, 30).map((diagram) => ({
      id: truncate(diagram.id, 80),
      title: truncate(diagram.title, 180),
      type: truncate(diagram.type, 40),
      purpose: truncate(diagram.purpose, 500),
      approved: diagram.status === "approved" && Boolean(diagram.diagramData),
      status: truncate(diagram.status, 40),
      caption: truncate(diagram.caption, 300),
      dataSummary: diagram.diagramData ? summarizeDiagramData(diagram.diagramData) : null,
    })),
    tables: records(source.tables).slice(0, 30).map((table) => ({
      title: truncate(table.title, 180),
      purpose: truncate(table.purpose, 500),
      columns: strings(table.columns).slice(0, 12),
    })),
    references: records(source.references).slice(0, 60).map((reference) => ({
      query: truncate(reference.query, 400),
      purpose: truncate(reference.purpose, 500),
      citation: truncate(reference.citation, 600),
      url: truncate(reference.url, 1000),
      pdfUrl: truncate(reference.pdfUrl, 1000),
      abstract: truncate(reference.abstract, 1400),
    })),
  };
}

type CompactProject = ReturnType<typeof compactProject>;
type CompactTable = CompactProject["tables"][number];
type CompactDiagram = CompactProject["diagrams"][number];

function tableMarkdown(table: CompactTable) {
  const columns = Array.isArray(table.columns) && table.columns.length ? table.columns : ["Aspek", "Keterangan"];
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    `| ${columns.map((column: string) => `[ISI ${String(column).toUpperCase()}]`).join(" | ")} |`,
  ].join("\n");
}

function diagramCaption(diagram: CompactDiagram, index: number) {
  const status = diagram.approved ? "sudah disetujui dari UML Builder" : "perlu dibuat/approve";
  const elements = Array.isArray(diagram.dataSummary?.mainElements) && diagram.dataSummary.mainElements.length
    ? ` Elemen utama: ${diagram.dataSummary.mainElements.join("; ")}.`
    : "";

  return `${index + 1}. [Gambar: ${diagram.title || `Diagram ${index + 1}`} - ${status}]\n   Caption: ${diagram.caption || diagram.purpose || "Menjelaskan alur/struktur sistem."}${elements}`;
}

export function fallbackReport(project: unknown) {
  const compact = compactProject(project);
  const title = compact.title || compact.topic || "Laporan Proyek";
  const outline = compact.outline.length ? compact.outline : [
    { title: "Pendahuluan", purpose: "Menjelaskan latar belakang, tujuan, dan batasan laporan.", requiredDiagrams: [] },
    { title: "Pembahasan", purpose: "Menjelaskan hasil analisis dan implementasi berdasarkan konteks.", requiredDiagrams: [] },
    { title: "Penutup", purpose: "Memuat kesimpulan dan saran.", requiredDiagrams: [] },
  ];

  const sourceSummary = compact.sources.map((source, index) => (
    `- Sumber ${index + 1}: ${source.title} (${source.kind}) - ${String(source.content || "").slice(0, 180)}${String(source.content || "").length > 180 ? "..." : ""}`
  )).join("\n") || "- [ISI SUMBER UTAMA]";

  const diagramBlock = compact.diagrams.length
    ? compact.diagrams.map(diagramCaption).join("\n")
    : "[Gambar: Tambahkan diagram bila dibutuhkan]";

  const tableBlock = compact.tables.length
    ? compact.tables.map((table, index) => `### Tabel ${index + 1}. ${table.title}\n${table.purpose}\n\n${tableMarkdown(table)}`).join("\n\n")
    : "[Tabel belum direncanakan]";

  const references = compact.references.length
    ? compact.references.map((reference) => reference.citation || `[Cari jurnal: ${reference.query}]${reference.url ? ` - ${reference.url}` : ""}`).join("\n")
    : "[Tambahkan referensi/jurnal yang relevan]";

  return `# ${title}\n\n> Draft cepat dibuat otomatis karena respons AI utama terlalu lama. Draft ini sudah mengikuti konteks, outline, tabel, diagram, dan referensi yang tersimpan. Gunakan fitur revisi untuk memperpanjang BAB tertentu, menambah sitasi, atau merapikan format.\n\n## Ringkasan Konteks\n${sourceSummary}\n\n${outline.map((section, index) => `## ${section.title}\n\n${section.purpose}\n\n${index === 0 ? `Laporan ini membahas ${title} berdasarkan konteks proyek, pedoman, dan bahan yang telah dimasukkan. Bagian ini perlu memuat latar belakang, rumusan masalah, tujuan, manfaat, dan batasan pembahasan secara runtut.` : `Bagian ini perlu dikembangkan berdasarkan bahan mentah dan sumber yang tersedia. Hindari penambahan data spesifik yang belum ada; gunakan placeholder bila data belum lengkap.`}\n\n${section.requiredDiagrams.length ? section.requiredDiagrams.map((diagramId) => `[Gambar: ${diagramId} - masukkan dari UML Builder]`).join("\n") : ""}`).join("\n\n")}\n\n## Daftar Gambar dan Diagram\n${diagramBlock}\n\n## Rencana Tabel\n${tableBlock}\n\n## Daftar Pustaka Awal\n${references}\n`;
}

function normalizeReportOutput(content: string, project: unknown) {
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
      ? compact.references.map((reference) => reference.citation || `[Cari jurnal: ${reference.query || reference.purpose || "topik terkait"}]${reference.url ? ` - ${reference.url}` : ""}`).join("\n")
      : "[Tambahkan referensi/jurnal yang relevan]";
    output += `\n\n## Daftar Pustaka\n${references}`;
  }

  return output;
}

export async function generateReportDraft(project: unknown) {
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
  } catch (error: unknown) {
    if (isAbortLikeError(error)) {
      return { content: fallbackReport(project), source: "fallback-timeout" };
    }
    throw error;
  }
}
