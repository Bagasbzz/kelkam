"use client";

import { getErrorMessage } from "@/lib/errors";
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  MessageSquareText,
  Pencil,
  Upload,
  X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import KelasPicker from "./KelasPicker";
import PositionBadge from "./PositionBadge";
import { useAuth } from "@/components/AuthProvider";
import {
  ApiClientError,
  fetchMySubmission,
  submitTugas,
  updateMySubmission,
  uploadSubmissionFile,
  type SubmissionRow,
} from "@/lib/client/tugas-api";
import { MAX_FILE_BYTES, formatFileSize } from "@/lib/file-limits";

interface SubmissionFormProps {
  tugasId: string;
  /** Batas waktu tugas (ISO). Dipakai untuk memutuskan boleh ubah atau tidak. */
  deadline: string;
  /** Daftar kelas untuk dipilih. */
  classes: { id: string; name: string }[];
  /** Kalau tugas hanya untuk satu kelas, kelas itu dipilih otomatis dan dikunci. */
  lockedClassId?: string | null;
  onSubmitted?: (submission: SubmissionRow, position: number, total: number) => void;
}

function formatWaktu(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function validateFile(f: File): string | null {
  if (f.size > MAX_FILE_BYTES) return `Ukuran file maksimal ${formatFileSize(MAX_FILE_BYTES)}.`;
  if (!f.name || f.name.length > 200) return "Nama file tidak valid.";
  return null;
}

export default function SubmissionForm({
  tugasId,
  deadline,
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
  /** Saat mode ubah: true kalau file lama sengaja dilepas. */
  const [dropExistingFile, setDropExistingFile] = useState(false);

  const [existing, setExisting] = useState<SubmissionRow | null>(null);
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [popup, setPopup] = useState<{ position: number; total: number; edited: boolean } | null>(null);

  const deadlinePassed = new Date(deadline).getTime() < Date.now();

  useEffect(() => {
    if (user?.name && !name) setName(user.name);
  }, [user, name]);

  useEffect(() => {
    if (!user) {
      setExisting(null);
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
      } catch {
        // Tidak fatal — form tetap bisa dipakai.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tugasId]);

  if (!user) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Masuk dulu untuk mengumpulkan</h3>
        <p className="mt-1 text-sm text-slate-600">
          Kamu perlu masuk ke akun sebelum bisa mengumpulkan tugas.
        </p>
        <div className="mt-4">
          <Button onClick={openLoginModal} variant="primary" size="md">
            Masuk
          </Button>
        </div>
      </div>
    );
  }

  function startEdit() {
    if (!existing) return;
    setClassId(existing.classId);
    setNim(existing.nim);
    setName(existing.name);
    setNote(existing.note ?? "");
    setFile(null);
    setFileError(null);
    setDropExistingFile(false);
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setError(null);
    setFile(null);
    setFileError(null);
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
    setDropExistingFile(false);
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!classId) {
      setError("Pilih kelas dulu.");
      return;
    }
    if (nim.trim().length < 3) {
      setError("Isi NIM dulu.");
      return;
    }
    if (!name.trim()) {
      setError("Isi nama dulu.");
      return;
    }

    const keepOldFile = editing && !!existing?.fileUpload && !dropExistingFile && !file;
    if (!file && !keepOldFile && !note.trim()) {
      setError("Isi catatan atau lampirkan file.");
      return;
    }

    setBusy(true);
    let submitStarted = false;
    let submittedFileUploadId: string | null = null;
    try {
      let fileUploadId: string | undefined;
      if (file) {
        const up = await uploadSubmissionFile(file);
        fileUploadId = up.fileId;
      } else if (keepOldFile) {
        fileUploadId = existing!.fileUpload!.id;
      }

      const payload = {
        classId,
        nim: nim.trim(),
        name: name.trim(),
        note: note.trim() || undefined,
        fileUploadId,
      };
      submittedFileUploadId = fileUploadId ?? null;
      submitStarted = true;
      const result = editing
        ? await updateMySubmission(tugasId, payload)
        : await submitTugas(tugasId, payload);

      setExisting(result.submission);
      setCount(result.total);
      setEditing(false);
      setFile(null);
      setPopup({ position: result.position, total: result.total, edited: editing });
      onSubmitted?.(result.submission, result.position, result.total);
    } catch (err) {
      // Response bisa hilang setelah server berhasil menyimpan. Baca ulang
      // hanya setelah request submit dimulai agar upload yang gagal tidak
      // dianggap sebagai pengumpulan yang berhasil.
      if (submitStarted && err instanceof ApiClientError && err.status === 0) {
        try {
          const recovered = await fetchMySubmission(tugasId);
          const recoveredSubmission = recovered.submission;
          const expectedNote = note.trim() || null;
          const matchesRequest =
            recoveredSubmission &&
            recoveredSubmission.classId === classId &&
            recoveredSubmission.nim === nim.trim() &&
            recoveredSubmission.name === name.trim() &&
            recoveredSubmission.note === expectedNote &&
            (recoveredSubmission.fileUpload?.id ?? null) === submittedFileUploadId;

          if (matchesRequest) {
            setExisting(recoveredSubmission);
            setCount(recovered.count);
            setEditing(false);
            setFile(null);
            setPopup({
              position: recovered.myPosition ?? recoveredSubmission.position,
              total: recovered.count,
              edited: editing,
            });
            onSubmitted?.(
              recoveredSubmission,
              recovered.myPosition ?? recoveredSubmission.position,
              recovered.count,
            );
            return;
          }
        } catch {
          // Tampilkan error asli kalau verifikasi ulang juga gagal.
        }
      }
      setError(getErrorMessage(err, "Gagal mengirim."));
    } finally {
      setBusy(false);
    }
  }

  const popupDialog = popup && (
    <ConfirmDialog
      open
      tone="primary"
      title={popup.edited ? "Perubahan tersimpan" : "Tugas berhasil dikumpulkan"}
      message={
        <p className="text-base text-slate-700">
          Kamu urutan ke-<strong className="text-slate-900">{popup.position}</strong> dari{" "}
          <strong className="text-slate-900">{popup.total}</strong> yang sudah mengumpulkan.
        </p>
      }
      confirmLabel="Oke"
      hideCancel
      onConfirm={() => setPopup(null)}
      onCancel={() => setPopup(null)}
    />
  );

  if (existing && !editing) {
    return (
      <div className="space-y-3">
        {popupDialog}
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h3 className="text-lg font-bold text-emerald-800">Sudah dikumpulkan</h3>
            </div>
            {!deadlinePassed && (
              <Button variant="outline" size="sm" icon={Pencil} onClick={startEdit}>
                Ubah
              </Button>
            )}
          </div>

          <p className="mt-2 text-sm text-emerald-800">
            Dikumpulkan {formatWaktu(existing.submittedAt)} atas nama{" "}
            <strong>{existing.name}</strong> ({existing.nim}), kelas{" "}
            <strong>{existing.class.name}</strong>.
          </p>
          {existing.updatedAt && (
            <p className="mt-1 text-xs text-emerald-700">
              Terakhir diubah {formatWaktu(existing.updatedAt)}.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <PositionBadge position={existing.position} total={count} />
            {existing.status === "LATE" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                <AlertCircle className="h-3 w-3" />
                Terlambat, tapi tetap tersimpan
              </span>
            )}
          </div>

          {existing.note && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-emerald-800">
                Lihat catatan kamu
              </summary>
              <p className="mt-2 whitespace-pre-wrap rounded-2xl bg-white p-3 text-sm text-slate-700">
                {existing.note}
              </p>
            </details>
          )}

          {existing.fileUpload && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-sm text-slate-700">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="font-medium">{existing.fileUpload.originalName}</span>
              <span className="text-slate-400">({formatFileSize(existing.fileUpload.size)})</span>
            </div>
          )}

          {deadlinePassed && (
            <p className="mt-3 text-xs text-slate-600">
              Batas waktu sudah lewat, pengumpulan tidak bisa diubah lagi.
            </p>
          )}
        </div>

        {existing.feedback && (
          <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-blue-800">
              <MessageSquareText className="h-5 w-5" />
              <h4 className="text-sm font-bold">Catatan dari dosen/asisten</h4>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">{existing.feedback}</p>
            {existing.feedbackAt && (
              <p className="mt-2 text-xs text-blue-700">{formatWaktu(existing.feedbackAt)}</p>
            )}
          </div>
        )}
      </div>
    );
  }

  const showOldFile = editing && !!existing?.fileUpload && !dropExistingFile && !file;

  return (
    <>
      {popupDialog}
      <form
        onSubmit={onSubmit}
        className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {editing ? "Ubah pengumpulan" : "Kumpulkan tugas"}
            </h3>
            <p className="text-sm text-slate-600">
              {editing
                ? "Urutan kamu tidak berubah. Ganti bagian yang perlu diperbaiki saja."
                : "Isi kelas, NIM, dan nama. Tambahkan catatan atau lampirkan file."}
            </p>
          </div>
          {editing && (
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              Batal
            </Button>
          )}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Kelas</label>
          <KelasPicker
            options={classes}
            value={classId}
            onChange={(id) => setClassId(id)}
            disabledId={lockedClassId ?? undefined}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">NIM</label>
            <Input
              value={nim}
              onChange={(e) => setNim(e.target.value)}
              placeholder="Nomor induk mahasiswa"
              autoComplete="off"
              maxLength={40}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Nama</label>
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
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Catatan <span className="text-slate-400">(boleh kosong)</span>
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tulis catatan untuk dosen/asisten kalau perlu"
            rows={3}
            maxLength={8000}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            File <span className="text-slate-400">(boleh kosong)</span>
          </label>

          {showOldFile ? (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 shrink-0 text-blue-500" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700">
                    {existing!.fileUpload!.originalName}
                  </p>
                  <p className="text-xs text-slate-500">File yang sekarang tersimpan</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDropExistingFile(true)}
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Ganti file
              </button>
            </div>
          ) : !file ? (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 transition hover:border-blue-200 hover:bg-blue-50/50">
              <Upload className="h-5 w-5" />
              <span>Pilih file (maksimal {formatFileSize(MAX_FILE_BYTES)})</span>
              <input type="file" className="hidden" onChange={onPickFile} accept="*/*" />
            </label>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 shrink-0 text-blue-500" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={clearFile}
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                aria-label="Hapus file"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {editing && dropExistingFile && !file && (
            <button
              type="button"
              onClick={() => setDropExistingFile(false)}
              className="mt-1 text-xs font-medium text-slate-500 hover:underline"
            >
              Pakai file lama lagi
            </button>
          )}
          {fileError && <p className="mt-1 text-xs text-red-600">{fileError}</p>}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" variant="primary" size="md" isLoading={busy} disabled={busy}>
            {busy ? "Mengirim..." : editing ? "Simpan perubahan" : "Kumpulkan"}
          </Button>
        </div>
      </form>
    </>
  );
}
