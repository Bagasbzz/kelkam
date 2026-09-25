/**
 * src/lib/client/image-tools.ts
 * -----------------------------------------------------------------------------
 * Browser-side image manipulation. Convert format, compress, resize,
 * crop, base64 encode/decode — semua via Canvas + browser-image-compression.
 *
 * Tidak ada backend call. File max di-handle 50MB (limit canvas internal).
 * -----------------------------------------------------------------------------
 */

import imageCompression from "browser-image-compression";
import { saveAs } from "file-saver";

export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";

const FORMAT_LABEL: Record<ImageFormat, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Convert satu image ke format lain. Output: Blob trigger download. */
export async function convertImageFormat(file: File, target: ImageFormat): Promise<void> {
  const blob = await fileToBlob(file, target);
  saveAs(blob, `${rename(file.name, FORMAT_LABEL[target])}`);
}

/** Compress image ke target max size (MB). Iteratif dengan scale fallback. */
export async function compressImage(file: File, maxMb: number): Promise<void> {
  const targetBytes = Math.max(0.05, maxMb) * 1024 * 1024;
  const compressed = await imageCompression(file, {
    maxSizeMB: Math.max(0.05, maxMb),
    maxWidthOrHeight: 4096,
    useWebWorker: true,
    initialQuality: 0.9,
    fileType: file.type === "image/png" ? "image/png" : "image/jpeg",
  });
  if (compressed.size > targetBytes) {
    throw new Error(
      `Tidak bisa kompres di bawah ${maxMb}MB (hasil ${(compressed.size / 1024 / 1024).toFixed(2)}MB). Coba turunkan resolusi.`,
    );
  }
  saveAs(compressed, `compressed-${file.name}`);
}

/** Resize image ke width x height tertentu. Aspect ratio dijaga via cover-fit. */
export async function resizeImage(file: File, width: number, height: number): Promise<void> {
  if (!Number.isFinite(width) || width < 16 || !Number.isFinite(height) || height < 16) {
    throw new Error("Dimensi minimal 16x16.");
  }
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  // Cover-fit: scale agar menutupi canvas, center-crop.
  const scale = Math.max(width / img.width, height / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
  const out = await canvasToBlob(canvas, "image/png");
  saveAs(out, `resized-${width}x${height}-${file.name}`);
}

/** Crop image — ambil rectangle (x,y,w,h) dalam pixels. */
export async function cropImage(
  file: File,
  rect: { x: number; y: number; width: number; height: number },
): Promise<void> {
  const img = await loadImage(file);
  const { x, y, width, height } = rect;
  if (x < 0 || y < 0 || width <= 0 || height <= 0) throw new Error("Crop rectangle invalid.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas.");
  ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
  const out = await canvasToBlob(canvas, "image/png");
  saveAs(out, `cropped-${file.name}`);
}

/** Image → base64 data URL. */
export async function imageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Gagal membaca file."));
    reader.readAsDataURL(file);
  });
}

/** Base64 data URL → Blob, trigger download. */
export function base64ToImage(dataUrl: string, filename = "decoded.png"): void {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Bukan data URL image yang valid.");
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  saveAs(new Blob([bytes], { type: mime }), filename);
}

/** Compress banyak image jadi zip. */
export async function batchCompressImages(files: File[], maxMb: number): Promise<void> {
  if (files.length === 0) throw new Error("Minimal 1 image.");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of files) {
    const out = await imageCompression(file, {
      maxSizeMB: Math.max(0.05, maxMb),
      maxWidthOrHeight: 4096,
      useWebWorker: true,
      fileType: file.type === "image/png" ? "image/png" : "image/jpeg",
    });
    zip.file(`compressed-${file.name}`, out);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, "compressed-images.zip");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Free object URL after image decoded.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function fileToBlob(file: File, target: ImageFormat): Promise<Blob> {
  if (file.type === target) return file;
  const img = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas.");
  if (target === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);
  return canvasToBlob(canvas, target);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Gagal encode image."))),
      type,
      0.92,
    );
  });
}

function rename(original: string, newExt: string): string {
  const lastDot = original.lastIndexOf(".");
  const base = lastDot >= 0 ? original.slice(0, lastDot) : original;
  return `${base}.${newExt}`;
}