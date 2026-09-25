/**
 * src/components/tools/DocxToolsPanel.tsx
 * -----------------------------------------------------------------------------
 * Panel untuk tool DOCX (Word). Daftar tool:
 *   - DOCX → HTML
 *   - DOCX → Plain Text
 *   - DOCX → Markdown (best-effort)
 *   - HTML → DOCX (input textarea)
 *   - Text → DOCX (input textarea)
 * -----------------------------------------------------------------------------
 */

"use client";

import { useState } from "react";
import { FileDropzone, FileListPreview } from "@/components/ui/FileDropzone";
import { ToolPanelShell, RunButton, ResultBanner, type ToolDescriptor } from "./ToolPanelShell";
import { docxToHtml, docxToMarkdown, docxToText, htmlToDocx, textToDocx } from "@/lib/client/docx-tools";

const TOOLS: ToolDescriptor[] = [
  { id: "docx2html", label: "DOCX → HTML", description: "Convert file Word ke HTML." },
  { id: "docx2text", label: "DOCX → Text", description: "Ambil plain text dari Word." },
  { id: "docx2md", label: "DOCX → Markdown", description: "Best-effort markdown (heading heuristic)." },
  { id: "html2docx", label: "HTML → DOCX", description: "Tulis HTML, download sebagai Word." },
  { id: "text2docx", label: "Text → DOCX", description: "Tulis teks, download sebagai Word." },
];

export function DocxToolsPanel() {
  const [active, setActive] = useState("docx2html");
  const [files, setFiles] = useState<File[]>([]);
  const [html, setHtml] = useState("<h1>Halo</h1><p>Ini paragraf.</p>");
  const [text, setText] = useState("Halo dunia.\n\nIni paragraf kedua.");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "success" | "warn"; message: string } | null>(null);
  const tool = TOOLS.find((t) => t.id === active)!;

  const reset = () => {
    setFiles([]);
    setResult(null);
  };

  const onRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      switch (active) {
        case "docx2html": {
          if (!files[0]) throw new Error("Pilih file .docx dulu.");
          const out = await docxToHtml(files[0]);
          downloadText(out, "converted.html", "text/html");
          setResult({ tone: "info", message: `HTML ${out.length} karakter.` });
          break;
        }
        case "docx2text": {
          if (!files[0]) throw new Error("Pilih file .docx dulu.");
          const out = await docxToText(files[0]);
          downloadText(out, "extracted.txt", "text/plain;charset=utf-8");
          setResult({ tone: "info", message: `Text ${out.length} karakter.` });
          break;
        }
        case "docx2md": {
          if (!files[0]) throw new Error("Pilih file .docx dulu.");
          const out = await docxToMarkdown(files[0]);
          downloadText(out, "converted.md", "text/markdown;charset=utf-8");
          setResult({ tone: "info", message: `Markdown ${out.length} karakter.` });
          break;
        }
        case "html2docx": {
          await htmlToDocx(html);
          setResult({ tone: "success", message: "File .docx sudah di-download." });
          break;
        }
        case "text2docx": {
          await textToDocx(text);
          setResult({ tone: "success", message: "File .docx sudah di-download." });
          break;
        }
      }
    } catch (err) {
      setResult({ tone: "warn", message: err instanceof Error ? err.message : "Gagal." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolPanelShell
      tools={TOOLS}
      active={active}
      onSelect={(id) => {
        setActive(id);
        reset();
      }}
      title="DOCX Tools"
      subtitle={tool.description}
      filePicker={
        active !== "html2docx" && active !== "text2docx" ? (
          <div className="mb-4">
            <FileDropzone
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onFiles={setFiles}
              hint="1 file .docx"
            />
            <FileListPreview files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />
          </div>
        ) : null
      }
      children={
        active === "html2docx" ? (
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            rows={10}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
            placeholder="<p>Tulis HTML di sini...</p>"
          />
        ) : active === "text2docx" ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
            placeholder="Tulis teks di sini..."
          />
        ) : null
      }
      runButton={<RunButton busy={busy} disabled={false} onClick={onRun} label="Proses" />}
      result={result && <ResultBanner tone={result.tone}>{result.message}</ResultBanner>}
    />
  );
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}