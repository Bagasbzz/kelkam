/**
 * Tool file untuk Asisten Laporan: membuka ulang bahan yang diunggah user
 * (ZIP proyek, PDF, DOCX, PPTX, gambar) secara utuh, bukan hanya ringkasan
 * ekstraksi awal. Setara tool file Asisten Dosen, tapi lingkupnya bahan sesi.
 *
 * Keamanan:
 *   - File hanya dibaca bila fileId tercatat di bahan sesi DAN ownerId cocok
 *     (readUpload mengecek pemilik) → anti IDOR.
 *   - Path ZIP divalidasi di extract-text (Zip Slip, file sensitif, ZIP bomb).
 *   - Isi file adalah data tidak tepercaya; engine memindai injeksi di hasil tool.
 */
import { prisma } from "@/lib/db/prisma";
import { readUpload } from "@/lib/storage/upload";
import {
  detectImageMime, extractImagesFromFile, extractTextFromBuffer, hasPdfSignature, hasZipSignature,
  listZipEntries, readZipEntries, readZipEntry, readZipEntryBytes, renderPdfPages,
} from "@/lib/server/extract-text";
import { exportZipForUser, MAX_ZIP_OUTPUT_BYTES, safeZipSegment, type ZipItem } from "@/lib/server/tugas/export-zip";
import { TOOL_IMAGES_KEY, type AgentAttachment, type ToolImage } from "@/lib/server/agent-runs/engine";
import { toPng } from "@/lib/server/image-convert";

export interface MaterialRef { id: string; title: string; fileName?: string; fileId?: string; kind: string }

export interface MaterialToolContext {
  ownerId: string;
  materials: MaterialRef[];
  emit: (text: string) => void;
  attachments: AgentAttachment[];
}

type Result = Record<string, unknown>;

const VIEW_MAX = 6;
/** Gambar ke model vision dibatasi (base64 menambah ±33%). */
const VISION_MAX_BYTES = 4 * 1024 * 1024;
/** Batas file bahan yang dimuat ke memori untuk dibuka ulang. */
const MAX_MATERIAL_BYTES = 60 * 1024 * 1024;

const OFFICE_RE = /\.(docx|pptx|xlsx)$/i;

/** Cari bahan berdasarkan id, judul, atau nama file (model sering memakai nama). */
function findMaterial(ctx: MaterialToolContext, ref: unknown): MaterialRef {
  const key = typeof ref === "string" ? ref.trim().toLowerCase() : "";
  if (!key) throw new Error("Berikan materialId (lihat daftar bahan di state).");
  const m = ctx.materials.find((x) => x.id.toLowerCase() === key)
    ?? ctx.materials.find((x) => x.fileName?.toLowerCase() === key || x.title.toLowerCase() === key)
    ?? ctx.materials.find((x) => x.title.toLowerCase().includes(key) || (x.fileName || "").toLowerCase().includes(key));
  if (!m) throw new Error(`Bahan "${String(ref).slice(0, 80)}" tidak ada. Bahan tersedia: ${ctx.materials.map((x) => `${x.id} (${x.fileName || x.title})`).join(", ") || "belum ada"}.`);
  return m;
}

/** Muat bytes file asli bahan. Bahan lama (sebelum fileId disimpan) hanya punya teks ringkasan. */
async function loadMaterialBytes(ctx: MaterialToolContext, ref: unknown) {
  const m = findMaterial(ctx, ref);
  if (!m.fileId) {
    throw new Error(`Bahan "${m.title}" diunggah sebelum fitur ini ada, file aslinya tidak tersimpan. Minta user mengunggah ulang file tersebut agar bisa dibuka utuh.`);
  }
  const meta = await prisma.fileUpload.findFirst({ where: { id: m.fileId, ownerId: ctx.ownerId }, select: { size: true, originalName: true } });
  if (!meta) throw new Error("File bahan tidak ditemukan di penyimpanan.");
  if (meta.size > MAX_MATERIAL_BYTES) throw new Error(`File terlalu besar untuk dibuka (> ${MAX_MATERIAL_BYTES / 1048576} MB).`);
  const buffer = await readUpload(m.fileId, ctx.ownerId);
  if (!buffer) throw new Error("File bahan tidak bisa dibaca.");
  return { m, buffer, name: m.fileName || meta.originalName };
}

const isPlainZip = (buffer: Buffer, name: string) => hasZipSignature(buffer) && !OFFICE_RE.test(name);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Daftar file di dalam ZIP bahan (per folder), untuk menjelajah proyek besar. */
async function listMaterialFiles(ctx: MaterialToolContext, args: Result): Promise<Result> {
  const { m, buffer, name } = await loadMaterialBytes(ctx, args.materialId);
  if (!isPlainZip(buffer, name)) throw new Error(`Bahan "${m.title}" bukan ZIP. Gunakan readMaterialFile tanpa path untuk membaca isinya.`);
  const r = await listZipEntries(buffer, { filter: typeof args.folder === "string" ? args.folder : undefined, offset: Number(args.offset) || 0, limit: Number(args.limit) || 300 });
  ctx.emit(`Melihat isi ZIP ${name}${args.folder ? ` (folder ${String(args.folder).slice(0, 60)})` : ""}: ${r.total} file`);
  return {
    materialId: m.id, file: name, totalFile: r.total, diabaikan: r.ignored,
    catatanDiabaikan: r.ignored ? "node_modules, vendor, .git, build, dan cache tidak ditampilkan." : undefined,
    files: r.files.map((f) => `${f.path} (${Math.max(1, Math.round(f.size / 1024))} KB)`),
    adaLanjutan: (Number(args.offset) || 0) + r.files.length < r.total,
  };
}

/**
 * Baca isi bahan secara utuh:
 *  - ZIP + path → satu file (kode/DOCX/PDF/PPTX/XLSX di dalam ZIP)
 *  - ZIP + paths[] → beberapa file sekaligus
 *  - file biasa → teks lengkap dengan offset (paging)
 */
async function readMaterialFile(ctx: MaterialToolContext, args: Result): Promise<Result> {
  const { m, buffer, name } = await loadMaterialBytes(ctx, args.materialId);
  const maxChars = Math.min(Math.max(Number(args.maxChars) || 20_000, 500), 40_000);
  const path = typeof args.path === "string" ? args.path.trim() : "";
  const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && !!p.trim()).slice(0, 12) : [];

  if (isPlainZip(buffer, name) && (path || paths.length)) {
    if (path && !paths.length) {
      const r = await readZipEntry(buffer, path, maxChars);
      ctx.emit(`Membaca ${r.path} dari ${name}`);
      return { materialId: m.id, file: r.path, ukuran: r.size, terpotong: r.truncated, isi: r.content };
    }
    const all = [...new Set([path, ...paths].filter(Boolean))];
    const perFile = Math.max(1_500, Math.floor(maxChars / all.length));
    const entries = await readZipEntries(buffer, { paths: all, maxFiles: all.length, maxCharsPerFile: perFile });
    ctx.emit(`Membaca ${entries.length} file dari ${name}`);
    const found = new Set(entries.map((e) => e.path.toLowerCase()));
    return {
      materialId: m.id,
      files: entries.map((e) => ({ path: e.path, terpotong: e.truncated, isi: e.content })),
      tidakDitemukan: all.filter((p) => ![...found].some((f) => f === p.toLowerCase() || f.endsWith(`/${p.toLowerCase()}`))),
    };
  }

  if (detectImageMime(buffer)) {
    return { materialId: m.id, file: name, isi: "", catatan: "Bahan berupa gambar. Panggil viewMaterialPages untuk melihatnya langsung." };
  }

  const offset = Math.max(Number(args.offset) || 0, 0);
  // ZIP tanpa path: ringkasan struktur + file inti dengan jatah lebih besar dari unggahan awal.
  const ex = await extractTextFromBuffer(buffer, name, { maxChars: offset + maxChars + 1, maxCharsPerZipFile: 8_000 });
  ctx.emit(`Membaca isi ${name}`);
  return {
    materialId: m.id, file: name,
    ...(ex.zipManifest ? { stack: ex.zipManifest.frameworks, totalFile: ex.zipManifest.totalEntries } : {}),
    ...(ex.pdfPages ? { halaman: ex.pdfPages } : {}),
    totalKarakter: ex.content.length, offset,
    isi: ex.content.slice(offset, offset + maxChars),
    adaLanjutan: ex.truncated || offset + maxChars < ex.content.length,
    saran: ex.pdfScanned
      ? "PDF hasil scan. Panggil viewMaterialPages untuk melihat halamannya sebagai gambar."
      : ex.zipManifest ? "Untuk file lain di ZIP, panggil listMaterialFiles lalu readMaterialFile dengan path." : undefined,
  };
}

/** Lihat halaman PDF / gambar bahan sebagai gambar (model vision). */
async function viewMaterialPages(ctx: MaterialToolContext, args: Result): Promise<Result> {
  const { m, buffer, name } = await loadMaterialBytes(ctx, args.materialId);
  const path = typeof args.path === "string" ? args.path.trim() : "";
  let bytes = buffer;
  let label = name;
  if (path) {
    if (!hasZipSignature(buffer)) throw new Error("Bahan bukan ZIP; jangan isi path.");
    const entry = await readZipEntryBytes(buffer, path);
    bytes = entry.bytes;
    label = entry.path;
  }

  // Gambar tunggal (file gambar atau gambar di dalam ZIP).
  if (detectImageMime(bytes)) {
    const png = bytes.length > VISION_MAX_BYTES ? (await toPng(bytes, { maxWidth: 1600 })).bytes : bytes;
    const mime = png === bytes ? detectImageMime(bytes)! : "image/png";
    ctx.emit(`Melihat gambar ${label}`);
    return { materialId: m.id, file: label, catatan: "Gambar dikirim di pesan berikutnya.", [TOOL_IMAGES_KEY]: [{ dataUrl: `data:${mime};base64,${png.toString("base64")}`, label }] satisfies ToolImage[] };
  }

  let pdf: Buffer | null = hasPdfSignature(bytes) ? bytes : null;
  if (!pdf && isPlainZip(bytes, label)) {
    const files = await listZipEntries(bytes, { limit: 1_000 });
    const first = files.files.find((f) => /\.pdf$/i.test(f.path));
    if (!first) throw new Error("Tidak ada PDF di ZIP ini. Isi path gambar/PDF (lihat listMaterialFiles).");
    const entry = await readZipEntryBytes(bytes, first.path);
    pdf = entry.bytes;
    label = entry.path;
  }
  if (!pdf) throw new Error("Bahan bukan PDF/gambar. Untuk DOCX/PPTX pakai extractMaterialImages (gambar di dalamnya) atau readMaterialFile (teks).");

  const pages = Array.isArray(args.pages) ? args.pages.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, VIEW_MAX) : undefined;
  const r = await renderPdfPages(pdf, { pages, first: Math.min(Math.max(Number(args.first) || 4, 1), VIEW_MAX), maxPages: VIEW_MAX });
  ctx.emit(`Membuka ${r.pages.length} halaman ${label} sebagai gambar`);
  return {
    materialId: m.id, file: label, totalHalaman: r.total, halamanDitampilkan: r.pages.map((p) => p.page),
    catatan: "Halaman dikirim sebagai gambar di pesan berikutnya. Untuk halaman lain panggil lagi dengan pages=[n,...].",
    [TOOL_IMAGES_KEY]: r.pages.map((p) => ({ dataUrl: `data:image/png;base64,${p.base64}`, label: `${label} hal. ${p.page}` })) satisfies ToolImage[],
  };
}

/**
 * Ambil gambar dari bahan (screenshot di DOCX/PDF/PPTX, gambar di ZIP).
 * show → tampilkan ke model; saveZip → paket ZIP untuk diunduh user.
 * Path gambar di hasil bisa dipakai addMaterialFigure untuk dimasukkan ke laporan.
 */
async function extractMaterialImages(ctx: MaterialToolContext, args: Result): Promise<Result> {
  const { m, buffer, name } = await loadMaterialBytes(ctx, args.materialId);
  const r = await extractImagesFromFile(buffer, name, { maxImages: 80, pathFilter: typeof args.path === "string" ? args.path : undefined });
  ctx.emit(`Mengambil ${r.images.length} gambar dari ${name}`);
  const images: ToolImage[] = [];
  if (args.show !== false) {
    const start = Math.max((Number(args.showFrom) || 1) - 1, 0);
    for (const [i, img] of r.images.entries()) {
      if (i < start || images.length >= VIEW_MAX || img.bytes.length > VISION_MAX_BYTES) continue;
      images.push({ dataUrl: `data:${img.mime};base64,${img.bytes.toString("base64")}`, label: `gambar ${i + 1} (${img.path})` });
    }
  }
  let zip: Result | null = null;
  if (args.saveZip === true && r.images.length) {
    let total = 0;
    const items: ZipItem[] = [];
    for (const img of r.images) {
      if (total + img.bytes.length > MAX_ZIP_OUTPUT_BYTES) break;
      items.push({ path: img.path, bytes: img.bytes });
      total += img.bytes.length;
    }
    const out = await exportZipForUser(ctx.ownerId, typeof args.fileName === "string" && args.fileName.trim() ? args.fileName : `Gambar_${safeZipSegment(name)}`, items);
    ctx.attachments.push({ fileId: out.fileId, name: out.name, url: out.url, size: out.size });
    zip = { name: out.name, url: out.url, jumlahFile: out.jumlahFile };
  }
  return {
    materialId: m.id, file: name, jumlahGambar: r.images.length, terpotong: r.truncated,
    daftarGambar: r.images.slice(0, 100).map((img, i) => ({ no: i + 1, path: img.path, ukuranKB: Math.max(1, Math.round(img.bytes.length / 1024)), ...(img.width ? { lebar: img.width, tinggi: img.height } : {}), ...(img.page ? { halaman: img.page } : {}) })),
    ...(r.skipped.length ? { dilewati: r.skipped.slice(0, 15) } : {}),
    ...(images.length ? { gambarDitampilkan: images.length, [TOOL_IMAGES_KEY]: images } : {}),
    ...(zip ? { zip, catatanZip: "Tautan ZIP tampil otomatis di chat." } : {}),
  };
}

/** Paket ZIP berisi file bahan asli (dan/atau gambar hasil ekstraksi) untuk diunduh user. */
async function packageMaterialsZip(ctx: MaterialToolContext, args: Result): Promise<Result> {
  const ids = Array.isArray(args.materialIds) && args.materialIds.length ? args.materialIds : ctx.materials.filter((x) => x.fileId).map((x) => x.id);
  if (!ids.length) throw new Error("Belum ada bahan dengan file asli untuk dipaketkan.");
  const includeImages = args.includeImages === true;
  const items: ZipItem[] = [];
  let total = 0;
  const skipped: string[] = [];
  const add = (path: string, bytes: Buffer) => {
    if (total + bytes.length > MAX_ZIP_OUTPUT_BYTES) throw new Error(`Total isi ZIP melebihi ${MAX_ZIP_OUTPUT_BYTES / 1048576} MB.`);
    total += bytes.length;
    items.push({ path, bytes });
  };
  for (const id of ids.slice(0, 25)) {
    try {
      const { buffer, name } = await loadMaterialBytes(ctx, id);
      add(`bahan/${name}`, buffer);
      if (includeImages) {
        const r = await extractImagesFromFile(buffer, name, { maxImages: 60 });
        for (const img of r.images) add(`gambar/${safeZipSegment(name)}/${img.path}`, img.bytes);
      }
    } catch (err) {
      skipped.push(`${String(id)}: ${err instanceof Error ? err.message : "gagal"}`);
    }
  }
  if (!items.length) throw new Error(`Tidak ada file yang bisa dipaketkan. ${skipped.join("; ")}`);
  const out = await exportZipForUser(ctx.ownerId, typeof args.fileName === "string" && args.fileName.trim() ? args.fileName : "Bahan_laporan", items);
  ctx.attachments.push({ fileId: out.fileId, name: out.name, url: out.url, size: out.size });
  ctx.emit(`ZIP ${out.name} siap (${out.jumlahFile} file)`);
  return { ok: true, name: out.name, url: out.url, jumlahFile: out.jumlahFile, ...(skipped.length ? { dilewati: skipped } : {}), catatan: "Tautan unduhan tampil otomatis di chat." };
}

/**
 * Ambil satu gambar dari bahan sebagai PNG (untuk disisipkan ke laporan).
 * Dipakai addMaterialFigure di assistant: hasilnya disimpan sebagai FileUpload.
 */
export async function materialImageAsPng(ctx: MaterialToolContext, materialRef: unknown, path?: string): Promise<{ png: Buffer; label: string; material: MaterialRef }> {
  const { m, buffer, name } = await loadMaterialBytes(ctx, materialRef);
  let bytes: Buffer | null = null;
  let label = name;
  if (detectImageMime(buffer)) {
    bytes = buffer;
  } else {
    // Cocokkan dengan path dari extractMaterialImages (termasuk gambar di DOCX/PDF).
    const r = await extractImagesFromFile(buffer, name, { maxImages: 200 });
    const want = (path || "").trim().toLowerCase();
    const hit = want ? r.images.find((img) => img.path.toLowerCase() === want) ?? r.images.find((img) => img.path.toLowerCase().endsWith(want)) : r.images[0];
    if (!hit) throw new Error(`Gambar "${path || ""}" tidak ditemukan di ${name}. Panggil extractMaterialImages untuk melihat daftar path.`);
    bytes = hit.bytes;
    label = hit.path;
  }
  const png = await toPng(bytes, { maxWidth: 2000 });
  return { png: png.bytes, label, material: m };
}

export const MATERIAL_TOOL_IMPL: Record<string, (ctx: MaterialToolContext, args: Result) => Promise<Result>> = {
  listMaterialFiles,
  readMaterialFile,
  viewMaterialPages,
  extractMaterialImages,
  packageMaterialsZip,
};

const materialIdProp = { type: "string", description: "id bahan (mis. m1abc) atau nama file, lihat 'materials' di state." } as const;

export const MATERIAL_TOOL_DEFS = [
  {
    type: "function" as const,
    function: {
      name: "listMaterialFiles",
      description: "Daftar file di dalam bahan ZIP (proyek kode). node_modules/vendor/build otomatis diabaikan. Pakai folder untuk menelusuri bagian tertentu (mis. 'src/app', 'routes').",
      parameters: { type: "object", properties: { materialId: materialIdProp, folder: { type: "string" }, offset: { type: "number" }, limit: { type: "number", description: "default 300, maks 1000" } }, required: ["materialId"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "readMaterialFile",
      description: "Baca isi bahan user secara UTUH. ZIP: isi path (satu file) atau paths (maks 12 file) dari listMaterialFiles. File biasa (PDF/DOCX/PPTX/XLSX/teks): tanpa path, pakai offset untuk halaman berikutnya. Wajib dipakai sebelum menjelaskan kode/isi bahan secara spesifik.",
      parameters: {
        type: "object",
        properties: { materialId: materialIdProp, path: { type: "string" }, paths: { type: "array", items: { type: "string" } }, offset: { type: "number" }, maxChars: { type: "number", description: "default 20000, maks 40000" } },
        required: ["materialId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "viewMaterialPages",
      description: "Lihat bahan sebagai gambar: halaman PDF (termasuk PDF scan) atau file gambar, juga yang ada di dalam ZIP (isi path). Maks 6 halaman per panggilan.",
      parameters: { type: "object", properties: { materialId: materialIdProp, path: { type: "string" }, pages: { type: "array", items: { type: "number" } }, first: { type: "number" } }, required: ["materialId"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "extractMaterialImages",
      description: "Ambil gambar dari bahan (screenshot di DOCX/PDF/PPTX, gambar di ZIP). show=true menampilkan maks 6 ke model (showFrom untuk berikutnya). saveZip=true membuat ZIP gambar untuk diunduh user. Path hasilnya dipakai addMaterialFigure.",
      parameters: {
        type: "object",
        properties: { materialId: materialIdProp, path: { type: "string", description: "Filter folder/file di ZIP (opsional)." }, show: { type: "boolean" }, showFrom: { type: "number" }, saveZip: { type: "boolean" }, fileName: { type: "string" } },
        required: ["materialId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "packageMaterialsZip",
      description: "Bungkus file bahan asli (dan opsional gambar hasil ekstraksi) menjadi satu ZIP yang bisa diunduh user.",
      parameters: { type: "object", properties: { materialIds: { type: "array", items: { type: "string" }, description: "Kosong = semua bahan." }, includeImages: { type: "boolean" }, fileName: { type: "string" } } },
    },
  },
];
