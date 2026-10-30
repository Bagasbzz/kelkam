/**
 * src/utils/markdown-docx-exporter.ts
 * -----------------------------------------------------------------------------
 * Export markdown laporan → DOCX dengan format laporan akademik Indonesia.
 *
 * Fitur:
 *   - Profil format: kertas (A4/F4/Letter), margin, font, ukuran, spasi,
 *     sampul (judul, jenis, nama, NIM, dosen, prodi, institusi, tahun).
 *     `parseFormatRules()` membaca ketentuan kampus dari teks bebas user.
 *   - Struktur: tiap BAB di section baru (halaman baru), judul "BAB I" +
 *     nama bab di tengah. Draft yang memakai `#` judul + `##` bab dikenali
 *     otomatis (level heading digeser).
 *   - Bagian depan (Kata Pengantar, Abstrak, Daftar Isi/Gambar/Tabel) bernomor
 *     romawi; isi bernomor arab. Gaya "academic": halaman pertama bab di
 *     bawah-tengah, halaman lain kanan-atas.
 *   - Caption "Gambar 2.1 Judul" (di bawah gambar) dan "Tabel 2.1 Judul"
 *     (di atas tabel), nomor reset per bab.
 *   - Daftar pustaka spasi 1, hanging indent 1,27 cm, antar-entri 1 baris.
 *   - List bernomor mulai ulang tiap list, code block, link markdown.
 *   - Inline **bold** / *italic* / `code`, istilah asing otomatis italic.
 * -----------------------------------------------------------------------------
 */

import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LeaderType,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageReference,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
  type ISectionOptions,
} from "docx";
import { normalizeFigureKey, parseFigurePlaceholder } from "@/lib/report/figure-placeholders";

// ---------------------------------------------------------------------------
// Profil format
// ---------------------------------------------------------------------------

export type PaperSize = "A4" | "F4" | "Letter";
/**
 * academic      : halaman pertama tiap bab nomor di bawah-tengah, halaman lain kanan-atas
 * bottom-center : semua halaman bawah-tengah
 * bottom-right  : semua halaman bawah-kanan
 */
export type PageNumberStyle = "academic" | "bottom-center" | "bottom-right";

export interface DocxCover {
  title: string;
  /** Jenis dokumen, mis. "Laporan Praktikum Basis Data". */
  subtitle?: string;
  author?: string;
  studentId?: string;
  lecturer?: string;
  program?: string;
  faculty?: string;
  institution?: string;
  year?: string;
}

export interface DocxFormatProfile {
  /** cm */
  margin: { top: number; right: number; bottom: number; left: number };
  font: string;
  /** pt */
  fontSize: number;
  /** 1, 1.15, 1.5, 2 */
  lineSpacing: number;
  includeToc: boolean;
  includePageNumbers: boolean;
  paperSize?: PaperSize;
  pageNumberStyle?: PageNumberStyle;
  cover?: DocxCover | null;
}

export const DOCX_PRESETS: Record<string, { label: string; profile: Omit<DocxFormatProfile, "cover"> }> = {
  kampus4433: {
    label: "Kampus umum (A4, 4-4-3-3 cm, TNR 12, spasi 1.5)",
    profile: { paperSize: "A4", margin: { top: 4, left: 4, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 1.5, includeToc: true, includePageNumbers: true, pageNumberStyle: "academic" },
  },
  kampus3333: {
    label: "Standar (A4, 3-3-3-3 cm, TNR 12, spasi 1.5)",
    profile: { paperSize: "A4", margin: { top: 3, left: 3, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 1.5, includeToc: true, includePageNumbers: true, pageNumberStyle: "academic" },
  },
  skripsi: {
    label: "Skripsi (A4, 4-4-3-3 cm, TNR 12, spasi 2)",
    profile: { paperSize: "A4", margin: { top: 4, left: 4, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 2, includeToc: true, includePageNumbers: true, pageNumberStyle: "academic" },
  },
  ringkas: {
    label: "Ringkas (A4, 2.5 cm, Arial 11, spasi 1.15, tanpa daftar isi)",
    profile: { paperSize: "A4", margin: { top: 2.5, left: 2.5, bottom: 2.5, right: 2.5 }, font: "Arial", fontSize: 11, lineSpacing: 1.15, includeToc: false, includePageNumbers: true, pageNumberStyle: "bottom-center" },
  },
};

export const DEFAULT_DOCX_PROFILE: DocxFormatProfile = { ...DOCX_PRESETS.kampus4433.profile, cover: null };

/** Ukuran kertas (mm). F4/Folio Indonesia = 215 x 330 mm. */
const PAPER_MM: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  F4: { width: 215, height: 330 },
  Letter: { width: 215.9, height: 279.4 },
};

const KNOWN_FONTS = ["Times New Roman", "Arial", "Calibri", "Cambria", "Book Antiqua", "Georgia", "Garamond", "Tahoma", "Verdana", "Bookman Old Style", "Century Gothic"];

const num = (v: string) => Number(v.replace(",", "."));
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Baca ketentuan format kampus dari teks bebas user, mis.
 * "A4, margin 4-4-3-3, Times New Roman 12, spasi 1,5, nomor halaman bawah tengah".
 * Hanya nilai yang dikenali yang dikembalikan; sisanya pakai preset.
 * Urutan "4-4-3-3" mengikuti konvensi Indonesia: atas-kiri-bawah-kanan.
 */
export function parseFormatRules(text: string | undefined | null): Partial<DocxFormatProfile> {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return {};
  const out: Partial<DocxFormatProfile> = {};
  const n = "(\\d+(?:[.,]\\d+)?)";

  const four = new RegExp(`margin[^\\d]{0,20}${n}\\s*(?:cm)?\\s*[-/ ,x]\\s*${n}\\s*(?:cm)?\\s*[-/ ,x]\\s*${n}\\s*(?:cm)?\\s*[-/ ,x]\\s*${n}`).exec(t);
  const margin = { ...DEFAULT_DOCX_PROFILE.margin };
  let marginFound = false;
  if (four) {
    [margin.top, margin.left, margin.bottom, margin.right] = [four[1], four[2], four[3], four[4]].map((v) => clamp(num(v), 1, 6));
    marginFound = true;
  } else {
    const single = new RegExp(`margin[^\\d]{0,12}${n}\\s*cm`).exec(t);
    if (single && !/(atas|kiri|bawah|kanan|top|left|bottom|right)/.test(t)) {
      const v = clamp(num(single[1]), 1, 6);
      Object.assign(margin, { top: v, left: v, bottom: v, right: v });
      marginFound = true;
    }
  }
  const sides: Array<[keyof typeof margin, string]> = [["top", "atas|top"], ["left", "kiri|left"], ["bottom", "bawah|bottom"], ["right", "kanan|right"]];
  for (const [key, words] of sides) {
    const m = new RegExp(`(?:${words})\\s*[:=]?\\s*${n}\\s*cm`).exec(t);
    if (m) { margin[key] = clamp(num(m[1]), 1, 6); marginFound = true; }
  }
  if (marginFound) out.margin = margin;

  const font = KNOWN_FONTS.find((f) => t.includes(f.toLowerCase()));
  if (font) out.font = font;
  const size = /(?:ukuran\s*(?:huruf|font)?|font\s*size|size)\s*[:=]?\s*(\d{1,2})/.exec(t)
    || (font ? new RegExp(`${font.toLowerCase()}\\s*,?\\s*(\\d{1,2})`).exec(t) : null)
    || /\b(\d{1,2})\s*(?:pt|point|poin)\b/.exec(t);
  if (size) out.fontSize = clamp(Number(size[1]), 9, 16);
  const spacing = /(?:spasi|spacing|jarak\s*baris)\s*[:=]?\s*(1[.,]15|1[.,]5|2[.,]0|2|1[.,]0|1)\b/.exec(t);
  if (spacing) out.lineSpacing = clamp(num(spacing[1]), 1, 2.5);

  if (/\b(f4|folio)\b/.test(t)) out.paperSize = "F4";
  else if (/\ba4\b/.test(t)) out.paperSize = "A4";
  else if (/\bletter\b/.test(t)) out.paperSize = "Letter";

  if (/(nomor|no\.?)\s*halaman[^.]{0,30}(bawah\s*tengah|tengah\s*bawah)/.test(t)) out.pageNumberStyle = "bottom-center";
  else if (/(nomor|no\.?)\s*halaman[^.]{0,30}(bawah\s*kanan|kanan\s*bawah)/.test(t)) out.pageNumberStyle = "bottom-right";
  else if (/(nomor|no\.?)\s*halaman[^.]{0,30}(kanan\s*atas|atas\s*kanan)/.test(t)) out.pageNumberStyle = "academic";
  if (/tanpa\s*daftar\s*isi/.test(t)) out.includeToc = false;
  return out;
}

/** Pilih preset dari jenis dokumen (skripsi/tesis → spasi 2). */
export function presetForDocumentType(documentType?: string | null): keyof typeof DOCX_PRESETS {
  return /skripsi|tesis|thesis|tugas akhir|disertasi/i.test(documentType || "") ? "skripsi" : "kampus4433";
}

// ---------------------------------------------------------------------------
// Markdown parsing
// ---------------------------------------------------------------------------

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; rows: string[][]; title?: string }
  | { type: "figure"; title: string; caption: string }
  | { type: "code"; lines: string[] }
  | { type: "pagebreak" };

/** Baris `**Tabel: Judul**` / `**Tabel 2.1 Judul**` tepat sebelum tabel → judul tabel (bukan paragraf). */
const TABLE_TITLE_RE = /^\*\*\s*Tabel\s*(?:[\d.]+\s*)?[:.]?\s*(.+?)\s*\*\*\s*$/i;
function sanitizeFileName(value: string) {
  return String(value || "laporan-akademik")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "laporan-akademik";
}

function parseMarkdownTable(lines: string[]) {
  if (lines.length < 2 || !/---/.test(lines[1])) return null;
  const rows = lines
    .filter((line, index) => index !== 1)
    .map((line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim()));
  if (rows.length < 1) return null;
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [...row, ...new Array(Math.max(0, width - row.length)).fill("")]);
}

export function parseMarkdownToBlocks(markdown: string, knownImageTitles: readonly string[] = []): Block[] {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    blocks.push({ type: "paragraph", text });
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = parseMarkdownTable(table);
    if (rows) {
      // Judul tabel dari paragraf `**Tabel: ...**` tepat sebelumnya
      let title: string | undefined;
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === "paragraph") {
        const m = prev.text.match(TABLE_TITLE_RE);
        if (m) { title = m[1]; blocks.pop(); }
      }
      blocks.push({ type: "table", rows, title });
    } else paragraph.push(...table);
    table = [];
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push({ type: "list", ...list });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Code block ``` ... ``` → blok monospace (isi tidak diparse sebagai markdown).
    if (/^\s*```/.test(line)) {
      if (code) { blocks.push({ type: "code", lines: code }); code = null; }
      else { flushTable(); flushParagraph(); flushList(); code = []; }
      continue;
    }
    if (code) { code.push(raw.replace(/\t/g, "    ")); continue; }

    if (!line.trim()) { flushTable(); flushParagraph(); flushList(); continue; }

    if (line.trim().startsWith("|")) { flushParagraph(); flushList(); table.push(line.trim()); continue; }
    flushTable();

    const figure = parseFigurePlaceholder(line, knownImageTitles);
    if (figure) {
      flushParagraph(); flushList();
      const trailingCaption = /^caption:\s*(.*)$/i.exec(figure.trailing);
      const caption = (figure.caption || trailingCaption?.[1] || figure.title)
        .replace(/^(gambar|figure)\s+\d+(?:\.\d+)*[.:]?\s*/i, "").trim() || figure.title;
      blocks.push({ type: "figure", title: figure.title, caption });
      if (figure.trailing && (!trailingCaption || figure.caption)) blocks.push({ type: "paragraph", text: figure.trailing });
      continue;
    }

    // Judul tabel berdiri sendiri → paragraf tersendiri agar bisa diambil flushTable
    if (TABLE_TITLE_RE.test(line.trim())) { flushParagraph(); flushList(); blocks.push({ type: "paragraph", text: line.trim() }); continue; }

    // Pemisah eksplisit halaman. `---` dari AI hanya garis pemisah → diabaikan (bukan halaman kosong).
    if (/^(<!--\s*pagebreak\s*-->|\\pagebreak|\\newpage)\s*$/i.test(line.trim())) { flushParagraph(); flushList(); blocks.push({ type: "pagebreak" }); continue; }
    if (/^(---+|\*\*\*+|___+)\s*$/.test(line.trim())) { flushParagraph(); flushList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() }); continue; }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; }
      list.items.push((bullet || numbered)![1].trim());
      continue;
    }

    if (line.trim().startsWith(">")) {
      flushParagraph(); flushList();
      const prev = blocks[blocks.length - 1];
      const text = line.trim().replace(/^>\s?/, "");
      // Catatan internal pipeline (audit sitasi/gambar) bukan isi laporan → tidak diekspor.
      if (/^\*\*Catatan[^*]*:\*\*/i.test(text)) continue;
      if (prev && prev.type === "quote") prev.text += ` ${text}`;
      else blocks.push({ type: "quote", text });
      continue;
    }

    // Lanjutan list item (indent)
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    paragraph.push(line.trim());
  }
  if (code) blocks.push({ type: "code", lines: code });
  flushTable(); flushParagraph(); flushList();
  return blocks;
}

// ---------------------------------------------------------------------------
// Inline formatting → TextRun[]
// ---------------------------------------------------------------------------

/**
 * Istilah asing yang lazim di laporan TI berbahasa Indonesia dan wajib italic
 * (PUEBI). Hanya dipakai pada teks polos (bukan yang sudah bold/italic/code).
 * Kata yang sudah diserap KBBI (data, internet, komputer, aplikasi) tidak masuk.
 */
const FOREIGN_TERMS = [
  "software", "hardware", "database", "framework", "user", "users", "interface", "online", "offline",
  "website", "web", "server", "client", "cloud", "backend", "frontend", "back-end", "front-end", "input",
  "output", "feedback", "stakeholder", "stakeholders", "smartphone", "mobile", "platform", "tools", "tool",
  "device", "login", "logout", "download", "upload", "real-time", "realtime", "dashboard", "prototype",
  "prototyping", "black box", "white box", "use case", "flowchart", "activity diagram", "sequence diagram",
  "class diagram", "et al.", "e-learning", "deep learning", "machine learning", "artificial intelligence",
  "dataset", "training", "testing", "library", "browser", "update", "bug", "error", "e-commerce", "startup",
  "internet of things", "big data", "open source", "username", "password", "requirement", "requirements",
  "waterfall", "agile", "scrum", "sprint", "deployment", "hosting", "domain", "responsive", "usability",
  "user experience", "user interface", "end user", "end-user", "query", "request", "response", "endpoint",
  "token", "session", "cache", "log", "logging", "monitoring", "workflow", "gap", "trend", "benchmark",
  "survey", "sampling", "purposive sampling", "random sampling", "cross-sectional", "mixed method",
  "mixed methods", "literature review", "state of the art", "novelty", "insight", "overview", "chatbot",
  "notification", "push notification", "cloud computing", "smart", "wireless", "gateway", "firmware",
  "sensor", "microcontroller", "single page application", "full stack", "full-stack", "source code", "coding",
  "debugging", "unit testing", "integration testing", "user acceptance testing", "form", "field", "search",
  "filter", "sorting", "export", "import", "preview", "draft", "template", "layout", "wireframe", "mockup",
];
const FOREIGN_RE = new RegExp(
  `(?<![\\w-])(${[...FOREIGN_TERMS].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`,
  "gi",
);

type RunBase = { font: string; size: number; bold?: boolean; italics?: boolean; color?: string };

/** Pecah teks polos menjadi run, bagian istilah asing di-italic. */
function plainRuns(text: string, base: RunBase, autoItalic: boolean) {
  if (!autoItalic || base.italics) return [new TextRun({ ...base, text })];
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(FOREIGN_RE)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(new TextRun({ ...base, text: text.slice(last, index) }));
    runs.push(new TextRun({ ...base, text: match[0], italics: true }));
    last = index + match[0].length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ ...base, text })];
}

/** `[teks](url)` → "teks (url)"; link telanjang dibiarkan. */
function flattenLinks(text: string) {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => (label.trim() === url ? url : `${label} (${url})`));
}

function inlineRuns(rawText: string, base: RunBase, autoItalic = false) {
  const text = flattenLinks(rawText);
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|(?<![\w])_[^_]+_(?![\w]))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(...plainRuns(text.slice(last, index), base, autoItalic));
    const token = match[0];
    if (token.startsWith("**")) runs.push(new TextRun({ ...base, text: token.slice(2, -2), bold: true }));
    else if (token.startsWith("`")) runs.push(new TextRun({ ...base, text: token.slice(1, -1), font: "Consolas" }));
    else runs.push(new TextRun({ ...base, text: token.slice(1, -1), italics: true }));
    last = index + token.length;
  }
  if (last < text.length) runs.push(...plainRuns(text.slice(last), base, autoItalic));
  return runs.length ? runs : [new TextRun({ ...base, text })];
}

/** Ukuran PNG dari header IHDR; fallback 4:3 bila bukan PNG. */
function pngSize(data: Uint8Array): { width: number; height: number } {
  const isPng = data.length > 24 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!isPng) return { width: 4, height: 3 };
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  return width > 0 && height > 0 ? { width, height } : { width: 4, height: 3 };
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV"];
/** Heading level-1 yang bukan bab bernomor (bagian depan/belakang). */
const NON_CHAPTER_RE = /^(daftar pustaka|referensi|bibliograf|lampiran|abstrak|abstract|kata pengantar|ringkasan|daftar isi|daftar gambar|daftar tabel|halaman|lembar|glosarium|daftar singkatan|daftar istilah|pernyataan|persembahan|motto)/i;
const BIBLIOGRAPHY_RE = /^(daftar pustaka|referensi|bibliograf)/i;
/** Bagian belakang: tetap di bagian isi (nomor arab), bukan bagian depan. */
const BACK_MATTER_RE = /^(daftar pustaka|referensi|bibliograf|lampiran|glosarium)/i;
/** "BAB II LANDASAN TEORI" / "BAB 2: Landasan Teori" → nomor + judul. */
const NUMBERED_CHAPTER_RE = /^bab\s+([ivxlc]+|\d+)\b\s*[:.\-\u2013]?\s*(.*)$/i;

const cleanHeading = (text: string) => text.replace(/^\*\*|\*\*$/g, "").trim();

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ExportOptions {
  profile?: Partial<DocxFormatProfile>;
  /** key: judul gambar (lowercase, trimmed) → PNG bytes */
  images?: Record<string, Uint8Array | ArrayBuffer>;
  /** Includes planned assets whose bytes are not available yet. */
  figureTitles?: readonly string[];
  /** Italic otomatis untuk istilah asing umum (default true). */
  autoItalic?: boolean;
}

type BodyChild = Paragraph | Table;

/** Bangun objek Document (dipakai klien via toBlob dan server via toBuffer). */
export function buildDocxDocument(markdown: string, options: ExportOptions = {}): Document {
  const profile: DocxFormatProfile = { ...DEFAULT_DOCX_PROFILE, ...options.profile, margin: { ...DEFAULT_DOCX_PROFILE.margin, ...options.profile?.margin } };
  const images: Record<string, Uint8Array | ArrayBuffer> = Object.create(null);
  for (const [key, bytes] of Object.entries(options.images || {})) images[normalizeFigureKey(key)] = bytes;
  const autoItalic = options.autoItalic !== false;
  const sizeHalfPt = Math.round(profile.fontSize * 2);
  const lineTwips = Math.round(240 * profile.lineSpacing);
  const base = { font: profile.font, size: sizeHalfPt };
  const paper = PAPER_MM[profile.paperSize || "A4"];
  const numberStyle: PageNumberStyle = profile.pageNumberStyle || "academic";

  // Lebar/tinggi area teks (px @96dpi) → gambar memenuhi lebar teks, tidak keluar margin.
  const mmToPx = (mm: number) => (mm / 25.4) * 96;
  const maxImageWidthPx = Math.round(mmToPx(paper.width - (profile.margin.left + profile.margin.right) * 10));
  const maxImageHeightPx = Math.round(mmToPx(paper.height - (profile.margin.top + profile.margin.bottom) * 10) * 0.72);

  const blocks = parseMarkdownToBlocks(markdown, [...Object.keys(options.images || {}), ...(options.figureTitles || [])]);

  // Judul H1 pertama dianggap judul dokumen (dipakai sampul) bila diikuti struktur bab.
  const firstHeading = blocks.find((b) => b.type === "heading");
  const docTitleIndex = firstHeading && firstHeading.type === "heading" && firstHeading.level === 1 && !NON_CHAPTER_RE.test(cleanHeading(firstHeading.text)) && !NUMBERED_CHAPTER_RE.test(cleanHeading(firstHeading.text))
    ? blocks.indexOf(firstHeading)
    : -1;
  // Draft generator memakai `# Judul` + `## Bab`. Bila tidak ada bab di level 1,
  // geser semua heading satu level supaya `##` menjadi BAB (halaman baru, "BAB I").
  const h1Chapters = blocks.filter((b, i) => b.type === "heading" && b.level === 1 && i !== docTitleIndex && !NON_CHAPTER_RE.test(cleanHeading(b.text))).length;
  const hasH2 = blocks.some((b) => b.type === "heading" && b.level === 2);
  const shift = h1Chapters === 0 && hasH2 ? 1 : 0;

  let tableCounter = 0;
  let figureCounter = 0;
  let chapterCounter = 0;
  let subChapterCounter = 0;
  let subSubCounter = 0;
  let listInstance = 0;
  let bookmarkSeq = 0;
  let inBibliography = false;

  // Daftar isi/gambar/tabel: bookmark pada heading/caption → PAGEREF di bagian depan.
  const tocEntries: Array<{ label: string; bookmark: string; level: number }> = [];
  const figureEntries: Array<{ label: string; bookmark: string }> = [];
  const tableEntries: Array<{ label: string; bookmark: string }> = [];

  const coverChildren: BodyChild[] = [];
  /** Kata pengantar/abstrak (sebelum bab pertama) → bagian depan bernomor romawi. */
  const preface: BodyChild[] = [];
  /** Tiap elemen = satu section (bab/daftar pustaka/lampiran) → mulai halaman baru. */
  const chunks: BodyChild[][] = [[]];
  let current: BodyChild[] = chunks[0];

  if (profile.cover) {
    const cover = profile.cover;
    const centered = (text: string, size: number, bold = false, spacingBefore = 0) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: spacingBefore, after: 120, line: 276 },
      children: [new TextRun({ text, bold, size, font: profile.font })],
    });
    const title = cover.title || (docTitleIndex >= 0 ? cleanHeading((blocks[docTitleIndex] as { text: string }).text) : "LAPORAN");
    coverChildren.push(centered(title.toUpperCase(), sizeHalfPt + 4, true, 600));
    if (cover.subtitle) coverChildren.push(centered(cover.subtitle.toUpperCase(), sizeHalfPt + 2, true, 360));
    // Ruang logo kampus (diisi manual oleh mahasiswa).
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 1200 },
      children: [new TextRun({ text: "[Logo kampus]", italics: true, color: "999999", font: profile.font, size: sizeHalfPt - 2 })],
    }));
    if (cover.author || cover.studentId) {
      coverChildren.push(centered("Disusun oleh:", sizeHalfPt));
      if (cover.author) coverChildren.push(centered(cover.author, sizeHalfPt, true));
      if (cover.studentId) coverChildren.push(centered(`NIM ${cover.studentId}`, sizeHalfPt, true));
    }
    if (cover.lecturer) {
      coverChildren.push(centered("Dosen Pengampu:", sizeHalfPt, false, 360));
      coverChildren.push(centered(cover.lecturer, sizeHalfPt, true));
    }
    const affiliation = [cover.program && `PROGRAM STUDI ${cover.program.replace(/^program studi\s*/i, "")}`, cover.faculty && `FAKULTAS ${cover.faculty.replace(/^fakultas\s*/i, "")}`, cover.institution]
      .filter((v): v is string => Boolean(v));
    affiliation.forEach((line, i) => coverChildren.push(centered(line.toUpperCase(), sizeHalfPt + 2, true, i === 0 ? 1200 : 0)));
    if (cover.year) coverChildren.push(centered(cover.year, sizeHalfPt + 2, true, affiliation.length ? 0 : 1200));
  }

  const frontTitle = (text: string, breakBefore: boolean) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360, line: lineTwips },
    pageBreakBefore: breakBefore,
    children: [new TextRun({ text, bold: true, font: profile.font, size: sizeHalfPt + 2 })],
  });
  const listEntry = (label: string, bookmark: string, indentMm: number, bold = false) => new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }],
    spacing: { after: 60, line: 276 },
    indent: { left: convertMillimetersToTwip(indentMm), hanging: convertMillimetersToTwip(10) },
    children: [new TextRun({ ...base, text: label, bold }), new TextRun({ ...base, children: ["\t"] }), new PageReference(bookmark, { hyperlink: true })],
  });

  const headingParagraph = (level: number, lines: string[], bookmark: string | undefined, breakBefore = false) => {
    const size = level === 1 ? sizeHalfPt + 2 : sizeHalfPt;
    const runs = lines.map((text, i) => new TextRun({ text, bold: true, font: profile.font, size, color: "000000", ...(i > 0 ? { break: 1 } : {}) }));
    return new Paragraph({
      heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1],
      alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: level === 1 ? 0 : 240, after: level === 1 ? 480 : 120, line: lineTwips },
      pageBreakBefore: breakBefore,
      keepNext: true,
      keepLines: true,
      children: bookmark ? [new Bookmark({ id: bookmark, children: runs })] : runs,
    });
  };

  const captionParagraph = (prefix: string, text: string, bookmark: string, position: "above" | "below") => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: position === "above" ? { before: 240, after: 120, line: 240 } : { before: 120, after: 240, line: 240 },
    keepNext: position === "above",
    children: [new Bookmark({
      id: bookmark,
      children: [
        new TextRun({ text: `${prefix} `, bold: true, font: profile.font, size: sizeHalfPt }),
        ...inlineRuns(text, { ...base }, false),
      ],
    })],
  });

  const nextBookmark = (kind: string) => `${kind}_${++bookmarkSeq}`;

  blocks.forEach((block, blockIndex) => {
    if (blockIndex === docTitleIndex && profile.cover) return; // judul dokumen sudah di sampul
    switch (block.type) {
      case "heading": {
        const text0 = cleanHeading(block.text);
        let level = block.level === 1 ? 1 : Math.max(1, Math.min(block.level - shift, 4));
        // "## Daftar Pustaka" / "## Lampiran" dari AI → bagian setara bab (bukan subbab).
        if (NON_CHAPTER_RE.test(text0) && level <= 2) level = 1;

        if (blockIndex === docTitleIndex) {
          // Tanpa sampul: judul dokumen di atas halaman pertama isi.
          current.push(headingParagraph(1, [text0.toUpperCase()], undefined));
          break;
        }

        const bookmark = nextBookmark("toc");
        if (level === 1) {
          inBibliography = BIBLIOGRAPHY_RE.test(text0);
          subChapterCounter = 0;
          subSubCounter = 0;
          let lines: string[];
          if (NON_CHAPTER_RE.test(text0)) {
            lines = [text0.toUpperCase()];
          } else {
            chapterCounter += 1;
            tableCounter = 0;
            figureCounter = 0;
            const numbered = NUMBERED_CHAPTER_RE.exec(text0);
            const name = (numbered ? numbered[2] : text0).toUpperCase();
            lines = name ? [`BAB ${ROMAN[chapterCounter - 1] || chapterCounter}`, name] : [`BAB ${ROMAN[chapterCounter - 1] || chapterCounter}`];
          }
          tocEntries.push({ label: lines.join(" "), bookmark, level: 1 });

          // Kata pengantar/abstrak sebelum BAB I → bagian depan (romawi).
          const isPreface = NON_CHAPTER_RE.test(text0) && !BACK_MATTER_RE.test(text0) && chapterCounter === 0;
          if (isPreface) {
            current = preface;
            preface.push(headingParagraph(1, lines, bookmark, preface.length > 0 || coverChildren.length > 0));
          } else {
            // Bab baru = section baru (otomatis halaman baru, nomor halaman bab di bawah-tengah).
            current = chunks[chunks.length - 1].length ? (chunks.push([]), chunks[chunks.length - 1]) : chunks[chunks.length - 1];
            current.push(headingParagraph(1, lines, bookmark));
          }
        } else {
          // Subbab tanpa nomor → "N.M Judul" / "N.M.K Judul" mengikuti bab aktif.
          let text = text0;
          const hasNumber = /^\d+(\.\d+)*\.?\s/.test(text);
          if (level === 2) { subChapterCounter += 1; subSubCounter = 0; }
          if (level === 3) subSubCounter += 1;
          if (!hasNumber && chapterCounter > 0 && !inBibliography) {
            if (level === 2) text = `${chapterCounter}.${subChapterCounter} ${text}`;
            else if (level === 3 && subChapterCounter > 0) text = `${chapterCounter}.${subChapterCounter}.${subSubCounter} ${text}`;
          }
          if (level <= 3) tocEntries.push({ label: text, bookmark, level });
          current.push(headingParagraph(level, [text], level <= 3 ? bookmark : undefined));
        }
        break;
      }
      case "paragraph":
        if (inBibliography) {
          // Entri daftar pustaka: spasi 1, hanging indent 1,27 cm, antar-entri 1 baris kosong.
          current.push(new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 240, line: 240 },
            indent: { left: convertMillimetersToTwip(12.7), hanging: convertMillimetersToTwip(12.7) },
            keepLines: true,
            children: inlineRuns(block.text, base, false),
          }));
        } else {
          current.push(new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 0, line: lineTwips },
            indent: { firstLine: convertMillimetersToTwip(12.5) },
            children: inlineRuns(block.text, base, autoItalic),
          }));
        }
        break;
      case "quote":
        current.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { before: 120, after: 120, line: 240 },
          indent: { left: convertMillimetersToTwip(12.5), right: convertMillimetersToTwip(12.5) },
          children: inlineRuns(block.text, { ...base, italics: true }),
        }));
        break;
      case "list": {
        // Tiap list bernomor punya instance sendiri → penomoran mulai dari 1 lagi.
        listInstance += 1;
        block.items.forEach((item) => {
          current.push(new Paragraph({
            numbering: { reference: block.ordered ? "numbered" : "bullets", level: 0, instance: block.ordered ? listInstance : 0 },
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 0, line: inBibliography ? 240 : lineTwips },
            children: inlineRuns(item, base, autoItalic && !inBibliography),
          }));
        });
        break;
      }
      case "code":
        block.lines.forEach((codeLine, i) => {
          current.push(new Paragraph({
            spacing: { before: i === 0 ? 120 : 0, after: i === block.lines.length - 1 ? 120 : 0, line: 240 },
            indent: { left: convertMillimetersToTwip(5) },
            shading: { fill: "F2F2F2" },
            keepLines: true,
            children: [new TextRun({ text: codeLine || " ", font: "Consolas", size: Math.max(16, sizeHalfPt - 4) })],
          }));
        });
        break;
      case "table": {
        tableCounter += 1;
        const header = block.rows[0];
        const prefix = `Tabel ${chapterCounter > 0 ? `${chapterCounter}.` : ""}${tableCounter}`;
        const titleText = block.title || header.slice(0, 3).join(" / ");
        const bookmark = nextBookmark("tabel");
        tableEntries.push({ label: `${prefix} ${titleText.replace(/\*\*/g, "")}`, bookmark });
        // Standar akademik: judul tabel di ATAS tabel.
        current.push(captionParagraph(prefix, titleText, bookmark, "above"));
        current.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map((row, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            cantSplit: true,
            children: row.map((cell) => new TableCell({
              shading: rowIndex === 0 ? { fill: "D9D9D9" } : undefined,
              children: [new Paragraph({
                spacing: { before: 40, after: 40, line: 240 },
                alignment: rowIndex === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: inlineRuns(cell, { ...base, size: sizeHalfPt - 2, bold: rowIndex === 0 }),
              })],
            })),
          })),
        }));
        current.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
      }
      case "figure": {
        figureCounter += 1;
        const key = normalizeFigureKey(block.title);
        const image = images[key];
        const prefix = `Gambar ${chapterCounter > 0 ? `${chapterCounter}.` : ""}${figureCounter}`;
        const bookmark = nextBookmark("gambar");
        figureEntries.push({ label: `${prefix} ${block.caption.replace(/\*\*/g, "")}`, bookmark });
        if (image) {
          const data = image instanceof Uint8Array ? image : new Uint8Array(image);
          const natural = pngSize(data);
          const width = Math.min(maxImageWidthPx, natural.width);
          const height = Math.round(width * (natural.height / natural.width));
          // Batasi tinggi agar gambar + caption muat satu halaman.
          const scale = height > maxImageHeightPx ? maxImageHeightPx / height : 1;
          current.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 0, line: 240 },
            keepNext: true,
            children: [new ImageRun({ type: "png", data, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })],
          }));
        } else {
          const dashed = { style: BorderStyle.DASHED, size: 6, color: "999999" };
          current.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 0 },
            keepNext: true,
            border: { top: dashed, bottom: dashed, left: dashed, right: dashed },
            children: [new TextRun({ text: `[Tempatkan gambar: ${block.title}]`, italics: true, color: "666666", font: profile.font, size: sizeHalfPt - 2 })],
          }));
        }
        // Standar akademik: keterangan gambar di BAWAH gambar.
        current.push(captionParagraph(prefix, block.caption, bookmark, "below"));
        break;
      }
      case "pagebreak":
        current.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  });

  // Bagian depan: sampul → kata pengantar/abstrak → daftar isi → daftar tabel → daftar gambar.
  const front: BodyChild[] = [...coverChildren, ...preface];
  if (profile.includeToc && tocEntries.length) {
    front.push(frontTitle("DAFTAR ISI", front.length > 0));
    tocEntries.forEach((e) => front.push(listEntry(e.label, e.bookmark, 10 + (e.level - 1) * 8, e.level === 1)));
  }
  if (profile.includeToc && tableEntries.length) {
    front.push(frontTitle("DAFTAR TABEL", true));
    tableEntries.forEach((e) => front.push(listEntry(e.label, e.bookmark, 20)));
  }
  if (profile.includeToc && figureEntries.length) {
    front.push(frontTitle("DAFTAR GAMBAR", true));
    figureEntries.forEach((e) => front.push(listEntry(e.label, e.bookmark, 20)));
  }

  const page = {
    size: { width: convertMillimetersToTwip(paper.width), height: convertMillimetersToTwip(paper.height) },
    margin: {
      top: convertMillimetersToTwip(profile.margin.top * 10),
      right: convertMillimetersToTwip(profile.margin.right * 10),
      bottom: convertMillimetersToTwip(profile.margin.bottom * 10),
      left: convertMillimetersToTwip(profile.margin.left * 10),
      header: convertMillimetersToTwip(15),
      footer: convertMillimetersToTwip(15),
    },
  };
  const pageNumberParagraph = (alignment: (typeof AlignmentType)[keyof typeof AlignmentType]) => new Paragraph({
    alignment,
    children: [new TextRun({ children: [PageNumber.CURRENT], font: profile.font, size: sizeHalfPt })],
  });
  const emptyHeader = () => new Header({ children: [new Paragraph({ children: [] })] });
  const emptyFooter = () => new Footer({ children: [new Paragraph({ children: [] })] });

  const sections: ISectionOptions[] = [];
  if (front.length) {
    // Bagian depan: nomor romawi kecil di bawah-tengah; sampul tanpa nomor.
    sections.push({
      properties: { page: { ...page, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } }, titlePage: coverChildren.length > 0 },
      headers: { default: emptyHeader(), first: emptyHeader() },
      footers: profile.includePageNumbers
        ? { default: new Footer({ children: [pageNumberParagraph(AlignmentType.CENTER)] }), first: coverChildren.length ? emptyFooter() : new Footer({ children: [pageNumberParagraph(AlignmentType.CENTER)] }) }
        : { default: emptyFooter(), first: emptyFooter() },
      children: front,
    });
  }

  const bodyChunks = chunks.filter((c) => c.length);
  if (!bodyChunks.length) bodyChunks.push([new Paragraph({ children: [] })]);
  bodyChunks.forEach((chunk, i) => {
    const pageNumbers = i === 0 ? { start: 1, formatType: NumberFormat.DECIMAL } : { formatType: NumberFormat.DECIMAL };
    let headers: ISectionOptions["headers"];
    let footers: ISectionOptions["footers"];
    if (!profile.includePageNumbers) {
      headers = { default: emptyHeader(), first: emptyHeader() };
      footers = { default: emptyFooter(), first: emptyFooter() };
    } else if (numberStyle === "academic") {
      headers = { default: new Header({ children: [pageNumberParagraph(AlignmentType.RIGHT)] }), first: emptyHeader() };
      footers = { default: emptyFooter(), first: new Footer({ children: [pageNumberParagraph(AlignmentType.CENTER)] }) };
    } else {
      const align = numberStyle === "bottom-right" ? AlignmentType.RIGHT : AlignmentType.CENTER;
      headers = { default: emptyHeader(), first: emptyHeader() };
      footers = { default: new Footer({ children: [pageNumberParagraph(align)] }), first: new Footer({ children: [pageNumberParagraph(align)] }) };
    }
    sections.push({
      properties: { page: { ...page, pageNumbers }, titlePage: true },
      headers,
      footers,
      children: chunk,
    });
  });

  const doc = new Document({
    creator: "keluhkampus",
    title: profile.cover?.title,
    styles: {
      default: {
        document: { run: { font: profile.font, size: sizeHalfPt, language: { value: "id-ID" } } },
      },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt + 2, font: profile.font, color: "000000" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 480 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, italics: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 3 } },
        // Gaya TOC: tanpa warna/underline hyperlink bawaan Word
        { id: "TOC1", name: "toc 1", basedOn: "Normal", next: "Normal", run: { bold: true, font: profile.font, size: sizeHalfPt }, paragraph: { spacing: { after: 80 } } },
        { id: "TOC2", name: "toc 2", basedOn: "Normal", next: "Normal", run: { font: profile.font, size: sizeHalfPt }, paragraph: { indent: { left: 440 }, spacing: { after: 60 } } },
        { id: "TOC3", name: "toc 3", basedOn: "Normal", next: "Normal", run: { font: profile.font, size: sizeHalfPt }, paragraph: { indent: { left: 880 }, spacing: { after: 60 } } },
      ],
      characterStyles: [{ id: "Hyperlink", name: "Hyperlink", run: { color: "000000", underline: { type: "none" } } }],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    // Nomor halaman di daftar isi/gambar/tabel (PAGEREF) diisi Word saat file dibuka.
    features: { updateFields: true },
    sections,
  });

  return doc;
}

export async function buildDocxBlob(markdown: string, options: ExportOptions = {}) {
  return Packer.toBlob(buildDocxDocument(markdown, options));
}

export function docxFileName(title?: string) {
  return `${sanitizeFileName(title || "laporan-akademik")}.docx`;
}

export async function exportMarkdownToDocx(markdown: string, title?: string, options: ExportOptions = {}) {
  const blob = await buildDocxBlob(markdown, options);
  // Dynamic import: modul ini juga dipakai di server (file-saver butuh DOM).
  const { saveAs } = await import("file-saver");
  saveAs(blob, docxFileName(title));
}
