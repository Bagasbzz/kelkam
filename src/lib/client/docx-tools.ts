/**
 * src/lib/client/docx-tools.ts
 * -----------------------------------------------------------------------------
 * Browser-side DOCX tools. Memakai mammoth (DOCX → HTML/text).
 *
 * Catatan: html-to-docx dan docx-build TIDAK_NON-native di sini karena
 * html-to-docx menarik modul Node (fs/path) ke client bundle dan build
 * Next.js gagal. Untuk HTML→DOCX dan Text→DOCX, gunakan editor di
 * /template-generator yang punya pipeline sendiri.
 * -----------------------------------------------------------------------------
 */

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