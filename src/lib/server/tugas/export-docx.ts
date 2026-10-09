/**
 * Builder DOCX server-side untuk Asisten Dosen (hasil ekstraksi pengumpulan,
 * laporan review, rekap). Output disimpan via saveUpload (owner = admin) dan
 * diunduh lewat /api/files/[fileId].
 */

import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { saveUpload } from "@/lib/storage/upload";

export interface DocxSection {
  title: string;
  /** "code" → font monospace, pertahankan indentasi; "text" → paragraf biasa. */
  kind?: "text" | "code";
  content: string;
}

export interface DocxExportInput {
  title: string;
  subtitle?: string;
  sections: DocxSection[];
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_LINES_PER_SECTION = 4000;

function textParagraphs(content: string, font: string, size: number) {
  return content
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120, line: 276 },
      children: p.split("\n").flatMap((line, i) => (i === 0 ? [new TextRun({ text: line, font, size })] : [new TextRun({ text: line, font, size, break: 1 })])),
    }));
}

function codeParagraphs(content: string) {
  const lines = content.replace(/\r/g, "").split("\n").slice(0, MAX_LINES_PER_SECTION);
  return lines.map((line) => new Paragraph({
    spacing: { after: 0, line: 240 },
    shading: { fill: "F3F4F6" },
    children: [new TextRun({ text: line.replace(/\t/g, "    ") || " ", font: "Consolas", size: 18 })],
  }));
}

export async function buildDocxBuffer(input: DocxExportInput): Promise<Buffer> {
  const font = "Times New Roman";
  const size = 24; // 12pt
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, children: [new TextRun({ text: input.title, bold: true, font, size: 32 })] }),
  ];
  if (input.subtitle) {
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 300 }, children: [new TextRun({ text: input.subtitle, font, size: 22, color: "555555" })] }));
  }
  for (const s of input.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 120 }, children: [new TextRun({ text: s.title, bold: true, font, size: 28 })] }));
    children.push(...(s.kind === "code" ? codeParagraphs(s.content) : textParagraphs(s.content, font, size)));
  }
  const doc = new Document({
    creator: "keluhkampus Asisten Dosen",
    title: input.title,
    sections: [{ properties: { page: { margin: { top: 1440, right: 1134, bottom: 1134, left: 1440 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

function safeFileName(name: string) {
  return (name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 90) || "dokumen") + ".docx";
}

/** Bangun DOCX lalu simpan sebagai FileUpload milik `ownerId`. */
export async function exportDocxForUser(ownerId: string, fileName: string, input: DocxExportInput) {
  const buffer = await buildDocxBuffer(input);
  const originalName = safeFileName(fileName);
  const saved = await saveUpload({ ownerId, buffer, originalName, mime: DOCX_MIME });
  return { fileId: saved.id, name: originalName, url: `/api/files/${saved.id}`, size: buffer.length };
}
