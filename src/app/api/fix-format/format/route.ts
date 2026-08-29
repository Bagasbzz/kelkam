import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { ApiRequestError, publicErrorResponse } from "@/lib/server/request-guards";

export const runtime = "nodejs";
export const maxDuration = 60;

const PYTHON_CANDIDATES: Array<{ command: string; args: string[] }> = [
  process.env.PYTHON_EXECUTABLE ? { command: process.env.PYTHON_EXECUTABLE, args: [] } : null,
  { command: "python", args: [] },
  { command: "py", args: ["-3"] },
].filter(Boolean) as Array<{ command: string; args: string[] }>;
const MAX_DOCX_BYTES = 10 * 1024 * 1024;
const FORMATTER_TIMEOUT_MS = 45_000;
const MAX_STDERR_CHARS = 8_000;

function safeName(fileName: string) {
  const base = path.basename(fileName, path.extname(fileName)).replace(/[^a-zA-Z0-9-_]+/g, "-");
  return `${base || "dokumen"}-rapi.docx`;
}

async function runFormatter(inputPath: string, outputPath: string) {
  const scriptPath = path.join(process.cwd(), "scripts", "format_docx.py");
  let lastError = "Python formatter gagal dijalankan.";

  for (const candidate of PYTHON_CANDIDATES) {
    const result = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
      const child = spawn(candidate.command, [...candidate.args, scriptPath, inputPath, outputPath], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let stderr = "";
      let settled = false;
      const finish = (value: { ok: boolean; stderr: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish({ ok: false, stderr: "Formatter melewati batas waktu." });
      }, FORMATTER_TIMEOUT_MS);

      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk || "")}`.slice(-MAX_STDERR_CHARS);
      });

      child.on("error", (error) => {
        finish({ ok: false, stderr: error.message || String(error) });
      });

      child.on("close", (code) => {
        finish({ ok: code === 0, stderr });
      });
    });

    if (result.ok) return;
    lastError = result.stderr || lastError;
  }

  throw new Error(lastError);
}

export async function POST(req: Request) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "keluhkampus-format-"));
  const inputPath = path.join(tempDir, "input.docx");
  const outputPath = path.join(tempDir, "output.docx");

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

    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);
    if (inputBuffer.length < 4 || inputBuffer[0] !== 0x50 || inputBuffer[1] !== 0x4b) {
      throw new ApiRequestError(415, "File DOCX tidak valid.");
    }
    await fs.writeFile(inputPath, inputBuffer);
    await runFormatter(inputPath, outputPath);
    const buffer = await fs.readFile(outputPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName(file.name)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("API /api/fix-format/format Error:", error);
    return publicErrorResponse(error, "Terjadi kesalahan saat memformat dokumen.");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
