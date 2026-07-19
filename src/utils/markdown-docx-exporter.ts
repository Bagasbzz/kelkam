import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { saveAs } from "file-saver";

function sanitizeFileName(value: string) {
  return String(value || "laporan-akademik")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "laporan-akademik";
}

function parseMarkdownTable(block: string) {
  const lines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2 || !lines[0].includes("|") || !lines[1].includes("---")) return null;

  const rows = lines.map((line) => line.split("|").map((cell) => cell.trim()).filter(Boolean));
  if (rows.length < 2) return null;
  return rows;
}

function parseMarkdownToBlocks(markdown: string) {
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  const blocks: Array<{ type: "heading" | "paragraph" | "table"; level?: number; text?: string; rows?: string[][] }> = [];
  let paragraphBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    blocks.push({ type: "paragraph", text: paragraphBuffer.join(" ").trim() });
    paragraphBuffer = [];
  };

  const flushTable = () => {
    if (!tableBuffer.length) return;
    const parsed = parseMarkdownTable(tableBuffer.join("\n"));
    if (parsed) {
      blocks.push({ type: "table", rows: parsed });
    } else {
      paragraphBuffer.push(...tableBuffer);
    }
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      flushTable();
      flushParagraph();
      continue;
    }

    if (line.includes("|") && (line.startsWith("|") || tableBuffer.length > 0)) {
      flushParagraph();
      tableBuffer.push(line);
      continue;
    }

    flushTable();

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2].trim() });
      continue;
    }

    paragraphBuffer.push(line.trim());
  }

  flushTable();
  flushParagraph();
  return blocks;
}

function paragraphFromText(text: string, level?: number) {
  const heading = level === 1
    ? HeadingLevel.HEADING_1
    : level === 2
      ? HeadingLevel.HEADING_2
      : level === 3
        ? HeadingLevel.HEADING_3
        : undefined;

  return new Paragraph({
    heading,
    spacing: { before: heading ? 280 : 120, after: heading ? 160 : 120, line: 360 },
    alignment: heading && level === 1 ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
    children: [
      new TextRun({
        text,
        bold: Boolean(heading),
        size: heading ? (level === 1 ? 30 : 26) : 24,
        font: "Times New Roman",
      }),
    ],
  });
}

function tableFromRows(rows: string[][]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => new TableRow({
      children: row.map((cell) => new TableCell({
        children: [new Paragraph({
          spacing: { after: 80, before: 80 },
          children: [new TextRun({ text: cell, bold: rowIndex === 0, size: 22, font: "Times New Roman" })],
        })],
      })),
    })),
  });
}

export async function exportMarkdownToDocx(markdown: string, title?: string) {
  const blocks = parseMarkdownToBlocks(markdown);
  const children = blocks.flatMap((block) => {
    if (block.type === "heading") return [paragraphFromText(block.text || "", block.level)];
    if (block.type === "table") return [tableFromRows(block.rows || [])];
    return [paragraphFromText(block.text || "")];
  });

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1800 },
        },
      },
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${sanitizeFileName(title || "laporan-akademik")}.docx`);
}
