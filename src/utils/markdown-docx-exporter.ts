/**
 * src/utils/markdown-docx-exporter.ts
 * -----------------------------------------------------------------------------
 * Export markdown laporan → DOCX dengan profil format kampus.
 *
 * Fitur:
 *   - Profil format: margin (preset 4/4/3/3 cm, 3/3/3/3, custom), font, ukuran,
 *     spasi baris, halaman sampul opsional.
 *   - Daftar isi otomatis (TOC field — Word minta "update field" saat dibuka).
 *   - Nomor halaman di footer.
 *   - Heading H1-H4, paragraf justified, bullet/numbered list, tabel dengan
 *     caption "Tabel N." otomatis.
 *   - Placeholder gambar `[Gambar: ...]` → caption "Gambar N." + (opsional)
 *     embed PNG dari map `images` (key = judul gambar lowercase).
 *   - Inline **bold** / *italic* / `code`.
 * -----------------------------------------------------------------------------
 */

import {
  AlignmentType,
  BorderStyle,
  Bookmark,
  Document,
  Footer,
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
  TableOfContents,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
  type ISectionOptions,
} from "docx";
import { saveAs } from "file-saver";

// ---------------------------------------------------------------------------
// Profil format
// ---------------------------------------------------------------------------

export interface DocxFormatProfile {
  /** cm */
  margin: { top: number; right: number; bottom: number; left: number };
  font: string;
  /** pt */
  fontSize: number;
  /** 1, 1.5, 2 */
  lineSpacing: number;
  includeToc: boolean;
  includePageNumbers: boolean;
  cover?: {
    title: string;
    subtitle?: string;
    author?: string;
    institution?: string;
    year?: string;
  } | null;
}

export const DOCX_PRESETS: Record<string, { label: string; profile: Omit<DocxFormatProfile, "cover"> }> = {
  kampus4433: {
    label: "Kampus umum (4-4-3-3 cm, TNR 12, spasi 1.5)",
    profile: { margin: { top: 4, left: 4, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 1.5, includeToc: true, includePageNumbers: true },
  },
  kampus3333: {
    label: "Standar (3-3-3-3 cm, TNR 12, spasi 1.5)",
    profile: { margin: { top: 3, left: 3, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 1.5, includeToc: true, includePageNumbers: true },
  },
  skripsi: {
    label: "Skripsi (4-4-3-3 cm, TNR 12, spasi 2)",
    profile: { margin: { top: 4, left: 4, bottom: 3, right: 3 }, font: "Times New Roman", fontSize: 12, lineSpacing: 2, includeToc: true, includePageNumbers: true },
  },
  ringkas: {
    label: "Ringkas (2.5 cm, Arial 11, spasi 1.15, tanpa daftar isi)",
    profile: { margin: { top: 2.5, left: 2.5, bottom: 2.5, right: 2.5 }, font: "Arial", fontSize: 11, lineSpacing: 1.15, includeToc: false, includePageNumbers: true },
  },
};

export const DEFAULT_DOCX_PROFILE: DocxFormatProfile = { ...DOCX_PRESETS.kampus4433.profile, cover: null };

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
  | { type: "pagebreak" };

/** Baris `**Tabel: Judul**` tepat sebelum tabel → judul tabel (bukan paragraf). */
const TABLE_TITLE_RE = /^\*\*\s*Tabel\s*[:.]\s*(.+?)\s*\*\*\s*$/i;
/** `[Gambar: Judul - keterangan]`; pemisah " - " terakhir, judul boleh mengandung tanda hubung. */
const FIGURE_RE = /^\[Gambar:\s*(.+?)\]\s*(.*)$/i;

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

export function parseMarkdownToBlocks(markdown: string): Block[] {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let table: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ").trim();
    paragraph = [];
    // Placeholder gambar sebagai blok tersendiri
    const figure = text.match(FIGURE_RE);
    if (figure) {
      const inner = figure[1].trim();
      const sep = inner.lastIndexOf(" - ");
      const title = (sep > 0 ? inner.slice(0, sep) : inner).trim();
      const captionFromInner = sep > 0 ? inner.slice(sep + 3).trim() : "";
      const trailing = (figure[2] || "").replace(/^caption:\s*/i, "").trim();
      blocks.push({ type: "figure", title, caption: captionFromInner || trailing || title });
      return;
    }
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
    if (!line.trim()) { flushTable(); flushParagraph(); flushList(); continue; }

    if (line.trim().startsWith("|")) { flushParagraph(); flushList(); table.push(line.trim()); continue; }
    flushTable();

    // Judul tabel berdiri sendiri → paragraf tersendiri agar bisa diambil flushTable
    if (TABLE_TITLE_RE.test(line.trim())) { flushParagraph(); flushList(); blocks.push({ type: "paragraph", text: line.trim() }); continue; }

    if (/^(---|\*\*\*|<!--\s*pagebreak\s*-->)\s*$/.test(line.trim())) { flushParagraph(); flushList(); blocks.push({ type: "pagebreak" }); continue; }

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
      if (prev && prev.type === "quote") prev.text += ` ${text}`;
      else blocks.push({ type: "quote", text });
      continue;
    }

    // Lanjutan list item (indent)
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    paragraph.push(line.trim());
  }
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

/** Pecah teks polos menjadi run, bagian istilah asing di-italic. */
function plainRuns(text: string, base: { font: string; size: number; bold?: boolean; italics?: boolean; color?: string }, autoItalic: boolean) {
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

function inlineRuns(text: string, base: { font: string; size: number; bold?: boolean; italics?: boolean; color?: string }, autoItalic = false) {
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g;
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
const NON_CHAPTER_RE = /^(daftar pustaka|referensi|bibliograf|lampiran|abstrak|abstract|kata pengantar|ringkasan|daftar isi|daftar gambar|daftar tabel|halaman|lembar|glosarium)/i;
const BIBLIOGRAPHY_RE = /^(daftar pustaka|referensi|bibliograf)/i;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ExportOptions {
  profile?: Partial<DocxFormatProfile>;
  /** key: judul gambar (lowercase, trimmed) → PNG bytes */
  images?: Record<string, Uint8Array | ArrayBuffer>;
  /** Italic otomatis untuk istilah asing umum (default true). */
  autoItalic?: boolean;
}

export async function buildDocxBlob(markdown: string, options: ExportOptions = {}) {
  const profile: DocxFormatProfile = { ...DEFAULT_DOCX_PROFILE, ...options.profile, margin: { ...DEFAULT_DOCX_PROFILE.margin, ...options.profile?.margin } };
  const images = options.images || {};
  const autoItalic = options.autoItalic !== false;
  const sizeHalfPt = Math.round(profile.fontSize * 2);
  const lineTwips = Math.round(240 * profile.lineSpacing);
  const base = { font: profile.font, size: sizeHalfPt };
  const maxImageWidthPx = 480;

  let tableCounter = 0;
  let figureCounter = 0;
  let chapterCounter = 0;
  let subChapterCounter = 0;
  let seenH1 = false;
  let inBibliography = false;
  const blocks = parseMarkdownToBlocks(markdown);

  // Daftar gambar/tabel: bookmark pada caption → PAGEREF di bagian depan.
  const figureEntries: Array<{ label: string; bookmark: string }> = [];
  const tableEntries: Array<{ label: string; bookmark: string }> = [];

  // Judul H1 pertama di markdown dianggap judul dokumen (dipakai cover bila ada)
  // dan tidak dirender ulang sebagai bab bila cover aktif.
  const firstHeading = blocks.find((b) => b.type === "heading");
  const docTitleIndex = firstHeading && firstHeading.type === "heading" && firstHeading.level === 1 ? blocks.indexOf(firstHeading) : -1;

  const front: Array<Paragraph | Table | TableOfContents> = [];
  const children: Array<Paragraph | Table | TableOfContents> = [];

  if (profile.cover) {
    const cover = profile.cover;
    const centered = (text: string, size: number, bold = false, spacingBefore = 0) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: spacingBefore, after: 200, line: 360 },
      children: [new TextRun({ text, bold, size, font: profile.font })],
    });
    const title = cover.title || (docTitleIndex >= 0 && blocks[docTitleIndex].type === "heading" ? (blocks[docTitleIndex] as { text: string }).text : "LAPORAN");
    if (cover.subtitle) front.push(centered(cover.subtitle.toUpperCase(), sizeHalfPt + 2, true, 1200));
    front.push(centered(title.toUpperCase(), sizeHalfPt + 8, true, cover.subtitle ? 600 : 1800));
    if (cover.author) {
      front.push(centered("Disusun oleh:", sizeHalfPt, false, 2400));
      front.push(centered(cover.author, sizeHalfPt, true));
    }
    if (cover.institution) front.push(centered(cover.institution.toUpperCase(), sizeHalfPt + 2, true, 2400));
    if (cover.year) front.push(centered(cover.year, sizeHalfPt, true, cover.institution ? 0 : 2400));
  }

  const frontTitle = (text: string) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 360, line: lineTwips },
    // Halaman baru untuk tiap daftar; bila tanpa cover, daftar pertama mulai di halaman 1
    pageBreakBefore: front.length > 0,
    children: [new TextRun({ text, bold: true, font: profile.font, size: sizeHalfPt + 4 })],
  });
  const listEntry = (label: string, bookmark: string) => new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX, leader: LeaderType.DOT }],
    spacing: { after: 80, line: lineTwips },
    indent: { left: convertMillimetersToTwip(12), hanging: convertMillimetersToTwip(12) },
    children: [new TextRun({ ...base, text: label }), new TextRun({ ...base, children: ["\t"] }), new PageReference(bookmark, { hyperlink: true })],
  });

  if (profile.includeToc) {
    front.push(frontTitle("DAFTAR ISI"));
    front.push(new TableOfContents("Daftar Isi", { hyperlink: true, headingStyleRange: "1-3" }));
  }

  const headingBase = (level: number, text: string) => new Paragraph({
    heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1],
    alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
    spacing: { before: level === 1 ? 0 : 360, after: level === 1 ? 360 : 200, line: lineTwips },
    pageBreakBefore: level === 1 && seenH1,
    keepNext: true,
    children: [new TextRun({ text, bold: true, font: profile.font, size: level === 1 ? sizeHalfPt + 4 : sizeHalfPt, color: "000000" })],
  });

  const captionParagraph = (label: string, bookmark: string) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 240, line: lineTwips },
    children: [new Bookmark({ id: bookmark, children: [new TextRun({ text: label, bold: true, font: profile.font, size: sizeHalfPt - 2 })] })],
  });

  blocks.forEach((block, blockIndex) => {
    if (blockIndex === docTitleIndex && profile.cover) return; // judul dokumen sudah di cover
    switch (block.type) {
      case "heading": {
        const level = Math.min(block.level, 4);
        let text = block.text.replace(/^\*\*|\*\*$/g, "").trim();
        if (level === 1) {
          inBibliography = BIBLIOGRAPHY_RE.test(text);
          subChapterCounter = 0;
          const alreadyNumbered = /^bab\s+[ivxlc\d]+/i.test(text);
          if (!NON_CHAPTER_RE.test(text) && !alreadyNumbered && blockIndex !== docTitleIndex) {
            chapterCounter += 1;
            text = `BAB ${ROMAN[chapterCounter - 1] || chapterCounter}\n${text}`;
          }
          const [first, ...rest] = text.toUpperCase().split("\n");
          const para = headingBase(1, first);
          if (rest.length) {
            para.addChildElement(new TextRun({ text: rest.join(" "), bold: true, font: profile.font, size: sizeHalfPt + 4, color: "000000", break: 1 }));
          }
          children.push(para);
          seenH1 = true;
        } else {
          // Subbab tanpa nomor → "N.M Judul" mengikuti nomor bab aktif.
          const hasNumber = /^\d+(\.\d+)*\.?\s/.test(text);
          if (level === 2 && !hasNumber && chapterCounter > 0 && !inBibliography) {
            subChapterCounter += 1;
            text = `${chapterCounter}.${subChapterCounter} ${text}`;
          }
          children.push(headingBase(level, text));
        }
        break;
      }
      case "paragraph":
        if (inBibliography) {
          // Entri daftar pustaka: hanging indent, tanpa first-line indent, tanpa auto-italic.
          children.push(new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 240, line: lineTwips },
            indent: { left: convertMillimetersToTwip(12.5), hanging: convertMillimetersToTwip(12.5) },
            children: inlineRuns(block.text, base, false),
          }));
        } else {
          children.push(new Paragraph({
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 120, line: lineTwips },
            indent: { firstLine: convertMillimetersToTwip(12.5) },
            children: inlineRuns(block.text, base, autoItalic),
          }));
        }
        break;
      case "quote":
        children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 160, line: lineTwips },
          indent: { left: convertMillimetersToTwip(12.5), right: convertMillimetersToTwip(12.5) },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: "999999", space: 8 } },
          children: inlineRuns(block.text, { ...base, italics: true, color: "444444" }),
        }));
        break;
      case "list":
        block.items.forEach((item) => {
          children.push(new Paragraph({
            numbering: { reference: block.ordered ? "numbered" : "bullets", level: 0 },
            alignment: AlignmentType.JUSTIFIED,
            spacing: { after: 60, line: lineTwips },
            children: inlineRuns(item, base, autoItalic && !inBibliography),
          }));
        });
        break;
      case "table": {
        tableCounter += 1;
        const header = block.rows[0];
        const label = `Tabel ${chapterCounter > 0 ? `${chapterCounter}.` : ""}${tableCounter}. ${block.title || header.slice(0, 3).join(" / ")}`;
        const bookmark = `tabel_${tableCounter}`;
        tableEntries.push({ label, bookmark });
        // Standar akademik: judul tabel di ATAS tabel.
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 240, after: 80, line: lineTwips },
          keepNext: true,
          children: [new Bookmark({ id: bookmark, children: [new TextRun({ text: label, bold: true, font: profile.font, size: sizeHalfPt - 2 })] })],
        }));
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map((row, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            cantSplit: true,
            children: row.map((cell) => new TableCell({
              shading: rowIndex === 0 ? { fill: "E7E6E6" } : undefined,
              children: [new Paragraph({
                spacing: { before: 60, after: 60 },
                alignment: rowIndex === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
                children: inlineRuns(cell, { ...base, size: sizeHalfPt - 2, bold: rowIndex === 0 }),
              })],
            })),
          })),
        }));
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        break;
      }
      case "figure": {
        figureCounter += 1;
        const key = block.title.toLowerCase().trim();
        const image = images[key];
        const label = `Gambar ${chapterCounter > 0 ? `${chapterCounter}.` : ""}${figureCounter}. ${block.caption}`;
        const bookmark = `gambar_${figureCounter}`;
        figureEntries.push({ label, bookmark });
        if (image) {
          const data = image instanceof Uint8Array ? image : new Uint8Array(image);
          const natural = pngSize(data);
          const width = Math.min(maxImageWidthPx, natural.width);
          const height = Math.round(width * (natural.height / natural.width));
          // Batasi tinggi agar gambar+caption muat satu halaman
          const maxHeight = 560;
          const scale = height > maxHeight ? maxHeight / height : 1;
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 80 },
            keepNext: true,
            children: [new ImageRun({ type: "png", data, transformation: { width: Math.round(width * scale), height: Math.round(height * scale) } })],
          }));
        } else {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 80 },
            keepNext: true,
            border: { top: { style: BorderStyle.DASHED, size: 6, color: "999999" }, bottom: { style: BorderStyle.DASHED, size: 6, color: "999999" }, left: { style: BorderStyle.DASHED, size: 6, color: "999999" }, right: { style: BorderStyle.DASHED, size: 6, color: "999999" } },
            children: [new TextRun({ text: `[Tempatkan gambar: ${block.title}]`, italics: true, color: "666666", font: profile.font, size: sizeHalfPt - 2 })],
          }));
        }
        children.push(captionParagraph(label, bookmark));
        break;
      }
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  });

  // Daftar gambar & tabel (setelah daftar isi, hanya bila ada isinya)
  if (profile.includeToc && figureEntries.length) {
    front.push(frontTitle("DAFTAR GAMBAR"));
    figureEntries.forEach((e) => front.push(listEntry(e.label, e.bookmark)));
  }
  if (profile.includeToc && tableEntries.length) {
    front.push(frontTitle("DAFTAR TABEL"));
    tableEntries.forEach((e) => front.push(listEntry(e.label, e.bookmark)));
  }

  const pageMargin = {
    top: convertMillimetersToTwip(profile.margin.top * 10),
    right: convertMillimetersToTwip(profile.margin.right * 10),
    bottom: convertMillimetersToTwip(profile.margin.bottom * 10),
    left: convertMillimetersToTwip(profile.margin.left * 10),
  };
  const pageNumberFooter = () => new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], font: profile.font, size: sizeHalfPt - 2 })],
    })],
  });

  const sections: ISectionOptions[] = [];
  if (front.length) {
    // Bagian depan: nomor halaman romawi kecil; cover (halaman pertama) tanpa nomor.
    sections.push({
      properties: { page: { margin: pageMargin, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } }, titlePage: Boolean(profile.cover) },
      footers: profile.includePageNumbers
        ? { default: pageNumberFooter(), first: profile.cover ? new Footer({ children: [new Paragraph({ children: [] })] }) : undefined }
        : undefined,
      children: front,
    });
  }
  sections.push({
    properties: { page: { margin: pageMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
    footers: profile.includePageNumbers ? { default: pageNumberFooter() } : undefined,
    children,
  });

  const doc = new Document({
    creator: "keluhkampus",
    styles: {
      default: { document: { run: { font: profile.font, size: sizeHalfPt } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt + 4, font: profile.font, color: "000000" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 360, after: 160 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, italics: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 } } },
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
    features: { updateFields: profile.includeToc },
    sections,
  });

  return Packer.toBlob(doc);
}

export async function exportMarkdownToDocx(markdown: string, title?: string, options: ExportOptions = {}) {
  const blob = await buildDocxBlob(markdown, options);
  saveAs(blob, `${sanitizeFileName(title || "laporan-akademik")}.docx`);
}
