/**
 * Builder ZIP server-side untuk Asisten Dosen (kumpulan gambar hasil ekstraksi,
 * file pengumpulan, dokumen hasil ekspor). Output disimpan via saveUpload
 * (owner = admin) dan diunduh lewat /api/files/[fileId], sama seperti DOCX.
 */

import { saveUpload } from "@/lib/storage/upload";

export interface ZipItem {
  /** Path di dalam ZIP, mis. "Budi_123/gambar/image1.png". Dinormalisasi otomatis. */
  path: string;
  bytes: Buffer;
}

/** Batas ukuran ZIP keluaran (sebelum kompresi) supaya server tidak kehabisan memori. */
export const MAX_ZIP_OUTPUT_BYTES = 200 * 1024 * 1024;
export const MAX_ZIP_ITEMS = 500;

/** Bagian path aman: tanpa "..", tanpa karakter terlarang Windows, panjang terbatas. */
export function safeZipSegment(part: string, fallback = "file") {
  const cleaned = part
    .replace(/[<>:"|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  return cleaned || fallback;
}

function safeZipPath(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/::/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => safeZipSegment(p))
    .join("/") || "file";
}

function safeFileName(name: string) {
  return (name.replace(/\.zip$/i, "").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(0, 90) || "arsip") + ".zip";
}

/** Path unik: "a.png" kedua menjadi "a (2).png". */
function uniquePath(path: string, used: Set<string>) {
  if (!used.has(path.toLowerCase())) return path;
  const m = /^(.*?)(\.[^./]+)?$/.exec(path);
  const base = m?.[1] ?? path;
  const ext = m?.[2] ?? "";
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Bangun ZIP lalu simpan sebagai FileUpload milik `ownerId`. */
export async function exportZipForUser(ownerId: string, fileName: string, items: ZipItem[]) {
  if (!items.length) throw new Error("Tidak ada file untuk dimasukkan ke ZIP.");
  if (items.length > MAX_ZIP_ITEMS) throw new Error(`Terlalu banyak file (${items.length}). Maksimal ${MAX_ZIP_ITEMS} per ZIP.`);
  const total = items.reduce((sum, it) => sum + it.bytes.length, 0);
  if (total > MAX_ZIP_OUTPUT_BYTES) throw new Error(`Total file terlalu besar (${Math.round(total / 1048576)} MB). Maksimal ${MAX_ZIP_OUTPUT_BYTES / 1048576} MB per ZIP.`);

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const it of items) {
    const p = uniquePath(safeZipPath(it.path), used);
    used.add(p.toLowerCase());
    // Gambar/ZIP/DOCX sudah terkompresi: simpan apa adanya supaya cepat.
    const precompressed = /\.(png|jpe?g|gif|webp|zip|docx|pptx|xlsx|pdf|mp4|rar|7z)$/i.test(p);
    zip.file(p, it.bytes, { binary: true, compression: precompressed ? "STORE" : "DEFLATE" });
  }
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const originalName = safeFileName(fileName);
  const saved = await saveUpload({ ownerId, buffer, originalName, mime: "application/zip" });
  return { fileId: saved.id, name: originalName, url: `/api/files/${saved.id}`, size: buffer.length, jumlahFile: items.length };
}
