import { aiClient, AI_MODEL, AI_MODEL_FAST, AI_MODEL_REVIEW, assertAiConfigured, stripThinking } from "@/lib/ai/client";
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
      sectionId: truncate(diagram.sectionId, 80) || undefined,
      approved: diagram.status === "approved" && Boolean(diagram.diagramData),
      status: truncate(diagram.status, 40),
      caption: truncate(diagram.caption, 300),
      dataSummary: diagram.diagramData ? summarizeDiagramData(diagram.diagramData) : null,
      /** Ringkasan alur hasil engine UML (untuk narasi), diisi job setelah diagram jadi. */
      flowSummary: truncate(diagram.flowSummary, 900) || undefined,
    })),
    /** Gambar ilustrasi (non-UML) yang sudah jadi dari image job — judul harus dipakai persis di placeholder. */
    figures: records(source.figures).slice(0, 20).map((figure) => ({
      title: truncate(figure.title, 180),
      caption: truncate(figure.caption, 300),
      sectionId: truncate(figure.sectionId, 80) || undefined,
    })).filter((figure) => figure.title),
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

    return { content: normalizeReportOutput(stripThinking(response.choices[0].message.content), project), source: "ai" };
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
  /** Callback event detail untuk log job (opsional). */
  onEvent?: (message: string) => void;
  /** Teks parsial dari percobaan sebelumnya yang timeout — dilanjutkan, bukan ditulis ulang. */
  partial?: string;
  /** Dipanggil tiap ada potongan teks baru (untuk simpan parsial + heartbeat). */
  onPartial?: (text: string) => void;
}

export interface ChapterOutput {
  content: string;
  summary: string;
  source: "ai" | "fallback";
  finishReason: string;
  tokensUsed?: number;
  model?: string;
}

/** Error timeout yang membawa teks parsial supaya step bisa menyimpannya. */
export class ChapterTimeoutError extends Error {
  constructor(message: string, public readonly partial: string) {
    super(message);
    this.name = "ChapterTimeoutError";
  }
}

/**
 * Batas waktu per bab. Step dijalankan di background proses (bukan di dalam
 * request HTTP), jadi tidak terikat ~120 s proxy. Streaming dipakai supaya
 * teks parsial tersimpan saat timeout dan heartbeat hidup per potongan.
 */
const CHAPTER_TIMEOUT_MS = Number(process.env.AI_CHAPTER_TIMEOUT_MS || 200_000);
const CONTINUATION_TIMEOUT_MS = Number(process.env.AI_CONTINUATION_TIMEOUT_MS || 90_000);
/** Total budget satu step bab (panggilan utama + lanjutan). */
export const CHAPTER_STEP_BUDGET_MS = Number(process.env.AI_CHAPTER_BUDGET_MS || 300_000);
const AUDIT_TIMEOUT_MS = Number(process.env.AI_AUDIT_TIMEOUT_MS || 150_000);
const MAX_CONTINUATIONS = 3;

/** Hapus heading level-1 dan code fence yang kadang disisipkan model. */
function cleanChapterOutput(raw: string) {
  let output = String(raw || "").trim();
  output = output.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
  output = output.replace(/^(berikut|tentu|baik)[^\n]*\n+/i, "").trim();
  return output;
}

/**
 * Deteksi bab yang berhenti di tengah: kalimat tanpa tanda akhir, tabel yang
 * barisnya belum lengkap, atau heading tanpa isi di ujung.
 */
export function looksTruncated(markdown: string) {
  const trimmed = markdown.trimEnd();
  if (!trimmed) return true;
  const lines = trimmed.split("\n");
  const last = lines[lines.length - 1].trim();
  if (/^#{1,4}\s/.test(last)) return true;
  if (last.startsWith("|")) {
    // Tabel: baris terakhir harus punya jumlah sel sama dengan header.
    const tableLines = [] as string[];
    for (let i = lines.length - 1; i >= 0 && lines[i].trim().startsWith("|"); i -= 1) tableLines.unshift(lines[i].trim());
    const cells = (line: string) => line.split("|").length;
    return tableLines.length < 3 || cells(tableLines[0]) !== cells(last) || !last.endsWith("|");
  }
  return !/[.!?:\])"”*_]$/.test(last);
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Panggil model dengan stream; teks terkumpul dikirim ke onDelta. Saat timeout
 * lempar ChapterTimeoutError berisi teks parsial.
 */
async function streamChapter(
  params: { model: string; messages: ChatMessage[]; maxTokens: number; temperature: number },
  timeoutMs: number,
  onDelta: (fullText: string) => void,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = "";
  const run = async (withReasoning: boolean) => {
    const stream = await aiClient.chat.completions.create(
      {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        // Penulisan naratif tidak butuh reasoning panjang; hemat token & waktu.
        ...(withReasoning ? { reasoning_effort: "low" as const } : {}),
      },
      { signal: controller.signal, maxRetries: 0 },
    );
    let finishReason = "unknown";
    let usage = 0;
    let lastEmit = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        const now = Date.now();
        if (now - lastEmit > 1500) { lastEmit = now; onDelta(text); }
      }
      const reason = chunk.choices?.[0]?.finish_reason;
      if (reason) finishReason = reason;
      if (chunk.usage?.total_tokens) usage = chunk.usage.total_tokens;
    }
    onDelta(text);
    return { text, finishReason, usage };
  };
  try {
    try {
      return await run(true);
    } catch (error) {
      // Provider tidak kenal reasoning_effort → ulang polos (hanya kalau belum ada teks).
      const status = (error as { status?: unknown })?.status;
      if (status === 400 && !text && !controller.signal.aborted) return await run(false);
      throw error;
    }
  } catch (error) {
    if (controller.signal.aborted || isAbortLikeError(error)) {
      throw new ChapterTimeoutError(`Timeout ${Math.round(timeoutMs / 1000)}s`, text);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

/** Cocokkan id/judul diagram dari `requiredDiagrams` (string bebas dari rencana) ke daftar diagram proyek. */
function resolveDiagram(compact: CompactProject, ref: string) {
  const key = ref.trim().toLowerCase();
  if (!key) return undefined;
  return compact.diagrams.find((diagram) => diagram.id.toLowerCase() === key)
    ?? compact.diagrams.find((diagram) => diagram.title.toLowerCase() === key)
    ?? compact.diagrams.find((diagram) => diagram.title.toLowerCase().includes(key) || key.includes(diagram.title.toLowerCase()));
}

/** Diagram yang harus muncul di section: dari requiredDiagrams ATAU diagram.sectionId. */
export function diagramsForSection(compact: CompactProject, section: ChapterInput["section"]) {
  const picked = new Map<string, CompactDiagram>();
  for (const ref of section.requiredDiagrams) {
    const diagram = resolveDiagram(compact, ref);
    if (diagram) picked.set(diagram.id || diagram.title, diagram);
  }
  for (const diagram of compact.diagrams) {
    if (section.id && diagram.sectionId && diagram.sectionId === section.id) picked.set(diagram.id || diagram.title, diagram);
  }
  return Array.from(picked.values());
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
export function fallbackChapter(input: ChapterInput, project?: unknown): ChapterOutput {
  const { section } = input;
  const compact = project ? compactProject(project) : null;
  const diagrams = section.requiredDiagrams.length
    ? `\n\n${section.requiredDiagrams.map((id) => {
      const diagram = compact ? resolveDiagram(compact, id) : undefined;
      return `[Gambar: ${diagram?.title || id} - ${diagram?.caption || diagram?.purpose || "masukkan dari UML Builder"}]`;
    }).join("\n")}`
    : "";
  const content = `## ${section.title}\n\n${section.purpose || "Bagian ini perlu dikembangkan berdasarkan bahan proyek."}\n\n[ISI ${section.title.toUpperCase()}: respons AI gagal, gunakan fitur revisi untuk mengisi bagian ini]${diagrams}`;
  return { content, summary: section.purpose || section.title, source: "fallback", finishReason: "fallback" };
}

// ---------------------------------------------------------------------------
// Pemilihan bahan per BAB (chunk relevan, bukan potongan awal saja)
// ---------------------------------------------------------------------------

const CHUNK_CHARS = 650;

function keywordsOf(text: string) {
  return Array.from(new Set(
    text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3),
  ));
}

/** Pecah teks per paragraf lalu gabung sampai ±CHUNK_CHARS. */
function chunkText(text: string) {
  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";
  for (const paragraph of paragraphs) {
    if ((buffer + " " + paragraph).length > CHUNK_CHARS && buffer) {
      chunks.push(buffer);
      buffer = paragraph;
    } else {
      buffer = buffer ? `${buffer} ${paragraph}` : paragraph;
    }
    // Paragraf tunggal yang sangat panjang dipotong keras.
    while (buffer.length > CHUNK_CHARS * 2) {
      chunks.push(buffer.slice(0, CHUNK_CHARS));
      buffer = buffer.slice(CHUNK_CHARS);
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

/**
 * Pilih potongan sumber yang paling relevan untuk section ini dalam budget
 * karakter. Setiap sumber selalu menyumbang ringkasan awal (head) supaya
 * konteks umum tidak hilang, sisanya diisi chunk dengan skor tertinggi.
 */
function selectSourceMaterial(project: unknown, section: ChapterInput["section"], budgetChars: number) {
  const raw = isRecord(project) ? records(project.sources).slice(0, 30) : [];
  const keywords = keywordsOf(`${section.title} ${section.purpose}`);

  const heads = raw.map((source) => ({
    kind: truncate(source.kind, 40) || "note",
    title: truncate(source.title, 180),
    content: truncate(source.content, 320),
  }));
  let used = heads.reduce((acc, head) => acc + head.content.length, 0);

  const scored: Array<{ sourceIndex: number; chunk: string; score: number }> = [];
  raw.forEach((source, sourceIndex) => {
    const text = String(source.content || "");
    if (text.length <= 320) return; // head sudah cukup
    for (const chunk of chunkText(text)) {
      const haystack = chunk.toLowerCase();
      const score = keywords.reduce((acc, word) => acc + (haystack.includes(word) ? 1 : 0), 0);
      if (score > 0) scored.push({ sourceIndex, chunk, score });
    }
  });
  scored.sort((a, b) => b.score - a.score);

  const extras = new Map<number, string[]>();
  for (const item of scored) {
    if (used + item.chunk.length > budgetChars) break;
    const list = extras.get(item.sourceIndex) || [];
    if (list.length >= 4) continue; // maks 4 chunk per sumber supaya merata
    list.push(item.chunk);
    extras.set(item.sourceIndex, list);
    used += item.chunk.length;
  }

  return heads.map((head, index) => ({
    ...head,
    kutipanRelevan: extras.get(index) || [],
  }));
}

/**
 * Generate satu BAB. 1 panggilan AI (+ maks 2 lanjutan bila terpotong), model dari mode:
 *   - ringkas → AI_MODEL_FAST, target ±400-600 kata
 *   - lengkap → AI_MODEL, target ±1500-2500 kata, ≥N sitasi berbeda
 */
export async function generateChapter(project: unknown, input: ChapterInput): Promise<ChapterOutput> {
  assertAiConfigured();
  const compact = compactProject(project);
  const { section, mode, index, total } = input;
  const isRingkas = mode === "ringkas";

  const sectionDiagrams = diagramsForSection(compact, section);
  const sectionFigures = compact.figures.filter((figure) => !figure.sectionId || !section.id || figure.sectionId === section.id);
  const references = pickReferences(compact, section, isRingkas ? 6 : 16);
  const minCitations = isRingkas ? Math.min(3, references.length) : Math.min(8, references.length);
  // Bahan: head tiap sumber + chunk paling relevan untuk BAB ini (budget char).
  const sources = selectSourceMaterial(project, section, isRingkas ? 6_000 : 16_000);

  const diagramPlaceholders = sectionDiagrams.map((diagram) => `[Gambar: ${diagram.title} - ${diagram.caption || diagram.purpose || diagram.title}]`);
  const figurePlaceholders = sectionFigures.map((figure) => `[Gambar: ${figure.title} - ${figure.caption || figure.title}]`);
  const mandatoryPlaceholders = [...diagramPlaceholders, ...figurePlaceholders];

  const systemPrompt = `Anda adalah penulis laporan akademik senior keluhkampus untuk mahasiswa Indonesia. Kualitas harus setara skripsi yang dibimbing dosen: argumentatif, mendalam, dan setiap klaim penting didukung sitasi.
Tugas: tulis SATU bagian laporan (BAB ${index + 1} dari ${total}) berjudul "${section.title}" dalam Bahasa Indonesia.

ATURAN STRUKTUR:
1. Output hanya markdown bagian ini. Mulai dengan heading "## ${section.title}". Tanpa judul laporan, tanpa daftar pustaka, tanpa basa-basi, tanpa code fence.
2. Sub-bagian pakai heading "### " dengan penomoran "${index + 1}.1", "${index + 1}.2", dst. (contoh "### ${index + 1}.1 Latar Belakang"). Sub-sub pakai "#### ${index + 1}.1.1". Jangan buat heading "#". Jangan tinggalkan heading tanpa isi: setiap sub-bagian minimal 2 paragraf utuh.
3. Gaya ${compact.formality || "formal akademik"}, ${isRingkas ? "padat (sekitar 400-600 kata)" : "mendalam dan runtut (TARGET 1500-2500 kata; tiap paragraf 4-7 kalimat; jelaskan definisi, mekanisme, perbandingan pendekatan, implikasi untuk proyek ini, dan kaitan dengan bab lain)"}. Jangan mengulang isi BAB sebelumnya; rujuk saja ("sebagaimana dibahas pada BAB ...").
4. Jangan mengarang data, angka, nama institusi, nama jurnal, atau link. Pakai placeholder spesifik seperti [ISI DATA ...] bila belum ada.

ATURAN SITASI (wajib):
5. Gunakan referensi yang diberikan secara nyata: minimal ${minCitations} referensi BERBEDA disitasi in-text gaya ${compact.citationStyle || "APA"} (Nama, Tahun). Sintesis antar-sumber (bandingkan/kontraskan temuan), bukan sekadar menyebut. Hanya sitasi referensi yang ada di daftar "referensi"; bila topik tak tercakup, tulis [butuh referensi: topik]. Gunakan abstrak referensi untuk mengisi substansi.

ATURAN GAMBAR/TABEL:
6. ${mandatoryPlaceholders.length ? `Placeholder gambar berikut WAJIB muncul PERSIS (tulis apa adanya, masing-masing di baris sendiri, di posisi yang paling relevan), lalu jelaskan isinya secara naratif minimal 1 paragraf memakai ringkasan alurnya:\n${mandatoryPlaceholders.map((item) => `   ${item}`).join("\n")}` : "Jangan membuat placeholder gambar baru."} Format umum placeholder gambar: [Gambar: Judul - caption].
7. Bila ada tabel yang cocok untuk bagian ini, buat tabel markdown mengikuti rencana kolom, didahului baris "**Tabel: Judul Tabel**" dan diikuti paragraf penjelasan.

ATURAN TIPOGRAFI:
8. Istilah asing/bahasa Inggris dan nama latin ditulis miring dengan *...* (contoh: *framework*, *machine learning*, *end-to-end*). Singkatan diperkenalkan sekali dengan kepanjangannya.
9. Jangan menulis kalimat penutup umum seperti "demikian bab ini". Akhiri dengan transisi singkat ke bagian berikutnya bila relevan. Pastikan kalimat terakhir utuh.`;

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
      diagramWajib: sectionDiagrams.map((diagram) => ({
        placeholder: `[Gambar: ${diagram.title} - ${diagram.caption || diagram.purpose || diagram.title}]`,
        jenis: diagram.type,
        tujuan: diagram.purpose,
        ringkasanAlur: diagram.flowSummary || diagram.dataSummary || null,
      })),
      gambarIlustrasi: sectionFigures.map((figure) => ({ placeholder: `[Gambar: ${figure.title} - ${figure.caption || figure.title}]` })),
    },
    ringkasanBabSebelumnya: input.previousSummaries.slice(-4),
    sumber: sources,
    rencanaTabel: compact.tables.slice(0, 8),
    referensi: references,
  };

  const model = isRingkas ? AI_MODEL_FAST : AI_MODEL;
  const maxTokens = isRingkas ? 1800 : 5200;
  const emit = input.onEvent ?? (() => {});
  const onPartial = input.onPartial ?? (() => {});

  const chunkCount = sources.reduce((acc, source) => acc + source.kutipanRelevan.length, 0);
  emit(`Menyiapkan bahan: ${sources.length} sumber, ${chunkCount} kutipan relevan, ${references.length} referensi, ${sectionDiagrams.length} diagram, ${sectionFigures.length} gambar`);

  const baseMessages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(userPayload) },
  ];
  const continuationMessages = (soFar: string): ChatMessage[] => [
    ...baseMessages,
    { role: "assistant", content: soFar },
    { role: "user", content: "Lanjutkan TEPAT dari titik terakhir tanpa mengulang kalimat/heading yang sudah ada. Output hanya kelanjutan markdown. Selesaikan semua sub-bagian yang direncanakan dan akhiri dengan kalimat utuh." },
  ];

  const startedAt = Date.now();
  const remaining = () => CHAPTER_STEP_BUDGET_MS - (Date.now() - startedAt);
  let content = cleanChapterOutput(input.partial || "");
  let finishReason = "unknown";
  let tokensUsed = 0;
  let continuations = 0;
  const reportDelta = (prefix: string) => (text: string) => onPartial(prefix ? `${prefix}\n${text}` : text);

  try {
    if (content) {
      emit(`Melanjutkan dari teks sebelumnya (${countWordsLocal(content)} kata)…`);
    } else {
      emit("Menulis isi bab…");
      const first = await streamChapter({ model, messages: baseMessages, maxTokens, temperature: 0.15 }, Math.min(CHAPTER_TIMEOUT_MS, remaining()), reportDelta(""));
      content = cleanChapterOutput(stripThinking(first.text));
      finishReason = first.finishReason;
      tokensUsed += first.usage;
      emit(`Draf bab selesai: ${countWordsLocal(content)} kata`);
    }

    // Lanjutan selama terpotong (finish=length ATAU teks terlihat putus) dan budget tersisa.
    while (
      content
      && continuations < MAX_CONTINUATIONS
      && (finishReason === "length" || looksTruncated(content) || (input.partial && continuations === 0))
      && remaining() > 20_000
    ) {
      continuations += 1;
      emit(`Melanjutkan penulisan bagian yang belum selesai (${continuations})…`);
      const cont = await streamChapter(
        { model, messages: continuationMessages(content), maxTokens: Math.round(maxTokens / 2), temperature: 0.15 },
        Math.min(CONTINUATION_TIMEOUT_MS, remaining()),
        reportDelta(content),
      );
      const extra = cleanChapterOutput(stripThinking(cont.text));
      if (!extra) break;
      content = `${content.trimEnd()}\n${extra}`;
      finishReason = cont.finishReason;
      tokensUsed += cont.usage;
    }
  } catch (error: unknown) {
    if (error instanceof ChapterTimeoutError) {
      const merged = cleanChapterOutput(content ? `${content.trimEnd()}\n${stripThinking(error.partial)}` : stripThinking(error.partial));
      emit(`Penulisan bab melebihi batas waktu (${countWordsLocal(merged)} kata tersimpan), akan dilanjutkan`);
      throw new ChapterTimeoutError(`Timeout saat menulis "${section.title}"`, merged);
    }
    if (isAbortLikeError(error)) {
      emit("Penulisan bab melebihi batas waktu, akan dilanjutkan");
      throw new ChapterTimeoutError(`Timeout saat menulis "${section.title}"`, content);
    }
    throw error;
  }

  if (content.length < 200) {
    emit("Isi bab terlalu pendek, memakai kerangka sementara");
    return { ...fallbackChapter(input, project), tokensUsed, model };
  }
  if (!/^##\s+/m.test(content)) content = `## ${section.title}\n\n${content}`;

  // Jaminan: placeholder gambar wajib selalu ada (model kadang lupa). Ditempel
  // di akhir bab agar exporter tetap menyisipkan gambarnya.
  const missing = mandatoryPlaceholders.filter((placeholder) => {
    const title = placeholder.slice("[Gambar: ".length).split(" - ")[0].trim().toLowerCase();
    return !content.toLowerCase().includes(`[gambar: ${title}`);
  });
  if (missing.length) {
    emit(`Menambahkan ${missing.length} penanda gambar yang belum ada`);
    content = `${content.trimEnd()}\n\n${missing.join("\n\n")}\n`;
  }
  const citationCount = countDistinctCitations(content);
  emit(`Sitasi terdeteksi: ${citationCount}${citationCount < minCitations ? ` (target ${minCitations}, akan dilengkapi saat audit)` : ""}`);
  if (looksTruncated(content)) emit("Catatan: akhir bab masih terlihat terpotong, akan dirapikan saat audit");

  return { content, summary: summarizeChapter(content), source: "ai", finishReason, tokensUsed, model };
}

function countWordsLocal(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Jumlah sitasi in-text unik (Nama, Tahun) di sebuah markdown. */
export function countDistinctCitations(markdown: string) {
  const pattern = /\(([A-Z][A-Za-z'’-]+)(?:\s*(?:&|dan|and)\s*[A-Z][A-Za-z'’-]+|\s+et al\.?)?,?\s*(\d{4}[a-z]?)\)/g;
  const keys = new Set<string>();
  for (const match of markdown.matchAll(pattern)) keys.add(`${match[1].toLowerCase()}|${match[2]}`);
  return keys.size;
}

// ---------------------------------------------------------------------------
// AUDIT (pass kedua): model review memeriksa & memperbaiki satu BAB.
// ---------------------------------------------------------------------------

export interface AuditChapterResult {
  content: string;
  changed: boolean;
  tokensUsed: number;
  model: string;
  issues: string[];
}

/** Cek heuristik lokal (0 token) — dipakai untuk log dan memutuskan perlu audit AI. */
export function detectChapterIssues(markdown: string, minCitations: number) {
  const issues: string[] = [];
  const lines = markdown.split("\n");
  // Heading tanpa isi: heading diikuti heading/akhir.
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^#{2,4}\s+/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j += 1;
    if (j >= lines.length || /^#{1,4}\s+/.test(lines[j])) issues.push(`heading kosong: "${lines[i].replace(/^#+\s*/, "").slice(0, 60)}"`);
  }
  const trimmed = markdown.trimEnd();
  if (trimmed && !/[.!?:\]|)"”*]$/.test(trimmed)) issues.push("kalimat terakhir terpotong");
  if (/\[ISI [^\]]*respons AI gagal/i.test(markdown)) issues.push("berisi placeholder fallback");
  const citations = countDistinctCitations(markdown);
  if (citations < minCitations) issues.push(`sitasi ${citations} < ${minCitations}`);
  if (/^#\s+/m.test(markdown)) issues.push("ada heading level-1");
  return issues;
}

/**
 * Audit + perbaiki satu BAB dengan model review. Mengembalikan konten hasil
 * perbaikan (atau asli bila model gagal/timeout). Dipanggil per step job.
 */
export async function auditChapter(project: unknown, input: {
  content: string;
  sectionTitle: string;
  index: number;
  total: number;
  mode: ReportMode;
  onEvent?: (message: string) => void;
}): Promise<AuditChapterResult> {
  assertAiConfigured();
  const compact = compactProject(project);
  const emit = input.onEvent ?? (() => {});
  const isRingkas = input.mode === "ringkas";
  const minCitations = isRingkas ? 2 : Math.min(6, compact.references.length);
  const issues = detectChapterIssues(input.content, minCitations);
  const model = AI_MODEL_REVIEW;
  const placeholders = input.content.match(/\[Gambar:[^\]]+\]/g) || [];

  emit(`Mengaudit bab "${input.sectionTitle}"${issues.length ? `: ${issues.join("; ")}` : ""}`);

  const systemPrompt = `Anda adalah editor/pembimbing laporan akademik Indonesia. Tugas: AUDIT dan PERBAIKI satu bab laporan di bawah ini, lalu keluarkan VERSI FINAL bab tersebut (markdown utuh, bukan daftar perubahan).

Periksa dan perbaiki:
1. Struktur: heading "## ${input.sectionTitle}" tetap di awal; sub-bagian "### ${input.index + 1}.N Judul" bernomor berurutan; tidak ada heading kosong; tidak ada paragraf/kalimat terputus; tidak ada heading "#".
2. Kedalaman: paragraf yang dangkal (<3 kalimat) diperkaya dengan penjelasan mekanisme, contoh penerapan pada proyek ini, atau sintesis antar-referensi. Jangan memangkas isi yang sudah baik. ${isRingkas ? "" : "Panjang akhir minimal sama dengan versi awal."}
3. Sitasi: gaya ${compact.citationStyle || "APA"} konsisten (Nama, Tahun). Hanya referensi dalam daftar "referensi" yang boleh disitasi — ganti sitasi yang tidak ada di daftar dengan referensi yang sesuai atau [butuh referensi: topik]. Target minimal ${minCitations} referensi berbeda.
4. Tipografi: istilah asing/bahasa Inggris & nama latin ditulis *miring*; tabel markdown valid dengan baris "**Tabel: Judul**" di atasnya; angka & singkatan konsisten.
5. Placeholder gambar berikut HARUS tetap ada PERSIS tanpa diubah: ${placeholders.length ? placeholders.join(" | ") : "(tidak ada)"}.
6. Hapus kalimat meta ("berikut adalah", "demikian bab ini"), pengulangan, dan klaim tanpa dasar (ganti dengan placeholder [ISI DATA ...] bila perlu).
Output: hanya markdown bab final, tanpa komentar, tanpa code fence.`;

  const userPayload = {
    laporan: { judul: compact.title || compact.topic, topik: compact.topic, jenis: compact.projectType },
    posisi: `BAB ${input.index + 1} dari ${input.total}`,
    masalahTerdeteksi: issues,
    referensi: compact.references.slice(0, 40).map((reference) => ({ citation: reference.citation, abstract: reference.abstract.slice(0, 500) })),
    bab: input.content,
  };

  try {
    const request = {
      model,
      messages: [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: JSON.stringify(userPayload) },
      ],
      temperature: 0.1,
      max_tokens: 6000,
    };
    let response;
    try {
      response = await aiClient.chat.completions.create({ ...request, reasoning_effort: "low" }, { timeout: AUDIT_TIMEOUT_MS, maxRetries: 0 });
    } catch (error) {
      if ((error as { status?: unknown })?.status !== 400) throw error;
      response = await aiClient.chat.completions.create(request, { timeout: AUDIT_TIMEOUT_MS, maxRetries: 0 });
    }
    const choice = response.choices[0];
    let content = cleanChapterOutput(stripThinking(choice?.message.content));
    const tokensUsed = response.usage?.total_tokens ?? 0;
    const originalWords = input.content.split(/\s+/).length;
    const words = content.split(/\s+/).length;
    emit(`Audit selesai: ${originalWords} → ${words} kata`);

    // Guard: hasil audit terpotong/menyusut drastis/kehilangan placeholder → pakai asli.
    const lostPlaceholder = placeholders.some((placeholder) => !content.includes(placeholder));
    const shrunk = words < originalWords * 0.7;
    if (!content || choice?.finish_reason === "length" || lostPlaceholder || shrunk) {
      emit("Hasil audit kurang baik, versi awal dipertahankan");
      return { content: input.content, changed: false, tokensUsed, model, issues };
    }
    if (!/^##\s+/m.test(content)) content = `## ${input.sectionTitle}\n\n${content}`;
    return { content, changed: content !== input.content, tokensUsed, model, issues };
  } catch {
    emit("Audit tidak selesai, versi awal dipertahankan");
    return { content: input.content, changed: false, tokensUsed: 0, model, issues };
  }
}

/** Nama belakang pertama + tahun dari string sitasi APA ("Surname, A. (2021). ...") → untuk pencocokan. */
function citationKey(citation: string) {
  const surname = (citation.match(/^([A-Za-zÀ-ÿ'’-]+)/) || [])[1] || "";
  const year = (citation.match(/\((\d{4})[a-z]?\)/) || citation.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  return { surname: surname.toLowerCase(), year: year.replace(/[()]/g, "").slice(0, 4) };
}

/**
 * Gabungkan judul + BAB + daftar pustaka menjadi satu markdown final.
 * Daftar pustaka = referensi yang BENAR-BENAR disitasi (urut abjad); referensi
 * tak terpakai dicatat agar user tahu (bukan dibuang diam-diam).
 */
export function assembleReport(project: unknown, chapters: string[]) {
  const compact = compactProject(project);
  const title = compact.title || compact.topic || "Laporan Proyek";
  const body = `# ${title}\n\n${chapters.join("\n\n")}`;
  const lower = body.toLowerCase();

  const cited: string[] = [];
  const uncited: string[] = [];
  for (const reference of compact.references) {
    const entry = reference.citation || `[Cari jurnal: ${reference.query || reference.purpose || "topik terkait"}]${reference.url ? ` - ${reference.url}` : ""}`;
    const { surname, year } = citationKey(reference.citation);
    const used = surname.length > 2 && year && lower.includes(surname) && lower.includes(year);
    (used ? cited : uncited).push(entry);
  }
  const collator = new Intl.Collator("id");
  cited.sort(collator.compare);
  const bibliography = cited.length
    ? cited.join("\n\n")
    : compact.references.length
      ? [...cited, ...uncited].sort(collator.compare).join("\n\n")
      : "[Tambahkan referensi/jurnal yang relevan]";

  let output = `${body}\n\n## Daftar Pustaka\n\n${bibliography}\n`;
  const audit = auditCitations(body, compact);
  const notes = [...audit.notes];
  if (cited.length && uncited.length) {
    notes.push(`> **Catatan referensi tak terpakai:** ${uncited.length} referensi terverifikasi belum disitasi sehingga tidak dimasukkan ke Daftar Pustaka — ${uncited.slice(0, 4).map((item) => item.slice(0, 60)).join("; ")}${uncited.length > 4 ? "; ..." : ""}. Gunakan revisi "Tambah sitasi" bila ingin memakainya.`);
  }
  if (notes.length) output += `\n${notes.join("\n")}\n`;
  return output;
}

/**
 * Audit sitasi lokal (0 token): sitasi in-text (Nama, Tahun) yang tidak cocok
 * dengan entri daftar pustaka → ditandai sebagai catatan di akhir laporan.
 */
export function auditCitations(markdown: string, compact: CompactProject) {
  const bibliography = compact.references.map((reference) => reference.citation.toLowerCase()).join("\n");
  const inText = new Set<string>();
  // Pola umum: (Surname, 2021), (Surname & Other, 2021), (Surname et al., 2021)
  const pattern = /\(([A-Z][A-Za-z'’-]+)(?:\s*(?:&|dan|and)\s*[A-Z][A-Za-z'’-]+|\s+et al\.?)?,?\s*(\d{4}[a-z]?)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    inText.add(`${match[1]}|${match[2]}`);
  }

  const unmatched: string[] = [];
  for (const key of inText) {
    const [surname, year] = key.split("|");
    const found = bibliography.includes(surname.toLowerCase()) && bibliography.includes(year.slice(0, 4));
    if (!found) unmatched.push(`${surname}, ${year}`);
  }

  const placeholders = (markdown.match(/\[butuh referensi:[^\]]*\]/gi) || []).length;
  const notes: string[] = [];
  if (unmatched.length) {
    notes.push(`> **Catatan sitasi:** ${unmatched.length} sitasi belum ada di Daftar Pustaka — ${unmatched.slice(0, 8).join("; ")}${unmatched.length > 8 ? "; ..." : ""}. Tambahkan referensinya atau hapus sitasi.`);
  }
  if (placeholders) {
    notes.push(`> **Catatan referensi:** ${placeholders} bagian masih bertanda [butuh referensi]. Cari jurnal di Research lalu jalankan revisi "Tambah sitasi".`);
  }
  return { unmatched, placeholders, notes };
}
