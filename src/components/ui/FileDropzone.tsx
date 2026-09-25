/**
 * src/components/ui/FileDropzone.tsx
 * -----------------------------------------------------------------------------
 * Generic drag-and-drop file picker.
 *
 * KHUSUS UNTUK BROWSER-SIDE TOOLS (PDF/DOCX/Image di /tools) — JANGAN pakai
 * untuk upload ke server. Untuk upload submission, pakai SubmissionForm
 * yang udah handle /api/files/upload + hashing + id.
 *
 * Props:
 *   - accept: string accept attribute (mis. ".pdf", "image/*", ".docx,.pdf")
 *   - multiple: boleh lebih dari 1 file
 *   - onFiles: callback dengan File[] saat user drop atau pilih
 *   - maxBytes: optional, warn (bukan block) kalau file lewat batas
 *
 * Visual: dashed border slate-200 default, blue-300 saat drag-over.
 * Drag handling native HTML5, tidak butuh library tambahan.
 * -----------------------------------------------------------------------------
 */

"use client";

import { useCallback, useId, useRef, useState, type DragEvent } from "react";
import { FileText, Upload, X } from "lucide-react";
import { formatFileSize } from "@/lib/file-limits";

interface FileDropzoneProps {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  maxBytes?: number;
  hint?: string;
}

export function FileDropzone({
  accept,
  multiple = false,
  onFiles,
  maxBytes,
  hint,
}: FileDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      setError(null);
      if (!multiple && files.length > 1) {
        setError("Hanya boleh 1 file.");
        return;
      }
      if (maxBytes) {
        const over = files.find((f) => f.size > maxBytes);
        if (over) {
          setError(`${over.name} lebih dari ${formatFileSize(maxBytes)}.`);
          return;
        }
      }
      onFiles(files);
    },
    [multiple, maxBytes, onFiles],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDrag(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(true);
  }, []);

  const onDragLeave = useCallback(() => setDrag(false), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset supaya pilih file yang sama lagi masih trigger onChange.
      if (inputRef.current) inputRef.current.value = "";
    },
    [handleFiles],
  );

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={`rounded-2xl border-2 border-dashed transition-all ${
          drag
            ? "border-blue-400 bg-blue-50/60"
            : "border-slate-200 bg-slate-50 hover:border-blue-200 hover:bg-blue-50/30"
        }`}
      >
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 px-6 py-8 text-sm text-slate-500"
        >
          <Upload className="h-6 w-6 text-blue-500" aria-hidden />
          <span>
            Drag file ke sini, atau{" "}
            <span className="font-bold text-blue-600">klik untuk pilih</span>
          </span>
          {hint && <span className="text-xs text-slate-400">{hint}</span>}
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={accept}
            multiple={multiple}
            onChange={onInputChange}
            className="hidden"
          />
        </label>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          <X className="h-3 w-3" aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

interface FileListPreviewProps {
  files: File[];
  onRemove?: (index: number) => void;
}

export function FileListPreview({ files, onRemove }: FileListPreviewProps) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2">
      {files.map((f, i) => (
        <li
          key={`${f.name}-${i}`}
          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-blue-500" aria-hidden />
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-700">{f.name}</p>
              <p className="text-xs text-slate-400">{formatFileSize(f.size)}</p>
            </div>
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-red-600"
              aria-label={`Hapus ${f.name}`}
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}