import { NextResponse } from "next/server";
import mammoth from "mammoth";

export const maxDuration = 60;
export const runtime = "nodejs";

const TEXT_EXTENSIONS = /\.(txt|md|csv|json|js|jsx|ts|tsx|php|py|java|sql|html|css|xml|yml|yaml|env|log)$/i;
const MAX_CHARS = 60_000;
const MAX_ZIP_FILES = 80;

function truncate(text: string, max = MAX_CHARS) {
  const cleaned = text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}\n\n[Dipangkas otomatis: file terlalu panjang. Sisakan bagian terpenting jika ingin hasil lebih presisi.]`;
}

function treeFromPaths(paths: string[]) {
  return paths
    .filter((path) => !path.includes("node_modules/") && !path.includes(".git/"))
    .slice(0, 250)
    .map((path) => `- ${path}`)
    .join("\n");
}

async function parseZip(buffer: Buffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const paths = entries.map((entry) => entry.name);
  const readable = entries
    .filter((entry) => TEXT_EXTENSIONS.test(entry.name) || /(^|\/)package\.json$/i.test(entry.name) || /(^|\/)README(\.|$)/i.test(entry.name))
    .filter((entry) => !entry.name.includes("node_modules/") && !entry.name.includes(".git/"))
    .slice(0, MAX_ZIP_FILES);

  const chunks: string[] = [`Struktur ZIP/project:\n${treeFromPaths(paths)}`];
  for (const entry of readable) {
    const text = await entry.async("string");
    chunks.push(`\n\n[File: ${entry.name}]\n${truncate(text, 5000)}`);
  }

  return truncate(chunks.join(""));
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, error: "File tidak ditemukan." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const name = file.name;
    const lowerName = name.toLowerCase();
    let content = "";
    let kind = "note";

    if (lowerName.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      content = truncate(result.value);
      kind = "guide";
    } else if (lowerName.endsWith(".pdf")) {
      const pdfParseModule: any = await import("pdf-parse");
      const pdfParse = pdfParseModule.default || pdfParseModule;
      const result = await pdfParse(buffer);
      content = truncate(result.text);
      kind = "guide";
    } else if (lowerName.endsWith(".zip")) {
      content = await parseZip(buffer);
      kind = "code";
    } else if (TEXT_EXTENSIONS.test(lowerName)) {
      content = truncate(buffer.toString("utf8"));
      kind = lowerName.includes("readme") || lowerName.includes("package") ? "code" : "note";
    } else {
      return NextResponse.json({ success: false, error: "Format belum didukung. Gunakan PDF, DOCX, ZIP, TXT/MD/CSV/JSON, atau file kode." }, { status: 400 });
    }

    if (!content.trim()) {
      return NextResponse.json({ success: false, error: "File berhasil dibaca, tapi tidak ada teks yang bisa diekstrak." }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      data: {
        title: name,
        fileName: name,
        kind,
        content: `[Ekstrak otomatis dari ${name}]\n${content}`,
        charCount: content.length,
      },
    });
  } catch (error: any) {
    console.error("API /api/context/extract Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Gagal membaca file konteks." },
      { status: 500 }
    );
  }
}
