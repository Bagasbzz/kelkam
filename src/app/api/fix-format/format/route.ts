import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

export const runtime = "nodejs";
export const maxDuration = 60;

const PYTHON_CANDIDATES: Array<{ command: string; args: string[] }> = [
  process.env.PYTHON_EXECUTABLE ? { command: process.env.PYTHON_EXECUTABLE, args: [] } : null,
  { command: "python", args: [] },
  { command: "py", args: ["-3"] },
].filter(Boolean) as Array<{ command: string; args: string[] }>;

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
      });

      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });

      child.on("error", (error) => {
        resolve({ ok: false, stderr: error.message || String(error) });
      });

      child.on("close", (code) => {
        resolve({ ok: code === 0, stderr });
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
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith(".docx")) {
      return NextResponse.json({ error: "Please upload a .docx file" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    await fs.writeFile(inputPath, Buffer.from(arrayBuffer));
    await runFormatter(inputPath, outputPath);
    const buffer = await fs.readFile(outputPath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeName(file.name)}"`,
      },
    });
  } catch (error: any) {
    console.error("API /api/fix-format/format Error:", error);
    return NextResponse.json({ error: error?.message || "Terjadi kesalahan saat memformat dokumen." }, { status: 500 });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
