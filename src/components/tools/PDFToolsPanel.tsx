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

  // Per-tool option state
  const [splitRange, setSplitRange] = useState("1-3");
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [cropRect, setCropRect] = useState("0,0,400,600");

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
      const info = await runTool(active, files, { splitRange, rotateAngle, watermarkText, cropRect });
      setResult(info ? { tone: "info", message: info } : { tone: "success", message: "Selesai. File sudah di-download." });
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
      children={
        <div className="space-y-4">
          {active === "split" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Range halaman
              </label>
              <input
                value={splitRange}
                onChange={(e) => setSplitRange(e.target.value)}
                placeholder="1-3,5,7-9"
                className="w-full rounded-2xl bg-slate-50 border-2 border-transparent px-6 py-3 font-mono text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
              />
              <p className="mt-2 text-xs text-slate-500 px-2">Contoh: <code>1-3,5</code> → halaman 1,2,3,5.</p>
            </div>
          )}
          {active === "rotate" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Sudut rotasi
              </label>
              <div className="flex gap-2">
                {([90, 180, 270] as const).map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => setRotateAngle(deg)}
                    className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition ${
                      rotateAngle === deg
                        ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                        : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>
          )}
          {active === "watermark" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Teks watermark
              </label>
              <input
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="CONFIDENTIAL"
                className="w-full rounded-2xl bg-slate-50 border-2 border-transparent px-6 py-3 text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
              />
            </div>
          )}
          {active === "crop" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Crop box (x, y, w, h) — pisahkan dengan koma
              </label>
              <input
                value={cropRect}
                onChange={(e) => setCropRect(e.target.value)}
                placeholder="0,0,400,600"
                className="w-full rounded-2xl bg-slate-50 border-2 border-transparent px-6 py-3 font-mono text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
              />
            </div>
          )}
        </div>
      }
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

async function runTool(
  id: string,
  files: File[],
  opts: { splitRange: string; rotateAngle: 90 | 180 | 270; watermarkText: string; cropRect: string },
): Promise<string | null> {
  switch (id) {
    case "merge":
      await mergePdfs(files);
      return null;
    case "split":
      await splitPdf(files[0], opts.splitRange);
      return null;
    case "compress":
      await compressPdf(files[0]);
      return null;
    case "pdf2img":
      await pdfToImages(files[0]);
      return null;
    case "img2pdf":
      await imagesToPdf(files);
      return null;
    case "rotate":
      await rotatePdf(files[0], opts.rotateAngle);
      return null;
    case "watermark":
      await watermarkPdf(files[0], opts.watermarkText);
      return null;
    case "extract": {
      const text = await extractPdfText(files[0]);
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      saveAsBlob(blob, "extracted.txt");
      return `Berhasil extract ${text.length} karakter.`;
    }
    case "pages":
      await addPageNumbers(files[0]);
      return null;
    case "crop": {
      const parts = opts.cropRect.split(",").map((n) => Number(n.trim()));
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new Error("Format crop: 4 angka dipisah koma (x,y,w,h).");
      }
      await cropPdf(files[0], { x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
      return null;
    }
    default:
      return null;
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