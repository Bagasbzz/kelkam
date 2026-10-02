"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  deleteCourseMaterial,
  fetchCourseMaterials,
  uploadCourseMaterial,
  type CourseMaterial,
} from "@/lib/client/tugas-api";

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function CourseMaterialsManager({ courseId, token }: { courseId: string; token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await fetchCourseMaterials(courseId, token);
      setMaterials(result.materials);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat materi.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [courseId, token]);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const material = await uploadCourseMaterial(courseId, file);
      setMaterials((current) => [material, ...current]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah materi.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(material: CourseMaterial) {
    if (!window.confirm(`Hapus materi "${material.originalName}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCourseMaterial(courseId, material.id);
      setMaterials((current) => current.filter((item) => item.id !== material.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus materi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Materi pertemuan</h2>
          <p className="mt-1 text-sm text-slate-600">Upload PPT, PPTX, atau PDF untuk diunduh mahasiswa.</p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Upload materi
          <input
            ref={inputRef}
            type="file"
            accept=".ppt,.pptx,.pdf,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="sr-only"
            disabled={busy}
            onChange={(event) => void onUpload(event.target.files?.[0])}
          />
        </label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat materi...</div>
      ) : materials.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">Belum ada materi.</p>
      ) : (
        <div className="mt-4 divide-y divide-slate-100">
          {materials.map((material) => (
            <div key={material.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-blue-600" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{material.originalName}</p>
                  <p className="text-xs text-slate-500">{formatSize(material.size)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline" href={`/api/tugas/courses/${courseId}/materials/${material.id}/download?token=${encodeURIComponent(token)}`}>
                  <Download className="h-4 w-4" /> Unduh
                </a>
                <Button type="button" variant="outline" size="sm" icon={Trash2} disabled={busy} onClick={() => void onDelete(material)} aria-label={`Hapus ${material.originalName}`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}