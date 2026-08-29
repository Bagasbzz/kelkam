import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { authenticateRequest } from "@/lib/server/auth";
import {
  ApiRequestError,
  enforceRateLimit,
  publicErrorResponse,
} from "@/lib/server/request-guards";
import { isSensitivePath, redactSensitiveText } from "@/lib/security/redact-secrets";

export const maxDuration = 60;
export const runtime = "nodejs";

const TEXT_EXTENSIONS = /\.(txt|md|csv|json|js|jsx|ts|tsx|php|py|java|sql|html|css|xml|yml|yaml|log)$/i;
const MAX_CHARS = 60_000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 400;
const MAX_ZIP_FILES_READ = 80;
const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_UNCOMPRESSED_BYTES = 24 * 1024 * 1024;
const MAX_ZIP_RATIO = 80;
const PARSER_TIMEOUT_MS = 30_000;

function truncate(text: string, max = MAX_CHARS) {
  const cleaned = redactSensitiveText(text)
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n\n[Dipangkas otomatis: file terlalu panjang. Sisakan bagian terpenting jika ingin hasil lebih presisi.]`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = PARSER_TIMEOUT_MS) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiRequestError(408, "File membutuhkan waktu terlalu lama untuk dibaca.")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isSafeArchivePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) return false;
  return !normalized.split("/").some((part) => part === "..");
}

function shouldIgnorePath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  return (
    !isSafeArchivePath(normalized) ||
    isSensitivePath(normalized) ||
    normalized.includes("node_modules/") ||
    normalized.includes(".git/") ||
    normalized.includes(".next/") ||
    normalized.includes("dist/") ||
    normalized.includes("build/")
  );
}

function treeFromPaths(paths: string[]) {
  return paths
    .filter((path) => !shouldIgnorePath(path))
    .slice(0, 250)
    .map((path) => `- ${path.replace(/[\r\n]/g, "")}`)
    .join("\n");
}

function declaredUncompressedSize(entry: unknown) {
  const size = Number((entry as { _data?: { uncompressedSize?: number } })?._data?.uncompressedSize || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function parseZip(buffer: Buffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await withTimeout(JSZip.loadAsync(buffer));
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);

  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new ApiRequestError(413, "Arsip berisi terlalu banyak file.");
  }

  let declaredTotal = 0;
  for (const entry of entries) {
    const size = declaredUncompressedSize(entry);
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

  const paths = entries.map((entry) => entry.name);
  const readable = entries
    .filter((entry) => !shouldIgnorePath(entry.name))
    .filter(
      (entry) =>
        TEXT_EXTENSIONS.test(entry.name) ||
        /(^|\/)package\.json$/i.test(entry.name) ||
        /(^|\/)README(\.|$)/i.test(entry.name),
    )
    .slice(0, MAX_ZIP_FILES_READ);

  const chunks: string[] = [`Struktur ZIP/project:\n${treeFromPaths(paths)}`];
  let extractedBytes = 0;

  for (const entry of readable) {
    const text = await withTimeout(entry.async("string"), 8_000);
    extractedBytes += Buffer.byteLength(text, "utf8");
    if (extractedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new ApiRequestError(413, "Isi arsip terlalu besar untuk diproses.");
    }
    chunks.push(`\n\n[File: ${entry.name.replace(/[\r\n]/g, "")}]\n${truncate(text, 5_000)}`);
  }

  return truncate(chunks.join(""));
}

function hasZipSignature(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function hasPdfSignature(buffer: Buffer) {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export async function POST(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;

  const rateLimit = enforceRateLimit(`context-extract:${authentication.auth.user.id}`, {
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;

    if (!file) {
      return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 400 });
    }

    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new ApiRequestError(413, "Ukuran file harus di bawah 12 MB.");
    }

    const name = file.name.replace(/[\r\n]/g, "").slice(0, 200);
    if (!name || isSensitivePath(name)) {
      throw new ApiRequestError(400, "File rahasia atau credential tidak boleh diunggah.");
    }

    const lowerName = name.toLowerCase();
    if (TEXT_EXTENSIONS.test(lowerName) && file.size > MAX_TEXT_FILE_BYTES) {
      throw new ApiRequestError(413, "File teks harus di bawah 4 MB.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    let content = "";
    let kind = "note";

    if (lowerName.endsWith(".docx")) {
      if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File DOCX tidak valid.");
      const result = await withTimeout(mammoth.extractRawText({ buffer }));
      content = truncate(result.value);
      kind = "guide";
    } else if (lowerName.endsWith(".pdf")) {
      if (!hasPdfSignature(buffer)) throw new ApiRequestError(415, "File PDF tidak valid.");
      type PdfParseResult = { text?: string };
      type PdfParseFunction = (input: Buffer) => Promise<PdfParseResult>;
      const pdfParseModule = (await import("pdf-parse")) as unknown as {
        default?: PdfParseFunction;
      } & PdfParseFunction;
      const pdfParse: PdfParseFunction = pdfParseModule.default || pdfParseModule;
      const result = await withTimeout(pdfParse(buffer));
      content = truncate(result.text || "");
      kind = "guide";
    } else if (lowerName.endsWith(".zip")) {
      if (!hasZipSignature(buffer)) throw new ApiRequestError(415, "File ZIP tidak valid.");
      content = await parseZip(buffer);
      kind = "code";
    } else if (TEXT_EXTENSIONS.test(lowerName)) {
      content = truncate(buffer.toString("utf8"));
      kind = lowerName.includes("readme") || lowerName.includes("package") ? "code" : "note";
    } else {
      throw new ApiRequestError(
        415,
        "Format belum didukung. Gunakan PDF, DOCX, ZIP, TXT/MD/CSV/JSON, atau file kode.",
      );
    }

    if (!content.trim()) {
      return NextResponse.json(
        { success: false, error: "File berhasil dibaca, tapi tidak ada teks yang bisa diekstrak." },
        { status: 422 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          title: name,
          fileName: name,
          kind,
          content: `[Ekstrak otomatis dari ${name}]\n${content}`,
          charCount: content.length,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("API /api/context/extract failed:", error);
    return publicErrorResponse(error, "Gagal membaca file konteks.");
  }
}
