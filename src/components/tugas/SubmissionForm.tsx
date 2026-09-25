"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Hash,
  Upload,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import KelasPicker from "./KelasPicker";
import PositionBadge from "./PositionBadge";
import { useAuth } from "@/components/AuthProvider";
import {
  fetchMySubmission,
  submitTugas,
  uploadSubmissionFile,
  type SubmissionRow,
} from "@/lib/client/tugas-api";
import { MAX_FILE_BYTES, formatFileSize } from "@/lib/file-limits";

interface SubmissionFormProps {
  tugasId: string;
  /** List kelas untuk dipilih. */
  classes: { id: string; name: string }[];
  /**
   * Kalau tugas restricted ke 1 kelas, pre-select dan disable picker.
   * Optional.
   */
  lockedClassId?: string | null;
  /** Callback setelah submit sukses (refresh halaman, dll). */
  onSubmitted?: (submission: SubmissionRow, position: number, total: number) => void;
}

function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_BYTES) return `Ukuran file maksimal ${formatFileSize(MAX_FILE_BYTES)}.`;
    if (!f.name || f.name.length > 200) return "Nama file tidak valid.";
    return null;
  }

export default function SubmissionForm({
  tugasId,
  classes,
  lockedClassId,
  onSubmitted,
}: SubmissionFormProps) {
  const { user, openLoginModal } = useAuth();
  const [classId, setClassId] = useState<string | null>(lockedClassId ?? null);
  const [nim, setNim] = useState("");
  const [name, setName] = useState(user?.name ?? "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [existing, setExisting] = useState<SubmissionRow | null>(null);
  const [count, setCount] = useState(0);
  const [position, setPosition] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Pre-fill nama kalau user login & AuthProvider kasih name.
  useEffect(() => {
    if (user?.name && !name) setName(user.name);
  }, [user, name]);

  // Load existing submission kalau user login.
  useEffect(() => {
    if (!user) {
      setExisting(null);
      setPosition(null);
      setCount(0);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchMySubmission(tugasId);
        if (cancelled) return;
        setExisting(data.submission);
        setCount(data.count);
        setPosition(data.myPosition);
      } catch {
        // Diam — bukan error fatal, form masih bisa submit.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tugasId]);

  if (!user) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <h3 className="text-lg font-bold text-slate-900">Login untuk mengumpulkan</h3>
        <p className="mt-1 text-sm text-slate-600">
          Kamu perlu masuk akun dulu sebelum bisa submit tugas.
        </p>
        <div className="mt-4">
          <Button onClick={openLoginModal} variant="primary" size="md">
            Masuk Sekarang
          </Button>
        </div>
      </div>
    );
  }

  function validateFile(f: File): string | null {
    if (f.size > MAX_FILE_BYTES) return `Ukuran file maksimal ${formatFileSize(MAX_FILE_BYTES)}.`;
    if (!f.name || f.name.length > 200) return "Nama file tidak valid.";
    return null;
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const f = e.target.files?.[0] ?? null;
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateFile(f);
    if (err) {
      setFileError(err);
      setFile(null);
      return;
    }
    setFile(f);
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!classId) {
      setError("Pilih kelas dulu.");
      return;
    }
    if (!nim.trim() || nim.trim().length < 3) {
      setError("Isi NIM dulu (min. 3 karakter).");
      return;
    }
    if (!name.trim()) {
      setError("Isi nama dulu.");
      return;
    }
    if (!file && !note.trim()) {
      setError("Isi catatan teks ATAU upload file.");
      return;
    }

    setBusy(true);
    try {
      let fileUploadId: string | undefined;
      if (file) {
        const up = await uploadSubmissionFile(file);
        fileUploadId = up.fileId;
      }
      const result = await submitTugas(tugasId, {
        classId,
        nim: nim.trim(),
        name: name.trim(),
        note: note.trim() || undefined,
        fileUploadId,
      });
      setExisting(result.submission);
      setPosition(result.position);
      setCount(result.total);
      setSuccess(true);
      setFile(null);
      setNote("");
      onSubmitted?.(result.submission, result.position, result.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal submit.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (existing) {
    return (
      <div className="space-y-3">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-bold text-emerald-800">Sudah dikumpulkan</h3>
          </div>
          <p className="mt-2 text-sm text-emerald-700">
            Kamu submit pada{" "}
            <strong>
              {new Date(existing.submittedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
            </strong>{" "}
            sebagai <strong>{existing.name}</strong> ({existing.nim}) kelas{" "}
            <strong>{existing.class.name}</strong>.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PositionBadge position={existing.position} total={count} />
            {existing.status === "LATE" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                <AlertCircle className="w-3 h-3" />
                Telat (tapi tetap disimpan)
              </span>
            )}
          </div>
          {existing.note && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-bold text-emerald-700">
                Lihat catatan
              </summary>
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-white p-3 text-sm text-slate-700">
                {existing.note}
              </p>
            </details>
          )}
          {existing.fileUpload && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <FileText className="w-4 h-4 text-blue-500" />
              {existing.fileUpload.originalName}
              <span className="text-slate-400">
                ({formatFileSize(existing.fileUpload.size)})
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
    >
      <div>
        <h3 className="text-lg font-bold text-slate-900">Kumpulkan Tugas</h3>
        <p className="text-xs text-slate-500">
          Isi kelas, NIM, nama. Tambah catatan teks dan/atau upload file.
        </p>
      </div>

      <div>
        <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">
          Kelas
        </label>
        <KelasPicker
          options={classes}
          value={classId}
          onChange={(id) => setClassId(id)}
          disabledId={lockedClassId ?? undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
            NIM
          </label>
          <Input
            value={nim}
            onChange={(e) => setNim(e.target.value)}
            placeholder="23/xxxxxxx/PA/xxxxx"
            autoComplete="off"
            maxLength={40}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
            Nama
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama lengkap"
            autoComplete="name"
            maxLength={120}
            required
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
          Catatan (opsional)
        </label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Tambah catatan untuk asdos..."
          rows={3}
          maxLength={8000}
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">
          Upload File (opsional)
        </label>
        {!file ? (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 transition hover:border-blue-200 hover:bg-blue-50/50">
            <Upload className="w-5 h-5" />
            <span>Klik untuk pilih file (maks {formatFileSize(MAX_FILE_BYTES)})</span>
            <input
              type="file"
              className="hidden"
              onChange={onPickFile}
              accept="*/*"
            />
          </label>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <div className="flex min-w-0 items-center gap-2">
              <FileText className="w-5 h-5 shrink-0 text-blue-500" />
              <div className="min-w-0">
                <p className="truncate font-bold text-slate-700">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {formatFileSize(file.size)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearFile}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
              aria-label="Hapus file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {fileError && (
          <p className="mt-1 text-xs text-red-600">{fileError}</p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Tugas berhasil dikumpulkan.</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        {position !== null ? (
          <PositionBadge position={position} total={count} />
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Hash className="w-3 h-3" />
            Posisi kamu akan muncul di sini
          </span>
        )}
        <Button
          type="submit"
          variant="primary"
          size="md"
          isLoading={busy}
          disabled={busy}
        >
          {busy ? "Mengirim..." : "Kumpulkan"}
        </Button>
      </div>
    </form>
  );
}