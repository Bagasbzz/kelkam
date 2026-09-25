/**
 * src/components/tools/ImageToolsPanel.tsx
 * -----------------------------------------------------------------------------
 * Panel untuk tool Image. Daftar tool:
 *   - Convert Format (PNG/JPG/WebP)
 *   - Compress ke target MB
 *   - Resize (custom dimensi)
 *   - Crop (custom rectangle)
 *   - Image → Base64
 *   - Base64 → Image
 *   - Batch Compress (.zip)
 * -----------------------------------------------------------------------------
 */

"use client";

import { useState } from "react";
import { FileDropzone, FileListPreview } from "@/components/ui/FileDropzone";
import { ToolPanelShell, RunButton, ResultBanner, type ToolDescriptor } from "./ToolPanelShell";
import {
  base64ToImage,
  batchCompressImages,
  compressImage,
  convertImageFormat,
  cropImage,
  imageToBase64,
  resizeImage,
  type ImageFormat,
} from "@/lib/client/image-tools";

const TOOLS: ToolDescriptor[] = [
  { id: "convert", label: "Convert Format", description: "PNG / JPG / WebP.", multiple: true },
  { id: "compress", label: "Compress", description: "Target ukuran maksimal (MB)." },
  { id: "resize", label: "Resize", description: "Custom dimensi (width × height)." },
  { id: "crop", label: "Crop", description: "Crop rectangle (x,y,w,h)." },
  { id: "toBase64", label: "Image → Base64", description: "Ambil data URL dari image." },
  { id: "fromBase64", label: "Base64 → Image", description: "Convert data URL ke file image." },
  { id: "batchCompress", label: "Batch Compress", description: "Kompres banyak image → .zip.", multiple: true },
];

export function ImageToolsPanel() {
  const [active, setActive] = useState("convert");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "success" | "warn"; message: string } | null>(null);

  // Tool-specific state
  const [format, setFormat] = useState<ImageFormat>("image/png");
  const [maxMb, setMaxMb] = useState(1);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [cropRect, setCropRect] = useState("0,0,400,400");
  const [dataUrl, setDataUrl] = useState("");

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
        case "convert": {
          if (files.length === 0) throw new Error("Pilih minimal 1 image.");
          for (const f of files) await convertImageFormat(f, format);
          setResult({ tone: "success", message: `${files.length} image di-convert ke ${format}.` });
          break;
        }
        case "compress": {
          if (!files[0]) throw new Error("Pilih 1 image.");
          await compressImage(files[0], maxMb);
          setResult({ tone: "success", message: "Image di-compress." });
          break;
        }
        case "resize": {
          if (!files[0]) throw new Error("Pilih 1 image.");
          await resizeImage(files[0], width, height);
          setResult({ tone: "success", message: `Resized ke ${width}×${height}.` });
          break;
        }
        case "crop": {
          if (!files[0]) throw new Error("Pilih 1 image.");
          const parts = cropRect.split(",").map((n) => Number(n.trim()));
          if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
            throw new Error("Format crop: 4 angka dipisah koma.");
          }
          await cropImage(files[0], { x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
          setResult({ tone: "success", message: "Image di-crop." });
          break;
        }
        case "toBase64": {
          if (!files[0]) throw new Error("Pilih 1 image.");
          const url = await imageToBase64(files[0]);
          setDataUrl(url);
          navigator.clipboard?.writeText(url).catch(() => undefined);
          setResult({ tone: "info", message: `Data URL ${url.length} karakter (disalin ke clipboard).` });
          break;
        }
        case "fromBase64": {
          if (!dataUrl.trim()) throw new Error("Paste data URL dulu.");
          base64ToImage(dataUrl, "decoded.png");
          setResult({ tone: "success", message: "Image di-download." });
          break;
        }
        case "batchCompress": {
          if (files.length === 0) throw new Error("Pilih minimal 1 image.");
          await batchCompressImages(files, maxMb);
          setResult({ tone: "success", message: `${files.length} image di-zip.` });
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
      title="Image Tools"
      subtitle={tool.description}
      filePicker={
        active !== "fromBase64" ? (
          <div className="mb-4">
            <FileDropzone
              accept="image/*"
              multiple={tool.multiple ?? false}
              onFiles={setFiles}
              hint={tool.multiple ? "Bisa pilih banyak image" : "1 image"}
            />
            <FileListPreview files={files} onRemove={(i) => setFiles(files.filter((_, idx) => idx !== i))} />
          </div>
        ) : null
      }
      children={
        <div className="space-y-4">
          {active === "convert" && (
            <FormatPicker value={format} onChange={setFormat} />
          )}
          {(active === "compress" || active === "batchCompress") && (
            <NumberInput label="Target max (MB)" value={maxMb} onChange={setMaxMb} min={0.05} max={50} step={0.1} />
          )}
          {active === "resize" && (
            <div className="grid grid-cols-2 gap-3">
              <NumberInput label="Width (px)" value={width} onChange={setWidth} min={16} max={8192} step={1} />
              <NumberInput label="Height (px)" value={height} onChange={setHeight} min={16} max={8192} step={1} />
            </div>
          )}
          {active === "crop" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Crop rectangle (x, y, w, h)
              </label>
              <input
                value={cropRect}
                onChange={(e) => setCropRect(e.target.value)}
                className="w-full rounded-2xl bg-slate-50 border-2 border-transparent px-6 py-3 font-mono text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
                placeholder="0,0,400,400"
              />
            </div>
          )}
          {active === "fromBase64" && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
                Data URL
              </label>
              <textarea
                value={dataUrl}
                onChange={(e) => setDataUrl(e.target.value)}
                rows={6}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
                placeholder="data:image/png;base64,..."
              />
            </div>
          )}
          {active === "toBase64" && dataUrl && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1 px-1">Preview</p>
              <code className="block break-all text-xs text-slate-700 line-clamp-3">{dataUrl}</code>
            </div>
          )}
        </div>
      }
      runButton={<RunButton busy={busy} disabled={false} onClick={onRun} label="Proses" />}
      result={result && <ResultBanner tone={result.tone}>{result.message}</ResultBanner>}
    />
  );
}

function FormatPicker({ value, onChange }: { value: ImageFormat; onChange: (v: ImageFormat) => void }) {
  const options: { v: ImageFormat; label: string }[] = [
    { v: "image/png", label: "PNG" },
    { v: "image/jpeg", label: "JPG" },
    { v: "image/webp", label: "WebP" },
  ];
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
        Format output
      </label>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition ${
              value === o.v
                ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                : "bg-slate-50 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 mb-2">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-2xl bg-slate-50 border-2 border-transparent px-6 py-3 text-sm focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 outline-none"
      />
    </div>
  );
}