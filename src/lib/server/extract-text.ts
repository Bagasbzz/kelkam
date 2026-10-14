/**
 * Ekstraksi teks server-side yang reusable (PDF, DOCX, ZIP, teks biasa).
 * -----------------------------------------------------------------------------
 * Dipakai oleh:
 *   - /api/context/extract (bahan Studio/Laporan)
 *   - Admin AI Tugas (baca isi pengumpulan mahasiswa, termasuk ZIP)
 *
 * Keamanan (lihat OWASP):
 *   - ZIP bomb check (total uncompressed, ratio, jumlah entry)
 *   - Zip Slip: tolak path absolut / ".."
 *   - Skip folder berat (node_modules, .git, dist, ...) & file sensitif
 *   - Redaksi secret via redactSensitiveText
 *   - Timeout per parser (anti hang)
 * -----------------------------------------------------------------------------
 */

import mammoth from "mammoth";
import { ApiRequestError } from "@/lib/server/request-guards";
import { isSensitivePath, redactSensitiveText } from "@/lib/security/redact-secrets";

export type ExtractKind = "note" | "guide" | "code";

export interface ZipFileEntry {
  path: string;
  size: number;
  ext: string;
}

export interface ZipManifest {
  totalEntries: number;
  readEntries: number;
  /** Frekuensi ekstensi, mis. { ".ts": 12, ".php": 3 } */
  extCounts: Record<string, number>;
  /** Framework / stack yang terdeteksi dari file penanda. */
  frameworks: string[];
  /** Daftar path (sudah difilter, maks 250). */
  tree: string[];
}

export interface ExtractResult {
  content: string;
  charCount: number;
  kind: ExtractKind;
  truncated: boolean;
  zipManifest?: ZipManifest;
  /** Jumlah halaman (PDF). */
  pdfPages?: number;
  /** PDF hampir tanpa teks: kemungkinan hasil scan, perlu dibaca sebagai gambar. */
  pdfScanned?: boolean;
}

export interface ExtractOptions {
  /** Batas karakter total output (default 60k). */
  maxChars?: number;
  /** Batas karakter per file di dalam ZIP (default 5k). */
  maxCharsPerZipFile?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TEXT_EXTENSIONS =
  /\.(txt|md|csv|json|js|jsx|ts|tsx|php|py|java|kt|go|rs|c|cpp|h|cs|rb|dart|sql|html|css|scss|xml|yml|yaml|log|env\.example|blade\.php|vue|svelte)$/i;

export const DEFAULT_MAX_CHARS = 60_000;
const DEFAULT_MAX_CHARS_PER_ZIP_FILE = 5_000;

const MAX_ZIP_ENTRIES = 400;
const MAX_ZIP_FILES_READ = 80;
const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
const MAX_ZIP_RATIO = 80;
const PARSER_TIMEOUT_MS = 30_000;
/** Di bawah ini per halaman dianggap PDF scan (tanpa layer teks). */
const PDF_SCAN_MIN_CHARS_PER_PAGE = 40;
const PDF_RENDER_MAX_PAGES = 6;
const PDF_RENDER_WIDTH = 1100;
/** ZIP di dalam ZIP: dibuka 1 level, entry-nya diberi prefix "inner.zip::". */
const NESTED_ZIP_SEPARATOR = "::";
const MAX_NESTED_ZIPS = 5;

/** File penanda → nama framework. Dipakai untuk ringkasan struktur ZIP. */
const FRAMEWORK_MARKERS: Array<[RegExp, string]> = [
  [/(^|\/)next\.config\.(js|mjs|ts)$/i, "Next.js"],
  [/(^|\/)artisan$/i, "Laravel"],
  [/(^|\/)composer\.json$/i, "PHP (Composer)"],
  [/(^|\/)package\.json$/i, "Node.js"],
  [/(^|\/)requirements\.txt$/i, "Python"],
  [/(^|\/)manage\.py$/i, "Django"],
  [/(^|\/)app\.py$/i, "Flask/Python"],
  [/(^|\/)pom\.xml$/i, "Java (Maven)"],
  [/(^|\/)build\.gradle(\.kts)?$/i, "Java/Kotlin (Gradle)"],
  [/(^|\/)pubspec\.yaml$/i, "Flutter/Dart"],
  [/(^|\/)go\.mod$/i, "Go"],
  [/(^|\/)Cargo\.toml$/i, "Rust"],
  [/\.csproj$/i, ".NET"],
  [/(^|\/)vite\.config\.(js|ts)$/i, "Vite"],
  [/(^|\/)angular\.json$/i, "Angular"],
  [/(^|\/)nuxt\.config\.(js|ts)$/i, "Nuxt"],
  [/(^|\/)docker-compose\.ya?ml$/i, "Docker Compose"],
  [/(^|\/)Dockerfile$/i, "Docker"],
  [/\.sql$/i, "SQL schema"],
  [/(^|\/)prisma\/schema\.prisma$/i, "Prisma"],
];

/** Prioritas file saat membaca ZIP: file penting dibaca lebih dulu. */
function filePriority(path: string): number {
  const lower = path.toLowerCase();
  if (/(^|\/)readme(\.|$)/.test(lower)) return 0;
  if (/(^|\/)(package|composer)\.json$/.test(lower)) return 1;
  if (/schema\.prisma$|\.sql$/.test(lower)) return 2;
  if (/(^|\/)(routes?|controllers?|models?|services?|api)\//.test(lower)) return 3;
  if (/(^|\/)(src|app|lib)\//.test(lower)) return 4;
  if (/\.(md|txt)$/.test(lower)) return 6;
  if (/\.(json|yml|yaml|xml|css|scss|log|csv)$/.test(lower)) return 7;
  return 5;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitasi + truncate: hapus null byte, redact secret, rapikan whitespace. */
export function sanitizeText(text: string, max: number): { text: string; truncated: boolean } {
  const cleaned = redactSensitiveText(text)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (cleaned.length <= max) return { text: cleaned, truncated: false };
  return {
    text: `${cleaned.slice(0, max)}\n\n[Dipangkas otomatis: isi terlalu panjang.]`,
    truncated: true,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = PARSER_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiRequestError(408, "File membutuhkan waktu terlalu lama untuk dibaca.")),
      timeoutMs,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function isSafeArchivePath(path: string) {
  // Entry ZIP bertingkat "a.zip::b/c": tiap bagian harus aman.
  return path.split(NESTED_ZIP_SEPARATOR).every((segment) => {
    const normalized = segment.replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
    return !normalized.split("/").some((part) => part === "..");
  });
}

function shouldIgnorePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return (
    !isSafeArchivePath(normalized) ||
    isSensitivePath(normalized) ||
    /(^|\/)(node_modules|\.git|\.next|dist|build|vendor|__pycache__|\.idea|\.vscode|coverage)\//.test(normalized) ||
    /(^|\/)__MACOSX\//.test(normalized) ||
    /(^|\/)\.DS_Store$/.test(normalized)
  );
}

function declaredUncompressedSize(entry: unknown) {
  const size = Number((entry as { _data?: { uncompressedSize?: number } })?._data?.uncompressedSize || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function extOf(path: string) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(path);
  return m ? `.${m[1].toLowerCase()}` : "";
}

export function hasZipSignature(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export function hasPdfSignature(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

/** Entry arsip yang sudah diratakan (ZIP dalam ZIP ikut dibuka 1 level). */
interface FlatEntry {
  name: string;
  declaredSize: number;
  text(): Promise<string>;
  bytes(): Promise<Buffer>;
}

async function loadArchiveEntries(buffer: Buffer): Promise<FlatEntry[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await withTimeout(JSZip.loadAsync(buffer));
  const wrap = (entry: import("jszip").JSZipObject, name: string): FlatEntry => ({
    name,
    declaredSize: declaredUncompressedSize(entry),
    text: () => withTimeout(entry.async("string"), 8_000),
    bytes: async () => Buffer.from(await withTimeout(entry.async("nodebuffer"), 15_000)),
  });
  const out: FlatEntry[] = [];
  const nested: Array<{ name: string; entry: import("jszip").JSZipObject }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (/\.zip$/i.test(entry.name) && !shouldIgnorePath(entry.name)) nested.push({ name: entry.name, entry });
    else out.push(wrap(entry, entry.name));
  }
  // ZIP di dalam ZIP (umum: mahasiswa zip ulang folder hasil download). Dibuka 1 level saja.
  for (const n of nested.slice(0, MAX_NESTED_ZIPS)) {
    if (declaredUncompressedSize(n.entry) > MAX_ZIP_UNCOMPRESSED_BYTES) continue;
    try {
      const buf = Buffer.from(await withTimeout(n.entry.async("nodebuffer"), 15_000));
      if (!hasZipSignature(buf)) continue;
      const inner = await withTimeout(JSZip.loadAsync(buf));
      let count = 0;
      for (const ie of Object.values(inner.files)) {
        if (ie.dir) continue;
        if (++count > MAX_ZIP_ENTRIES) break;
        out.push(wrap(ie, `${n.name}${NESTED_ZIP_SEPARATOR}${ie.name}`));
      }
    } catch {
      out.push({ name: `${n.name}${NESTED_ZIP_SEPARATOR}[gagal dibuka]`, declaredSize: 0, text: async () => "", bytes: async () => Buffer.alloc(0) });
    }
  }
  return out;
}

/** Cocokkan path yang diminta model dengan entry (persis, tanpa case, atau akhiran path). */
function findEntry(entries: FlatEntry[], requested: string): FlatEntry | undefined {
  const lower = requested.toLowerCase();
  return (
    entries.find((e) => e.name === requested) ??
    entries.find((e) => e.name.toLowerCase() === lower) ??
    entries.find((e) => e.name.toLowerCase().endsWith(`/${lower}`) || e.name.toLowerCase().endsWith(`${NESTED_ZIP_SEPARATOR}${lower}`))
  );
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export async function extractDocx(buffer: Buffer, maxChars = DEFAULT_MAX_CHARS): Promise<ExtractResult> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File DOCX tidak valid.");
  const result = await withTimeout(mammoth.extractRawText({ buffer }));
  const { text, truncated } = sanitizeText(result.value, maxChars);
  return { content: text, charCount: text.length, kind: "guide", truncated };
}

export async function extractPdf(buffer: Buffer, maxChars = DEFAULT_MAX_CHARS): Promise<ExtractResult> {
  if (!hasPdfSignature(buffer)) throw new ApiRequestError(415, "File PDF tidak valid.");
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
  try {
    const result = await withTimeout(parser.getText());
    // pdf-parse v2 menyisipkan pemisah "-- n of m --" antar halaman.
    const raw = (result.text || "").replace(/\n*-- \d+ of \d+ --\n*/g, "\n\n");
    const { text, truncated } = sanitizeText(raw, maxChars);
    const scanned = result.total > 0 && text.replace(/\s+/g, "").length < PDF_SCAN_MIN_CHARS_PER_PAGE * result.total;
    const content = scanned
      ? `${text}${text ? "\n\n" : ""}[PDF ${result.total} halaman tanpa layer teks (kemungkinan hasil scan). Gunakan tampilan halaman sebagai gambar untuk membacanya.]`
      : text;
    return { content, charCount: text.length, kind: "guide", truncated, pdfPages: result.total, pdfScanned: scanned };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export interface PdfPageImage {
  page: number;
  width: number;
  height: number;
  /** PNG base64 (tanpa prefix data URL). */
  base64: string;
}

/**
 * Render halaman PDF ke PNG (untuk PDF hasil scan yang tidak punya layer teks).
 * Dipakai Admin AI supaya model vision bisa "membaca" halaman.
 */
export async function renderPdfPages(
  buffer: Buffer,
  options: { pages?: number[]; first?: number; maxPages?: number; desiredWidth?: number } = {},
): Promise<{ total: number; pages: PdfPageImage[] }> {
  if (!hasPdfSignature(buffer)) throw new ApiRequestError(415, "File PDF tidak valid.");
  const maxPages = Math.min(options.maxPages ?? PDF_RENDER_MAX_PAGES, PDF_RENDER_MAX_PAGES);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: 0 });
  try {
    const partial = options.pages?.filter((p) => Number.isInteger(p) && p > 0).slice(0, maxPages);
    const shot = await withTimeout(
      parser.getScreenshot({
        ...(partial?.length ? { partial } : { first: Math.min(options.first ?? maxPages, maxPages) }),
        desiredWidth: options.desiredWidth ?? PDF_RENDER_WIDTH,
      }),
      60_000,
    );
    return {
      total: shot.total,
      pages: shot.pages.map((p) => ({ page: p.pageNumber, width: p.width, height: p.height, base64: Buffer.from(p.data).toString("base64") })),
    };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/**
 * PPTX = ZIP berisi ppt/slides/slideN.xml. Ambil teks <a:t> per slide.
 * Format .ppt lama (binary) tidak didukung.
 */
export async function extractPptx(buffer: Buffer, maxChars = DEFAULT_MAX_CHARS): Promise<ExtractResult> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File PPTX tidak valid (format .ppt lama tidak didukung; simpan ulang sebagai .pptx).");
  const JSZip = (await import("jszip")).default;
  const zip = await withTimeout(JSZip.loadAsync(buffer));
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(/slide(\d+)/i.exec(a)?.[1] ?? 0) - Number(/slide(\d+)/i.exec(b)?.[1] ?? 0));
  if (!slides.length) throw new ApiRequestError(415, "PPTX tidak berisi slide yang bisa dibaca.");

  const decode = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const chunks: string[] = [];
  let total = 0;
  for (const [i, name] of slides.entries()) {
    if (total >= maxChars) break;
    const xml = await withTimeout(zip.files[name].async("string"), 8_000);
    // Paragraf <a:p> → baris; run <a:t> → teks.
    const paras = xml.split(/<\/a:p>/).map((p) =>
      [...p.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decode(m[1])).join(""),
    ).filter((line) => line.trim());
    // Catatan presenter (opsional)
    const notesName = `ppt/notesSlides/notesSlide${i + 1}.xml`;
    let notes = "";
    if (zip.files[notesName]) {
      const nx = await withTimeout(zip.files[notesName].async("string"), 5_000);
      notes = [...nx.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => decode(m[1])).join(" ").replace(/\s*\d+\s*$/, "").trim();
    }
    const block = `[Slide ${i + 1}]\n${paras.join("\n")}${notes ? `\n(Catatan: ${notes})` : ""}`;
    chunks.push(block);
    total += block.length;
  }
  const { text, truncated } = sanitizeText(chunks.join("\n\n"), maxChars);
  return { content: text, charCount: text.length, kind: "guide", truncated };
}

/**
 * Baca SATU file di dalam ZIP (path persis), dipakai Admin AI untuk review
 * kode secara utuh. Mendukung file teks/kode, DOCX, PDF, PPTX di dalam ZIP.
 */
export async function readZipEntry(
  buffer: Buffer,
  entryPath: string,
  maxChars = 40_000,
): Promise<{ path: string; size: number; content: string; truncated: boolean }> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File ZIP tidak valid.");
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (shouldIgnorePath(normalized)) throw new ApiRequestError(400, "Path tidak diizinkan.");
  const entries = await loadArchiveEntries(buffer);
  const entry = findEntry(entries, normalized);
  if (!entry) throw new ApiRequestError(404, `File "${entryPath}" tidak ada di dalam ZIP.`);
  if (entry.declaredSize > MAX_ZIP_ENTRY_BYTES) throw new ApiRequestError(413, "File di dalam ZIP terlalu besar.");

  const lower = entry.name.toLowerCase();
  if (/\.(docx|pdf|pptx)$/.test(lower)) {
    const buf = await entry.bytes();
    const inner = lower.endsWith(".docx") ? await extractDocx(buf, maxChars)
      : lower.endsWith(".pdf") ? await extractPdf(buf, maxChars)
      : await extractPptx(buf, maxChars);
    return { path: entry.name, size: buf.length, content: inner.content, truncated: inner.truncated };
  }
  const raw = await entry.text();
  const { text, truncated } = sanitizeText(raw, maxChars);
  return { path: entry.name, size: Buffer.byteLength(raw, "utf8"), content: text, truncated };
}

/** Ambil bytes mentah satu entry ZIP (mis. PDF untuk dirender). Mendukung ZIP bertingkat. */
export async function readZipEntryBytes(buffer: Buffer, entryPath: string): Promise<{ path: string; bytes: Buffer }> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File ZIP tidak valid.");
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (shouldIgnorePath(normalized)) throw new ApiRequestError(400, "Path tidak diizinkan.");
  const entry = findEntry(await loadArchiveEntries(buffer), normalized);
  if (!entry) throw new ApiRequestError(404, `File "${entryPath}" tidak ada di dalam ZIP.`);
  if (entry.declaredSize > MAX_ZIP_ENTRY_BYTES) throw new ApiRequestError(413, "File di dalam ZIP terlalu besar.");
  return { path: entry.name, bytes: await entry.bytes() };
}

/**
 * Baca BANYAK file di dalam ZIP sekaligus (untuk ekspor DOCX / review utuh).
 * `paths` kosong → semua file kode/teks + dokumen (dibatasi maxFiles).
 */
export async function readZipEntries(
  buffer: Buffer,
  options: { paths?: string[]; maxFiles?: number; maxCharsPerFile?: number } = {},
): Promise<Array<{ path: string; kind: "code" | "doc"; content: string; truncated: boolean }>> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File ZIP tidak valid.");
  const maxFiles = options.maxFiles ?? 40;
  const perFile = options.maxCharsPerFile ?? 30_000;
  const wanted = options.paths?.map((p) => p.replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase());
  const entries = (await loadArchiveEntries(buffer))
    .filter((e) => !shouldIgnorePath(e.name) && e.declaredSize <= MAX_ZIP_ENTRY_BYTES)
    .filter((e) => (wanted?.length ? wanted.some((w) => e.name.toLowerCase() === w || e.name.toLowerCase().endsWith(`/${w}`) || e.name.toLowerCase().endsWith(`${NESTED_ZIP_SEPARATOR}${w}`)) : true))
    .filter((e) => TEXT_EXTENSIONS.test(e.name) || /\.(docx|pdf|pptx)$/i.test(e.name) || /(^|\/)README(\.|$)/i.test(e.name))
    .sort((a, b) => filePriority(a.name) - filePriority(b.name))
    .slice(0, maxFiles);

  const out: Array<{ path: string; kind: "code" | "doc"; content: string; truncated: boolean }> = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    try {
      if (/\.(docx|pdf|pptx)$/.test(lower)) {
        const buf = await entry.bytes();
        const inner = lower.endsWith(".docx") ? await extractDocx(buf, perFile)
          : lower.endsWith(".pdf") ? await extractPdf(buf, perFile)
          : await extractPptx(buf, perFile);
        out.push({ path: entry.name, kind: "doc", content: inner.content, truncated: inner.truncated });
      } else {
        const raw = await entry.text();
        totalBytes += Buffer.byteLength(raw, "utf8");
        if (totalBytes > MAX_ZIP_UNCOMPRESSED_BYTES) break;
        const { text, truncated } = sanitizeText(raw, perFile);
        out.push({ path: entry.name, kind: "code", content: text, truncated });
      }
    } catch {
      out.push({ path: entry.name, kind: "doc", content: "[gagal dibaca]", truncated: false });
    }
  }
  return out;
}

export async function extractZip(
  buffer: Buffer,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File ZIP tidak valid.");
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const perFile = options.maxCharsPerZipFile ?? DEFAULT_MAX_CHARS_PER_ZIP_FILE;

  const entries = await loadArchiveEntries(buffer);

  if (entries.length > MAX_ZIP_ENTRIES * 2) {
    throw new ApiRequestError(413, "Arsip berisi terlalu banyak file.");
  }

  // ZIP bomb defense
  let declaredTotal = 0;
  for (const entry of entries) {
    const size = entry.declaredSize;
    if (size > MAX_ZIP_ENTRY_BYTES) {
      throw new ApiRequestError(413, "Arsip memiliki file internal yang terlalu besar.");
    }
    declaredTotal += size;
  }
  if (
    declaredTotal > MAX_ZIP_UNCOMPRESSED_BYTES ||
    (buffer.length > 0 && declaredTotal / buffer.length > MAX_ZIP_RATIO)
  ) {
    throw new ApiRequestError(413, "Rasio kompresi arsip tidak aman untuk diproses.");
  }

  const visible = entries.filter((entry) => !shouldIgnorePath(entry.name));

  // Manifest: ekstensi, framework, tree
  const extCounts: Record<string, number> = {};
  const frameworks = new Set<string>();
  for (const entry of visible) {
    const ext = extOf(entry.name) || "(tanpa ekstensi)";
    extCounts[ext] = (extCounts[ext] || 0) + 1;
    for (const [re, name] of FRAMEWORK_MARKERS) {
      if (re.test(entry.name)) frameworks.add(name);
    }
  }
  const tree = visible.slice(0, 250).map((e) => e.name.replace(/[\r\n]/g, ""));

  // Entry yang bisa dibaca → urut prioritas
  const readable = visible
    .filter(
      (entry) =>
        TEXT_EXTENSIONS.test(entry.name) ||
        /(^|\/)(package|composer)\.json$/i.test(entry.name) ||
        /(^|\/)README(\.|$)/i.test(entry.name),
    )
    .sort((a, b) => filePriority(a.name) - filePriority(b.name))
    .slice(0, MAX_ZIP_FILES_READ);

  const header =
    `Struktur ZIP (${visible.length} file${frameworks.size ? `, stack: ${[...frameworks].join(", ")}` : ""}${visible.some((e) => e.name.includes(NESTED_ZIP_SEPARATOR)) ? `; entri "x.zip::path" berasal dari ZIP di dalam ZIP` : ""}):\n` +
    tree.map((p) => `- ${p}`).join("\n");
  const chunks: string[] = [header];
  let extractedBytes = 0;
  let total = header.length;

  for (const entry of readable) {
    if (total >= maxChars) break;
    const raw = await entry.text();
    extractedBytes += Buffer.byteLength(raw, "utf8");
    if (extractedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new ApiRequestError(413, "Isi arsip terlalu besar untuk diproses.");
    }
    const { text } = sanitizeText(raw, perFile);
    const block = `\n\n[File: ${entry.name.replace(/[\r\n]/g, "")}]\n${text}`;
    chunks.push(block);
    total += block.length;
  }

  // DOCX/PDF/PPTX di dalam ZIP (umum untuk tugas laporan), baca maksimal 3.
  const docs = visible
    .filter((e) => /\.(docx|pdf|pptx)$/i.test(e.name))
    .slice(0, 3);
  for (const entry of docs) {
    if (total >= maxChars) break;
    try {
      const buf = await entry.bytes();
      const budget = Math.min(perFile * 4, maxChars - total);
      const inner = /\.docx$/i.test(entry.name)
        ? await extractDocx(buf, budget)
        : /\.pptx$/i.test(entry.name)
          ? await extractPptx(buf, budget)
          : await extractPdf(buf, budget);
      const block = `\n\n[Dokumen: ${entry.name.replace(/[\r\n]/g, "")}]\n${inner.content}`;
      chunks.push(block);
      total += block.length;
    } catch {
      chunks.push(`\n\n[Dokumen: ${entry.name}, gagal dibaca]`);
    }
  }

  const { text, truncated } = sanitizeText(chunks.join(""), maxChars);
  return {
    content: text,
    charCount: text.length,
    kind: "code",
    truncated,
    zipManifest: {
      totalEntries: entries.length,
      readEntries: readable.length + docs.length,
      extCounts,
      frameworks: [...frameworks],
      tree,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Deteksi format dari nama + signature, lalu ekstrak.
 * Throw ApiRequestError(415) kalau format tidak didukung.
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const lower = fileName.toLowerCase();
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  if (lower.endsWith(".docx")) return extractDocx(buffer, maxChars);
  if (lower.endsWith(".pdf")) return extractPdf(buffer, maxChars);
  if (lower.endsWith(".pptx")) return extractPptx(buffer, maxChars);
  if (lower.endsWith(".ppt")) throw new ApiRequestError(415, "Format .ppt lama tidak didukung; unggah ulang sebagai .pptx atau PDF.");
  if (lower.endsWith(".zip")) return extractZip(buffer, options);
  if (TEXT_EXTENSIONS.test(lower)) {
    const { text, truncated } = sanitizeText(buffer.toString("utf8"), maxChars);
    const kind: ExtractKind = /readme|package/.test(lower) ? "code" : "note";
    return { content: text, charCount: text.length, kind, truncated };
  }
  // Fallback: DOCX/ZIP/PDF yang ekstensinya salah tapi signature benar.
  if (hasPdfSignature(buffer)) return extractPdf(buffer, maxChars);
  if (hasZipSignature(buffer)) return extractZip(buffer, options);

  throw new ApiRequestError(
    415,
    "Format belum didukung. Gunakan PDF, DOCX, PPTX, ZIP, TXT/MD/CSV/JSON, atau file kode.",
  );
}
