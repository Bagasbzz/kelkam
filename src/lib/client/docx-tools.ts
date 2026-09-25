/**
 * src/lib/client/docx-tools.ts
 * -----------------------------------------------------------------------------
 * Browser-side DOCX tools. Memakai mammoth (DOCX → HTML/text), docx (build
 * DOCX), dan html-to-docx (HTML → DOCX) — semua pure client.
 *
 * Catatan penting:
 *   - mammoth extract image jika `convertImage` di-set; default kami matikan
 *     supaya hasil HTML lebih ringan dan predictable.
 *   - html-to-docx top-level await tidak jalan di browser; kami bungkus di
 *     dynamic import.
 * -----------------------------------------------------------------------------
 */

import { saveAs } from "file-saver";
import * as mammoth from "mammoth";

/** DOCX → HTML string. */
export async function docxToHtml(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
  return result.value;
}

/** DOCX → plain text. */
export async function docxToText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

/**
 * DOCX → markdown-ish text. Mammoth tidak punya markdown converter resmi;
 * kita derive dari raw text + tambah newline. Untuk dokumen formal,
 * pakai docxToHtml → MD library terpisah (di luar scope).
 */
export async function docxToMarkdown(file: File): Promise<string> {
  const raw = await docxToText(file);
  return raw
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => (para.length < 100 && para === para.toUpperCase() ? `## ${para}` : para))
    .join("\n\n");
}

/** Convert HTML string ke file DOCX dan trigger download. */
export async function htmlToDocx(html: string, filename = "converted.docx"): Promise<void> {
  if (!html.trim()) throw new Error("HTML tidak boleh kosong.");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("html-to-docx" as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (mod as any).default ?? mod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer: BlobPart = await fn(html, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    header: false,
  });
  saveAs(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), filename);
}

/** Build DOCX baru dari plain text (1 paragraf per double-newline). */
export async function textToDocx(text: string, filename = "text.docx"): Promise<void> {
  if (!text.trim()) throw new Error("Teks tidak boleh kosong.");
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const docxMod = await import("docx" as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const D = docxMod as any;
  const children = paragraphs.map(
    (line: string) =>
      new D.Paragraph({
        children: [new D.TextRun(line)],
      }),
  );
  const doc = new D.Document({ sections: [{ children }] });
  const buffer = await D.Packer.toBlob(doc);
  saveAs(buffer, filename);
}