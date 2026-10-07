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
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  convertMillimetersToTwip,
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
  | { type: "table"; rows: string[][] }
  | { type: "figure"; title: string; caption: string }
  | { type: "pagebreak" };

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
    const figure = text.match(/^\[Gambar:\s*([^\]-]+?)(?:\s*-\s*([^\]]*))?\]\s*(.*)$/i);
    if (figure) {
      const captionText = (text.replace(figure[0], "") || figure[3] || "").replace(/^caption:\s*/i, "").trim();
      blocks.push({ type: "figure", title: figure[1].trim(), caption: captionText || figure[1].trim() });
      return;
    }
    blocks.push({ type: "paragraph", text });
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = parseMarkdownTable(table);
    if (rows) blocks.push({ type: "table", rows });
    else paragraph.push(...table);
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

function inlineRuns(text: string, base: { font: string; size: number; bold?: boolean; italics?: boolean; color?: string }) {
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|_[^_]+_)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(new TextRun({ ...base, text: text.slice(last, index) }));
    const token = match[0];
    if (token.startsWith("**")) runs.push(new TextRun({ ...base, text: token.slice(2, -2), bold: true }));
    else if (token.startsWith("`")) runs.push(new TextRun({ ...base, text: token.slice(1, -1), font: "Consolas" }));
    else runs.push(new TextRun({ ...base, text: token.slice(1, -1), italics: true }));
    last = index + token.length;
  }
  if (last < text.length) runs.push(new TextRun({ ...base, text: text.slice(last) }));
  return runs.length ? runs : [new TextRun({ ...base, text })];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ExportOptions {
  profile?: Partial<DocxFormatProfile>;
  /** key: judul gambar (lowercase, trimmed) → PNG bytes */
  images?: Record<string, Uint8Array | ArrayBuffer>;
}

export async function buildDocxBlob(markdown: string, options: ExportOptions = {}) {
  const profile: DocxFormatProfile = { ...DEFAULT_DOCX_PROFILE, ...options.profile, margin: { ...DEFAULT_DOCX_PROFILE.margin, ...options.profile?.margin } };
  const images = options.images || {};
  const sizeHalfPt = Math.round(profile.fontSize * 2);
  const lineTwips = Math.round(240 * profile.lineSpacing);
  const base = { font: profile.font, size: sizeHalfPt };

  let tableCounter = 0;
  let figureCounter = 0;
  let seenH1 = false;
  const blocks = parseMarkdownToBlocks(markdown);

  // Judul H1 pertama dipakai untuk cover/judul dokumen
  const children: Array<Paragraph | Table | TableOfContents> = [];

  if (profile.cover) {
    const cover = profile.cover;
    const centered = (text: string, size: number, bold = false, spacingBefore = 0) => new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: spacingBefore, after: 200 },
      children: [new TextRun({ text, bold, size, font: profile.font })],
    });
    children.push(centered(cover.title, sizeHalfPt + 8, true, 2400));
    if (cover.subtitle) children.push(centered(cover.subtitle, sizeHalfPt + 2));
    if (cover.author) children.push(centered(cover.author, sizeHalfPt, true, 2400));
    if (cover.institution) children.push(centered(cover.institution, sizeHalfPt, true, 1800));
    if (cover.year) children.push(centered(cover.year, sizeHalfPt));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  if (profile.includeToc) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: "DAFTAR ISI", bold: true, font: profile.font, size: sizeHalfPt + 4 })],
    }));
    children.push(new TableOfContents("Daftar Isi", { hyperlink: true, headingStyleRange: "1-3" }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }

  for (const block of blocks) {
    switch (block.type) {
      case "heading": {
        const level = Math.min(block.level, 4);
        const headingLevel = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][level - 1];
        children.push(new Paragraph({
          heading: headingLevel,
          alignment: level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT,
          spacing: { before: level === 1 ? 0 : 360, after: 200, line: lineTwips },
          pageBreakBefore: level === 1 && seenH1,
          children: [new TextRun({ text: level === 1 ? block.text.toUpperCase() : block.text, bold: true, font: profile.font, size: level === 1 ? sizeHalfPt + 4 : sizeHalfPt, color: "000000" })],
        }));
        if (level === 1) seenH1 = true;
        break;
      }
      case "paragraph":
        children.push(new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: 120, line: lineTwips },
          indent: { firstLine: convertMillimetersToTwip(12.5) },
          children: inlineRuns(block.text, base),
        }));
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
            children: inlineRuns(item, base),
          }));
        });
        break;
      case "table": {
        tableCounter += 1;
        const header = block.rows[0];
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 80 },
          keepNext: true,
          children: [new TextRun({ text: `Tabel ${tableCounter}. ${header.slice(0, 3).join(" / ")}`, bold: true, font: profile.font, size: sizeHalfPt - 2 })],
        }));
        children.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: block.rows.map((row, rowIndex) => new TableRow({
            tableHeader: rowIndex === 0,
            children: row.map((cell) => new TableCell({
              shading: rowIndex === 0 ? { fill: "E7E6E6" } : undefined,
              children: [new Paragraph({
                spacing: { before: 60, after: 60 },
                children: inlineRuns(cell, { ...base, size: sizeHalfPt - 2, bold: rowIndex === 0 }),
              })],
            })),
          })),
        }));
        children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
        break;
      }
      case "figure": {
        figureCounter += 1;
        const key = block.title.toLowerCase().trim();
        const image = images[key];
        if (image) {
          const data = image instanceof Uint8Array ? image : new Uint8Array(image);
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 80 },
            keepNext: true,
            children: [new ImageRun({ type: "png", data, transformation: { width: 480, height: 320 } })],
          }));
        } else {
          children.push(new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 80 },
            keepNext: true,
            border: { top: { style: BorderStyle.DASHED, size: 6, color: "999999" }, bottom: { style: BorderStyle.DASHED, size: 6, color: "999999" }, left: { style: BorderStyle.DASHED, size: 6, color: "999999" }, right: { style: BorderStyle.DASHED, size: 6, color: "999999" } },
            children: [new TextRun({ text: `[Tempatkan gambar: ${block.title}]`, italics: true, color: "666666", font: profile.font, size: sizeHalfPt - 2 })],
          }));
        }
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: `Gambar ${figureCounter}. ${block.caption}`, bold: true, font: profile.font, size: sizeHalfPt - 2 })],
        }));
        break;
      }
      case "pagebreak":
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
    }
  }

  const doc = new Document({
    creator: "keluhkampus",
    styles: {
      default: { document: { run: { font: profile.font, size: sizeHalfPt } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt + 4, font: profile.font, color: "000000" }, paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 240 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 360, after: 160 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", quickFormat: true, run: { bold: true, italics: true, size: sizeHalfPt, font: profile.font, color: "000000" }, paragraph: { spacing: { before: 200, after: 100 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbered", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    features: { updateFields: profile.includeToc },
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertMillimetersToTwip(profile.margin.top * 10),
            right: convertMillimetersToTwip(profile.margin.right * 10),
            bottom: convertMillimetersToTwip(profile.margin.bottom * 10),
            left: convertMillimetersToTwip(profile.margin.left * 10),
          },
        },
      },
      footers: profile.includePageNumbers ? {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: [PageNumber.CURRENT], font: profile.font, size: sizeHalfPt - 2 })],
          })],
        }),
      } : undefined,
      children,
    }],
  });

  return Packer.toBlob(doc);
}

export async function exportMarkdownToDocx(markdown: string, title?: string, options: ExportOptions = {}) {
  const blob = await buildDocxBlob(markdown, options);
  saveAs(blob, `${sanitizeFileName(title || "laporan-akademik")}.docx`);
}
