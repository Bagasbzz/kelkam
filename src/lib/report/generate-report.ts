import { aiClient, AI_MODEL, AI_MODEL_FAST, assertAiConfigured } from "@/lib/ai/client";
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
      id: truncate(section.id, 80) || undefined,
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
  const systemPrompt = buildFullSystemPrompt(compact);

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

function buildFullSystemPrompt(compact: CompactProject) {
  return `Anda adalah penyusun laporan akademik keluhkampus untuk mahasiswa Indonesia.
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
}

// ===========================================================================
// PER-BAB GENERATION (dipakai report-jobs step runner)
// ===========================================================================

export type ReportMode = "ringkas" | "lengkap";

export interface ChapterInput {
  /** Index section (0-based) dan total section — untuk konteks posisi. */
  index: number;
  total: number;
  section: { id?: string; title: string; purpose: string; requiredDiagrams: string[] };
  /** Ringkasan singkat BAB-BAB sebelumnya (hasil `summarizeChapter`). */
  previousSummaries: string[];
  mode: ReportMode;
}

export interface ChapterOutput {
  content: string;
  summary: string;
  source: "ai" | "fallback";
  finishReason: string;
}

const CHAPTER_TIMEOUT_MS = Number(process.env.AI_CHAPTER_TIMEOUT_MS || 40000);

/** Hapus heading level-1 dan code fence yang kadang disisipkan model. */
function cleanChapterOutput(raw: string) {
  let output = String(raw || "").trim();
  output = output.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
  output = output.replace(/^(berikut|tentu|baik)[^\n]*\n+/i, "").trim();
  return output;
}

/** Ambil 2-3 kalimat pertama dari paragraf pertama sebagai ringkasan murah (tanpa AI). */
export function summarizeChapter(markdown: string, max = 420) {
  const body = markdown
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("|") && !line.trim().startsWith("["))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return body.slice(0, max);
}

/**
 * Pilih referensi yang relevan untuk satu section: cocokkan kata kunci judul/
 * purpose dengan query/purpose/abstract referensi. Fallback: 6 referensi pertama.
 */
function pickReferences(compact: CompactProject, section: ChapterInput["section"], limit: number) {
  const keywords = `${section.title} ${section.purpose}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  if (!keywords.length) return compact.references.slice(0, limit);

  const scored = compact.references.map((reference) => {
    const haystack = `${reference.query} ${reference.purpose} ${reference.abstract}`.toLowerCase();
    const score = keywords.reduce((acc, word) => acc + (haystack.includes(word) ? 1 : 0), 0);
    return { reference, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.reference);
}

/** Placeholder BAB kalau AI gagal/timeout — tetap valid markdown. */
export function fallbackChapter(input: ChapterInput): ChapterOutput {
  const { section } = input;
  const diagrams = section.requiredDiagrams.length
    ? `\n\n${section.requiredDiagrams.map((id) => `[Gambar: ${id} - masukkan dari UML Builder]`).join("\n")}`
    : "";
  const content = `## ${section.title}\n\n${section.purpose || "Bagian ini perlu dikembangkan berdasarkan bahan proyek."}\n\n[ISI ${section.title.toUpperCase()}: respons AI gagal, gunakan fitur revisi untuk mengisi bagian ini]${diagrams}`;
  return { content, summary: section.purpose || section.title, source: "fallback", finishReason: "fallback" };
}

/**
 * Generate satu BAB. 1 panggilan AI, model dipilih dari mode:
 *   - ringkas → AI_MODEL_FAST, target ±300-500 kata
 *   - lengkap → AI_MODEL, target ±700-1200 kata
 * Kalau finish_reason "length", lakukan 1x continuation.
 */
export async function generateChapter(project: unknown, input: ChapterInput): Promise<ChapterOutput> {
  assertAiConfigured();
  const compact = compactProject(project);
  const { section, mode, index, total } = input;
  const isRingkas = mode === "ringkas";

  const sectionDiagrams = compact.diagrams.filter((diagram) => section.requiredDiagrams.includes(diagram.id));
  const references = pickReferences(compact, section, isRingkas ? 5 : 10);
  const sources = compact.sources.slice(0, isRingkas ? 6 : 12).map((source) => ({
    ...source,
    content: source.content.slice(0, isRingkas ? 700 : 1400),
  }));

  const systemPrompt = `Anda adalah penulis laporan akademik keluhkampus untuk mahasiswa Indonesia.
Tugas: tulis SATU bagian laporan (BAB ${index + 1} dari ${total}) berjudul "${section.title}" dalam Bahasa Indonesia.

Aturan wajib:
1. Output hanya markdown bagian ini. Mulai dengan heading "## ${section.title}". Tanpa judul laporan, tanpa daftar pustaka, tanpa basa-basi, tanpa code fence.
2. Sub-bagian pakai heading "###". Jangan buat heading "#".
3. Gaya ${compact.formality || "formal akademik"}, ${isRingkas ? "padat dan langsung ke inti (sekitar 300-500 kata)" : "mendalam dan runtut (sekitar 700-1200 kata)"}. Hindari pengulangan isi BAB sebelumnya.
4. Jangan mengarang data, angka, nama institusi, nama jurnal, atau link. Pakai placeholder spesifik seperti [ISI DATA ...] bila belum ada.
5. Gunakan sumber/konteks yang relevan. Sitasi in-text pakai gaya ${compact.citationStyle || "APA"} hanya dari referensi yang diberikan; bila kurang, tulis [butuh referensi: topik].
6. Diagram yang diminta harus muncul sebagai placeholder [Gambar: Judul - status] dengan caption, dan dijelaskan naratif memakai elemen utama bila ada.
7. Bila ada tabel yang cocok untuk bagian ini, buat tabel markdown mengikuti rencana kolom.
8. Jangan menulis kalimat penutup umum seperti "demikian bab ini". Akhiri dengan transisi singkat ke bagian berikutnya bila relevan.`;

  const userPayload = {
    laporan: {
      judul: compact.title || compact.topic,
      topik: compact.topic,
      jenis: compact.projectType,
      mataKuliah: compact.course,
    },
    bagianIni: {
      judul: section.title,
      tujuan: section.purpose,
      diagramWajib: sectionDiagrams,
    },
    ringkasanBabSebelumnya: input.previousSummaries.slice(-4),
    sumber: sources,
    rencanaTabel: compact.tables.slice(0, 8),
    referensi: references,
  };

  const model = isRingkas ? AI_MODEL_FAST : AI_MODEL;
  const maxTokens = isRingkas ? 1600 : 3200;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload) },
  ];

  try {
    const response = await aiClient.chat.completions.create({
      model,
      messages,
      temperature: 0.15,
      max_tokens: maxTokens,
    }, { timeout: CHAPTER_TIMEOUT_MS });

    const choice = response.choices[0];
    let content = cleanChapterOutput(choice?.message.content || "");
    let finishReason = choice?.finish_reason || "unknown";

    // Satu kali continuation kalau terpotong.
    if (finishReason === "length" && content) {
      const cont = await aiClient.chat.completions.create({
        model,
        messages: [
          ...messages,
          { role: "assistant", content },
          { role: "user", content: "Lanjutkan tepat dari kalimat terakhir tanpa mengulang. Output hanya kelanjutan markdown." },
        ],
        temperature: 0.15,
        max_tokens: Math.round(maxTokens / 2),
      }, { timeout: CHAPTER_TIMEOUT_MS });
      const extra = cleanChapterOutput(cont.choices[0]?.message.content || "");
      if (extra) content = `${content}\n${extra}`;
      finishReason = cont.choices[0]?.finish_reason || finishReason;
    }

    if (content.length < 200) return fallbackChapter(input);
    if (!/^##\s+/m.test(content)) content = `## ${section.title}\n\n${content}`;

    return { content, summary: summarizeChapter(content), source: "ai", finishReason };
  } catch (error: unknown) {
    if (isAbortLikeError(error)) return fallbackChapter(input);
    throw error;
  }
}

/** Gabungkan judul + BAB + daftar pustaka menjadi satu markdown final. */
export function assembleReport(project: unknown, chapters: string[]) {
  const compact = compactProject(project);
  const title = compact.title || compact.topic || "Laporan Proyek";
  const references = compact.references.length
    ? compact.references.map((reference) => reference.citation || `[Cari jurnal: ${reference.query || reference.purpose || "topik terkait"}]${reference.url ? ` - ${reference.url}` : ""}`).join("\n")
    : "[Tambahkan referensi/jurnal yang relevan]";
  return `# ${title}\n\n${chapters.join("\n\n")}\n\n## Daftar Pustaka\n${references}\n`;
}
