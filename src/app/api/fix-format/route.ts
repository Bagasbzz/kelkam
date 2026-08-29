import { NextResponse } from "next/server";
import { parseThesisStructure } from "@/utils/structure-parser";
import mammoth from "mammoth";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

export const runtime = "nodejs";
export const maxDuration = 45;

const MAX_DOCX_BYTES = 10 * 1024 * 1024;

function isDocxBuffer(buffer: Buffer) {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ApiRequestError(408, "Dokumen membutuhkan waktu terlalu lama untuk dibaca.")),
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

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;

    if (!file) {
      return NextResponse.json({ error: "File tidak ditemukan." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".docx")) {
      throw new ApiRequestError(415, "Gunakan file DOCX.");
    }
    if (file.size <= 0 || file.size > MAX_DOCX_BYTES) {
      throw new ApiRequestError(413, "Ukuran DOCX harus di bawah 10 MB.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isDocxBuffer(buffer)) throw new ApiRequestError(415, "File DOCX tidak valid.");

    const { value: text } = await withTimeout(mammoth.extractRawText({ buffer }), 30_000);
    const parseResult = parseThesisStructure(text.slice(0, 500_000));

    return NextResponse.json(parseResult, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("API /api/fix-format failed:", error);
    return publicErrorResponse(error, "Terjadi kesalahan saat memproses dokumen.");
  }
}
