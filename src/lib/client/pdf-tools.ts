/**
 * src/lib/client/pdf-tools.ts
 * -----------------------------------------------------------------------------
 * Browser-side PDF manipulation. Semua fungsi murni client-side — TIDAK
 * upload file ke server (lihat ToolPanelShell untuk konfirmasi).
 *
 * Dependency:
 *   - pdf-lib: buat, edit, simpan PDF (PDFDocument)
 *   - pdfjs-dist: render halaman ke canvas (untuk convert PDF→image)
 *   - file-saver: trigger download Blob
 *   - jszip: bundling multi-file jadi .zip
 *
 * Error convention: throw `Error` dengan message Bahasa Indonesia supaya
 * UI banner bisa tampil langsung. Caller pakai try/catch + ResultBanner.
 * -----------------------------------------------------------------------------
 */

import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { saveAs } from "file-saver";
import JSZip from "jszip";
import { configurePdfJs } from "./pdfjs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsLib: any = null;

async function getPdfJs() {
  if (pdfjsLib) return pdfjsLib;
  configurePdfJs();
  pdfjsLib = await import("pdfjs-dist");
  return pdfjsLib;
}

async function loadPdfDocument(file: File | ArrayBuffer) {
  const lib = await getPdfJs();
  const data = file instanceof File ? await file.arrayBuffer() : file;
  return lib.getDocument({ data }).promise;
}

/** Merge beberapa PDF jadi satu. Urutan file = urutan halaman. */
export async function mergePdfs(files: File[]): Promise<void> {
  if (files.length < 2) throw new Error("Minimal 2 file PDF untuk digabung.");
  const merged = await PDFDocument.create();
  for (const file of files) {
    const src = await PDFDocument.load(await file.arrayBuffer());
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  const bytes = await merged.save();
  saveAs(new Blob([bytes], { type: "application/pdf" }), "merged.pdf");
}

/**
 * Split PDF — ambil halaman tertentu (1-based). Output satu PDF baru.
 * Contoh: pages "1-3,5,7-9" → halaman 1,2,3,5,7,8,9.
 */
export async function splitPdf(file: File, range: string): Promise<void> {
  const trimmed = range.trim();
  if (!trimmed) throw new Error("Range halaman tidak boleh kosong.");

  const src = await PDFDocument.load(await file.arrayBuffer());
  const total = src.getPageCount();
  const wanted = parsePageRange(trimmed, total);
  if (wanted.length === 0) throw new Error(`Range tidak valid (file punya ${total} halaman).`);

  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, wanted);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  saveAs(new Blob([bytes], { type: "application/pdf" }), "split.pdf");
}

/** Convert PDF ke images (PNG per halaman) lalu download sebagai .zip. */
export async function pdfToImages(file: File): Promise<void> {
  const doc = await loadPdfDocument(file);
  const zip = new JSZip();
  const folder = zip.folder("pages");
  if (!folder) throw new Error("Gagal membuat folder ZIP.");

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Browser tidak mendukung canvas 2D.");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error(`Gagal convert halaman ${i}.`);
    folder.file(`page-${String(i).padStart(3, "0")}.png`, blob);
  }
  const zipBlob = await zip.generateAsync({ type: "blob" });
  saveAs(zipBlob, "pdf-images.zip");
}

/** Gabung beberapa image jadi satu PDF. Mendukung JPEG/PNG. */
export async function imagesToPdf(files: File[]): Promise<void> {
  if (files.length === 0) throw new Error("Minimal 1 image.");
  const doc = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const isPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const out = await doc.save();
  saveAs(new Blob([out], { type: "application/pdf" }), "images.pdf");
}

/** Rotate setiap halaman dengan sudut tertentu. */
export async function rotatePdf(file: File, angle: number): Promise<void> {
  const src = await PDFDocument.load(await file.arrayBuffer());
  src.getPages().forEach((p) => p.setRotation(degrees(angle)));
  const out = await src.save();
  saveAs(new Blob([out], { type: "application/pdf" }), "rotated.pdf");
}

/** Tambah watermark text di tengah setiap halaman. */
export async function watermarkPdf(file: File, text: string): Promise<void> {
  if (!text.trim()) throw new Error("Teks watermark tidak boleh kosong.");
  const src = await PDFDocument.load(await file.arrayBuffer());
  const font = await src.embedFont(StandardFonts.HelveticaBold);
  src.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const size = Math.max(36, Math.min(width, height) / 12);
    page.drawText(text, {
      x: width / 2 - font.widthOfTextAtSize(text, size) / 2,
      y: height / 2,
      size,
      font,
      color: rgb(0.85, 0.1, 0.1),
      opacity: 0.4,
      rotate: degrees(30),
    });
  });
  const out = await src.save();
  saveAs(new Blob([out], { type: "application/pdf" }), "watermarked.pdf");
}

/** Extract plain text dari PDF. */
export async function extractPdfText(file: File): Promise<string> {
  const doc = await loadPdfDocument(file);
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const strings = content.items.map((it: any) => ("str" in it ? it.str : ""));
    out += `--- Halaman ${i} ---\n${strings.join(" ")}\n\n`;
  }
  return out;
}

/** Tambah nomor halaman di pojok bawah tengah. */
export async function addPageNumbers(file: File): Promise<void> {
  const src = await PDFDocument.load(await file.arrayBuffer());
  const font = await src.embedFont(StandardFonts.Helvetica);
  const total = src.getPageCount();
  src.getPages().forEach((page, i) => {
    const { width } = page.getSize();
    const text = `${i + 1} / ${total}`;
    const size = 10;
    page.drawText(text, {
      x: width / 2 - font.widthOfTextAtSize(text, size) / 2,
      y: 20,
      size,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  });
  const out = await src.save();
  saveAs(new Blob([out], { type: "application/pdf" }), "paged.pdf");
}

/** Compress PDF dengan re-save (mengurangi object overhead). Tidak ada recompress gambar bawaan. */
export async function compressPdf(file: File): Promise<void> {
  const src = await PDFDocument.load(await file.arrayBuffer(), {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const out = await src.save({ useObjectStreams: true });
  saveAs(new Blob([out], { type: "application/pdf" }), "compressed.pdf");
}

/** Crop PDF — ambil area tertentu per halaman (semua halaman dipotong sama). */
export async function cropPdf(
  file: File,
  opts: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const src = await PDFDocument.load(await file.arrayBuffer());
  src.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const x = Math.max(0, Math.min(opts.x, width));
    const y = Math.max(0, Math.min(opts.y, height));
    const w = Math.max(10, Math.min(opts.width, width - x));
    const h = Math.max(10, Math.min(opts.height, height - y));
    page.setCropBox(x, y, w, h);
  });
  const out = await src.save();
  saveAs(new Blob([out], { type: "application/pdf" }), "cropped.pdf");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse "1-3,5,7-9" menjadi [1,2,3,5,7,8,9]. 1-based. */
function parsePageRange(input: string, total: number): number[] {
  const out = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const range = part.split("-").map((s) => s.trim());
    if (range.length === 1) {
      const n = Number(range[0]);
      if (Number.isInteger(n) && n >= 1 && n <= total) out.add(n - 1);
    } else if (range.length === 2) {
      const a = Number(range[0]);
      const b = Number(range[1]);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (let i = lo; i <= hi; i++) {
        if (i >= 1 && i <= total) out.add(i - 1);
      }
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}