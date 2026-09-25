/**
 * src/components/tools/PDFToolsPanel.tsx
 * -----------------------------------------------------------------------------
 * Panel untuk 10 tool PDF. Mengikuti pola ToolPanelShell: sidebar daftar
 * tool + content area. State internal pakai useState biasa (tidak perlu
 * useReducer — jumlah state kecil per tool).
 *
 * Catatan warna: SEMUA primary action biru (blue-600) untuk harmonisasi
 * dengan design system. Banner info/success/warn dari ToolPanelShell.
 * -----------------------------------------------------------------------------
 */

"use client";

import { useState } from "react";
import { FileDropzone, FileListPreview } from "@/components/ui/FileDropzone";
import { ToolPanelShell, RunButton, ResultBanner, type ToolDescriptor } from "./ToolPanelShell";
import {
  addPageNumbers,
  compressPdf,
  cropPdf,
  extractPdfText,
  imagesToPdf,
  mergePdfs,
  pdfToImages,
  rotatePdf,
  splitPdf,
  watermarkPdf,
} from "@/lib/client/pdf-tools";

const TOOLS: ToolDescriptor[] = [
  { id: "merge", label: "Merge PDF", description: "Gabung beberapa PDF jadi satu file.", multiple: true },
  { id: "split", label: "Split PDF", description: "Ambil halaman tertentu (mis. 1-3,5)." },
  { id: "compress", label: "Compress PDF", description: "Optimalkan ukuran file PDF." },
  { id: "pdf2img", label: "PDF → Images", description: "Setiap halaman jadi PNG (download .zip)." },
  { id: "img2pdf", label: "Images → PDF", description: "Gabung beberapa image jadi satu PDF.", multiple: true },
  { id: "rotate", label: "Rotate PDF", description: "Putar semua halaman 90/180/270 derajat." },
  { id: "watermark", label: "Watermark", description: "Tambah teks watermark diagonal." },
  { id: "extract", label: "Extract Text", description: "Ambil plain text dari PDF." },
  { id: "pages", label: "Nomor Halaman", description: "Tambah footer X/Y di setiap halaman." },
  { id: "crop", label: "Crop PDF", description: "Crop area tertentu dari setiap halaman." },
];

export function PDFToolsPanel() {
  const [active, setActive] = useState("merge");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "success" | "warn"; message: string } | null>(null);

  const tool = TOOLS.find((t) => t.id === active)!;
  const requireFiles = !["img2pdf"].includes(active);

  const reset = () => {
    setFiles([]);
    setResult(null);
  };

  const onRun = async () => {
    if (requireFiles && files.length === 0) {
      setResult({ tone: "warn", message: "Pilih minimal 1 file dulu." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await runTool(active, files, setResult);
      setResult((r) => r ?? { tone: "success", message: "Selesai. File sudah di-download." });
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
      title="PDF Tools"
      subtitle={tool.description}
      filePicker={
        <div className="mb-4">
          <FileDropzone
            accept=".pdf,application/pdf"
            multiple={tool.multiple ?? false}
            onFiles={setFiles}
            hint={tool.multiple ? "Bisa pilih beberapa file PDF" : "1 file PDF"}
          />
          <FileListPreview files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />
        </div>
      }
      children={<ToolOptions active={active} onResult={setResult} />}
      runButton={
        <RunButton
          busy={busy}
          disabled={false}
          onClick={onRun}
          label={actionLabel(active)}
        />
      }
      result={result && <ResultBanner tone={result.tone}>{result.message}</ResultBanner>}
    />
  );
}

function actionLabel(id: string): string {
  const map: Record<string, string> = {
    merge: "Gabung PDF",
    split: "Split PDF",
    compress: "Kompres",
    pdf2img: "Convert ke Images",
    img2pdf: "Convert ke PDF",
    rotate: "Putar",
    watermark: "Tambah Watermark",
    extract: "Ambil Text",
    pages: "Tambah Nomor",
    crop: "Crop",
  };
  return map[id] ?? "Proses";
}

interface RunToolOpts {
  active: string;
  files: File[];
  setResult: (r: { tone: "info" | "success" | "warn"; message: string } | null) => void;
}

async function runTool(
  id: string,
  files: File[],
  setResult: (r: { tone: "info" | "success" | "warn"; message: string } | null) => void,
): Promise<void> {
  switch (id) {
    case "merge":
      await mergePdfs(files);
      return;
    case "split": {
      const range = window.prompt("Range halaman (contoh: 1-3,5,7-9)") ?? "";
      await splitPdf(files[0], range);
      return;
    }
    case "compress":
      await compressPdf(files[0]);
      return;
    case "pdf2img":
      await pdfToImages(files[0]);
      return;
    case "img2pdf":
      await imagesToPdf(files);
      return;
    case "rotate": {
      const raw = window.prompt("Sudut rotasi (90 / 180 / 270)?", "90") ?? "90";
      const angle = Number(raw);
      if (![90, 180, 270].includes(angle)) throw new Error("Sudut harus 90/180/270.");
      await rotatePdf(files[0], angle);
      return;
    }
    case "watermark": {
      const text = window.prompt("Teks watermark?", "CONFIDENTIAL") ?? "";
      await watermarkPdf(files[0], text);
      return;
    }
    case "extract": {
      const text = await extractPdfText(files[0]);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      saveAsBlob(blob, "extracted.txt");
      setResult({ tone: "info", message: `Berhasil extract ${text.length} karakter.` });
      return;
    }
    case "pages":
      await addPageNumbers(files[0]);
      return;
    case "crop": {
      const raw = window.prompt(
        "Crop box (x,y,w,h) — pisahkan dengan koma:",
        "0,0,400,600",
      ) ?? "0,0,400,600";
      const parts = raw.split(",").map((n) => Number(n.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("Format crop: 4 angka dipisah koma.");
      }
      await cropPdf(files[0], { x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
      return;
    }
  }
}

function saveAsBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Per-tool options (extra inputs inline). Saat ini masih pakai window.prompt
// — untuk iterasi berikutnya bisa ganti ke inline form yang lebih ramah.
// Tetap di-render supaya shell tidak berubah bentuk.
// ---------------------------------------------------------------------------

function ToolOptions({ active }: { active: string; onResult: (r: { tone: "info" | "success" | "warn"; message: string } | null) => void }) {
  return (
    <div className="mt-2 text-xs text-slate-500">
      {active === "split" && <p>Setelah klik proses, masukkan range halaman (mis. <code>1-3,5</code>).</p>}
      {active === "rotate" && <p>Setelah klik proses, masukkan sudut: 90 / 180 / 270.</p>}
      {active === "watermark" && <p>Setelah klik proses, masukkan teks watermark.</p>}
      {active === "crop" && <p>Setelah klik proses, masukkan koordinat <code>x,y,w,h</code>.</p>}
      {(active === "merge" || active === "compress" || active === "pdf2img" || active === "img2pdf" || active === "pages" || active === "extract") && (
        <p>Langsung klik tombol proses — semua parameter ada di file yang dipilih.</p>
      )}
    </div>
  );
}