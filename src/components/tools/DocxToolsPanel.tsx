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
import { docxToHtml, docxToMarkdown, docxToText } from "@/lib/client/docx-tools";

const TOOLS: ToolDescriptor[] = [
  { id: "docx2html", label: "DOCX → HTML", description: "Convert file Word ke HTML." },
  { id: "docx2text", label: "DOCX → Text", description: "Ambil plain text dari Word." },
  { id: "docx2md", label: "DOCX → Markdown", description: "Best-effort markdown (heading heuristic)." },
];

export function DocxToolsPanel() {
  const [active, setActive] = useState("docx2html");
  const [files, setFiles] = useState<File[]>([]);
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
        <div className="mb-4">
          <FileDropzone
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onFiles={setFiles}
            hint="1 file .docx"
          />
          <FileListPreview files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />
        </div>
      }
      children={null}
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