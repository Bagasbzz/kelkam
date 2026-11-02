import JSZip from "jszip";
import { createInflateRaw } from "node:zlib";
import { ApiRequestError } from "./request-guards";

export const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_ARCHIVE_RATIO = 80;
const MAX_ARCHIVE_ENTRIES = 65_535;

export interface ExpansionBudget {
  used: number;
  limit: number;
}

// JSZip exposes no cancellable inflater. Its loaded entries hold compressed
// slices; use node:zlib streams instead of entry.async(), which accumulates first.
interface CompressedEntry {
  uncompressedSize: number;
  compressedSize: number;
  compressedContent: Uint8Array;
  compression: { magic: string };
}

function dataOf(entry: JSZip.JSZipObject): CompressedEntry {
  const data = (entry as unknown as { _data: CompressedEntry })._data;
  // JSZip replaces loaded zero-length entries with a resolved empty promise.
  if (data instanceof Promise) return { uncompressedSize: 0, compressedSize: 0, compressedContent: new Uint8Array(), compression: { magic: "\x00\x00" } };
  if (!data || !Number.isSafeInteger(data.uncompressedSize) || data.uncompressedSize < 0 ||
      !Number.isSafeInteger(data.compressedSize) || data.compressedSize < 0 ||
      !(data.compressedContent instanceof Uint8Array) || data.compressedContent.byteLength !== data.compressedSize) {
    throw new ApiRequestError(415, "Metadata arsip tidak valid.");
  }
  return data;
}

export function archiveEntrySize(entry: JSZip.JSZipObject): number {
  return dataOf(entry).uncompressedSize;
}

export async function loadBoundedArchive(buffer: Buffer, office = false): Promise<JSZip> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new ApiRequestError(413, "Arsip berisi terlalu banyak file.");
  let all = 0;
  let visible = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const size = archiveEntrySize(entry);
    all += size;
    if (office) {
      if (++visible > 8_000 || size > MAX_ARCHIVE_BYTES || all > MAX_ARCHIVE_BYTES) {
        throw new ApiRequestError(413, "Isi dokumen terlalu besar untuk dibaca.");
      }
      const original = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
      if (original.includes("\0") || /(^|[\\/])\.\.([\\/]|$)|^[\\/]|^[a-z]:/i.test(original)) {
        throw new ApiRequestError(415, "Path dokumen tidak valid.");
      }
    }
  }
  if (all / Math.max(1, buffer.length) > MAX_ARCHIVE_RATIO) {
    throw new ApiRequestError(413, "Rasio kompresi arsip tidak aman untuk diproses.");
  }
  return zip;
}

export async function readBoundedEntry(
  entry: JSZip.JSZipObject,
  budget: ExpansionBudget,
  maxBytes = MAX_ARCHIVE_BYTES,
  timeoutMs = 15_000,
): Promise<Buffer> {
  const data = dataOf(entry);
  const limit = Math.min(maxBytes, budget.limit - budget.used);
  if (data.uncompressedSize > limit) throw new ApiRequestError(413, "File di dalam arsip terlalu besar.");
  const compressed = Buffer.from(data.compressedContent.buffer, data.compressedContent.byteOffset, data.compressedContent.byteLength);
  if (data.compression.magic === "\x00\x00") {
    if (compressed.length !== data.uncompressedSize) throw new ApiRequestError(415, "Ukuran entry arsip tidak valid.");
    budget.used += compressed.length;
    return compressed;
  }
  if (data.compression.magic !== "\x08\x00") throw new ApiRequestError(415, "Kompresi arsip tidak didukung.");
  const inflater = createInflateRaw({ chunkSize: 16 * 1024 });
  const timer = setTimeout(() => inflater.destroy(new ApiRequestError(408, "File membutuhkan waktu terlalu lama untuk dibaca.")), timeoutMs);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    inflater.end(compressed);
    for await (const chunk of inflater) {
      total += chunk.length;
      // Check BEFORE retaining the chunk or allocating a combined buffer. Also
      // enforce declared size so forged small headers cannot hide expansion.
      if (total > limit || total > data.uncompressedSize) {
        throw new ApiRequestError(413, "Isi arsip melebihi batas ekspansi.");
      }
      budget.used += chunk.length;
      chunks.push(chunk);
    }
    if (total !== data.uncompressedSize) throw new ApiRequestError(415, "Ukuran entry arsip tidak valid.");
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
    inflater.destroy();
  }
}
