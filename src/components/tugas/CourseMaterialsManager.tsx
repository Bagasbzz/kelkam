"use client";

import { getErrorMessage } from "@/lib/errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Pencil, Trash2, Upload, X } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  deleteCourseMaterial,
  fetchCourseMaterials,
  updateCourseMaterial,
  uploadCourseMaterial,
  type CourseMaterial,
} from "@/lib/client/tugas-api";

const ACCEPT = [
  ".ppt", ".pptx", ".pdf", ".doc", ".docx",
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

const INPUT_CLASS = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";

function formatSize(size: number): string {
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function displayTitle(material: CourseMaterial): string {
  return material.title?.trim() || material.originalName;
}

export default function CourseMaterialsManager({ courseId, token }: { courseId: string; token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchCourseMaterials(courseId, token);
      setMaterials(result.materials);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Gagal memuat materi."));
    } finally {
      setLoading(false);
    }
  }, [courseId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setFile(null);
    setTitle("");
    setDescription("");
    setFormOpen(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onUpload() {
    if (!file) {
      setError("Pilih file materi dulu.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const material = await uploadCourseMaterial(courseId, file, { title: title.trim(), description: description.trim() });
      setMaterials((current) => [material, ...current]);
      resetForm();
    } catch (err) {
      setError(getErrorMessage(err, "Gagal mengunggah materi."));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(material: CourseMaterial) {
    setEditingId(material.id);
    setEditTitle(material.title || "");
    setEditDescription(material.description || "");
  }

  async function onSaveEdit(material: CourseMaterial) {
    setBusy(true);
    setError(null);
    try {
      const result = await updateCourseMaterial(courseId, material.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setMaterials((current) => current.map((item) => (item.id === material.id ? result.material : item)));
      setEditingId(null);
    } catch (err) {
      setError(getErrorMessage(err, "Gagal menyimpan materi."));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(material: CourseMaterial) {
    if (!window.confirm(`Hapus materi "${displayTitle(material)}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteCourseMaterial(courseId, material.id);
      setMaterials((current) => current.filter((item) => item.id !== material.id));
    } catch (err) {
      setError(getErrorMessage(err, "Gagal menghapus materi."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Materi pertemuan</h2>
          <p className="mt-1 text-sm text-slate-600">Upload PPT, PPTX, PDF, atau Word untuk diunduh mahasiswa. Beri judul dan keterangan supaya jelas isinya.</p>
        </div>
        {!formOpen && (
          <Button type="button" size="sm" icon={Upload} disabled={busy} onClick={() => setFormOpen(true)}>
            Upload materi
          </Button>
        )}
      </div>

      {formOpen && (
        <div className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <div>
            <label htmlFor="material-file" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600">File materi</label>
            <input
              id="material-file"
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              disabled={busy}
              className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-50"
              onChange={(event) => {
                const picked = event.target.files?.[0] || null;
                setFile(picked);
                if (picked && !title.trim()) setTitle(picked.name.replace(/\.[a-z0-9]+$/i, ""));
              }}
            />
            <p className="mt-1 text-xs text-slate-500">Maks 12 MB.</p>
          </div>
          <div>
            <label htmlFor="material-title" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600">Judul</label>
            <input
              id="material-title"
              className={INPUT_CLASS}
              value={title}
              maxLength={120}
              disabled={busy}
              placeholder="Contoh: Pertemuan 3: Kartu Hero dengan Python"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="material-description" className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600">Keterangan (opsional)</label>
            <textarea
              id="material-description"
              className={`${INPUT_CLASS} min-h-[72px] resize-y`}
              value={description}
              maxLength={600}
              disabled={busy}
              placeholder="Ringkas isi materi atau instruksi: apa yang harus dibaca, untuk tugas mana, dsb."
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" icon={Upload} isLoading={busy} disabled={!file || busy} onClick={() => void onUpload()}>
              Simpan materi
            </Button>
            <Button type="button" size="sm" variant="outline" icon={X} disabled={busy} onClick={resetForm}>
              Batal
            </Button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Memuat materi...</div>
      ) : materials.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-200 p-5 text-center text-sm text-slate-500">Belum ada materi.</p>
      ) : (
        <div className="mt-4 divide-y divide-slate-100">
          {materials.map((material) => (
            <div key={material.id} className="py-3">
              {editingId === material.id ? (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="truncate text-xs text-slate-500">{material.originalName}</p>
                  <input
                    className={INPUT_CLASS}
                    value={editTitle}
                    maxLength={120}
                    disabled={busy}
                    placeholder="Judul materi"
                    onChange={(event) => setEditTitle(event.target.value)}
                  />
                  <textarea
                    className={`${INPUT_CLASS} min-h-[64px] resize-y`}
                    value={editDescription}
                    maxLength={600}
                    disabled={busy}
                    placeholder="Keterangan (opsional)"
                    onChange={(event) => setEditDescription(event.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" isLoading={busy} disabled={busy} onClick={() => void onSaveEdit(material)}>Simpan</Button>
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditingId(null)}>Batal</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{displayTitle(material)}</p>
                      {material.description && (
                        <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{material.description}</p>
                      )}
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {material.title ? `${material.originalName} / ` : ""}{formatSize(material.size)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline" href={`/api/tugas/courses/${courseId}/materials/${material.id}/download?token=${encodeURIComponent(token)}`}>
                      <Download className="h-4 w-4" /> Unduh
                    </a>
                    <Button type="button" variant="outline" size="sm" icon={Pencil} disabled={busy} onClick={() => startEdit(material)} aria-label={`Ubah ${displayTitle(material)}`} />
                    <Button type="button" variant="outline" size="sm" icon={Trash2} disabled={busy} onClick={() => void onDelete(material)} aria-label={`Hapus ${displayTitle(material)}`} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}