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
  reportClientError,
  submitTugas,
  updateMySubmission,
  uploadAdminFile,
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

/** Pesan gagal yang ditampilkan ke mahasiswa: kalimat utama + langkah yang bisa dicoba. */
interface FailureInfo {
  message: string;
  hints?: string[];
}

type SubmitStage = "upload" | "submit";

/** Hasil kirim pengumpulan (dari server, atau dipulihkan lewat baca ulang). */
interface SubmitOutcome {
  submission: SubmissionRow;
  position: number;
  total: number;
}

const HINT_GANTI_JARINGAN = "Ganti jaringan: dari WiFi ke data seluler, atau sebaliknya.";
const HINT_FILE_CLOUD = "Kalau file diambil dari Google Drive, WhatsApp, atau iCloud, unduh dulu ke perangkat lalu pilih ulang.";
const HINT_BROWSER = "Matikan mode hemat data, VPN, atau adblock. Bisa juga coba browser Chrome atau laptop.";
const HINT_HUBUNGI = "Kalau tetap gagal, screenshot pesan ini dan kirim ke dosen/asisten.";

function isConnectionError(err: unknown): err is ApiClientError {
  return err instanceof ApiClientError && (err.kind === "network" || err.kind === "timeout");
}

/**
 * Terjemahkan error menjadi pesan yang jelas untuk mahasiswa, dibedakan
 * menurut TAHAP (unggah file vs kirim data) dan JENIS kegagalan.
 */
function describeFailure(stage: SubmitStage, err: unknown, file: File | null): FailureInfo {
  if (!(err instanceof ApiClientError)) {
    return { message: getErrorMessage(err, "Gagal mengirim. Coba lagi."), hints: [HINT_HUBUNGI] };
  }

  if (err.kind === "offline") {
    return {
      message: "Perangkat kamu sedang tidak tersambung ke internet.",
      hints: ["Nyalakan data seluler atau sambungkan WiFi, lalu tekan Kumpulkan lagi."],
    };
  }

  if (err.kind === "timeout") {
    return stage === "upload"
      ? {
          message: `Upload file terlalu lama, server belum selesai menerima file${file ? ` (${formatFileSize(file.size)})` : ""}.`,
          hints: [
            "Koneksi kamu kemungkinan lambat. Coba jaringan yang lebih cepat.",
            "Kecilkan file: kompres jadi ZIP, atau simpan ulang dokumen sebagai PDF.",
            HINT_HUBUNGI,
          ],
        }
      : {
          message: "Server terlalu lama membalas saat menyimpan pengumpulan.",
          hints: ["Muat ulang halaman ini. Kalau tertulis \"Sudah dikumpulkan\", berarti sudah aman.", HINT_GANTI_JARINGAN],
        };
  }

  if (err.kind === "network") {
    return stage === "upload"
      ? {
          message: "Gagal mengunggah file: koneksi ke server terputus sebelum file selesai terkirim.",
          hints: [HINT_GANTI_JARINGAN, HINT_FILE_CLOUD, HINT_BROWSER, HINT_HUBUNGI],
        }
      : {
          message: "File sudah terunggah, tapi data pengumpulan gagal terkirim karena koneksi terputus.",
          hints: [
            "Muat ulang halaman ini. Kalau tertulis \"Sudah dikumpulkan\", berarti sudah aman.",
            HINT_GANTI_JARINGAN,
            HINT_BROWSER,
          ],
        };
  }

  // Server membalas dengan error: pesan dari server sudah ditulis untuk user.
  const hints: string[] = [];
  if (err.status === 401) hints.push("Tekan tombol Masuk di kanan atas, lalu ulangi pengumpulan.");
  if (err.status >= 500) hints.push("Tunggu 1-2 menit lalu coba lagi.", HINT_HUBUNGI);
  const prefix = stage === "upload" ? "Upload file gagal: " : "";
  return { message: `${prefix}${err.apiError}`.slice(0, 300), hints };
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

function validateFile(f: File, isAdmin: boolean): string | null {
  // File 0 byte biasanya "file bayangan" dari Google Drive/WhatsApp yang belum terunduh.
  if (f.size === 0) return "File kosong (0 byte). Kalau dari Google Drive atau WhatsApp, unduh dulu ke perangkat lalu pilih ulang.";
  // Admin tidak dibatasi ukuran (upload streaming); user biasa maks 12 MB.
  if (!isAdmin && f.size > MAX_FILE_BYTES) {
    return `Ukuran file ${formatFileSize(f.size)}, maksimal ${formatFileSize(MAX_FILE_BYTES)}. Kompres jadi ZIP atau simpan ulang sebagai PDF.`;
  }
  if (!f.name || f.name.length > 200) return "Nama file tidak valid. Ganti nama file jadi lebih pendek lalu pilih ulang.";
  return null;
}

/**
 * Baca isi file ke memori saat dipilih, lalu kembalikan salinannya.
 *
 * Kenapa: di HP (terutama Android), file dari Google Drive/WhatsApp/galeri
 * cloud sering hanya "rujukan". Saat dikirim belakangan, browser gagal
 * membacanya dan fetch melempar error yang tampak seperti "koneksi terputus".
 * Membaca di awal memunculkan masalah itu SEBELUM upload, dengan pesan jelas.
 */
async function readFileIntoMemory(f: File): Promise<File> {
  const bytes = await f.arrayBuffer();
  if (bytes.byteLength !== f.size) throw new Error("ukuran file berubah saat dibaca");
  return new File([bytes], f.name, { type: f.type, lastModified: f.lastModified });
}

export default function SubmissionForm({
  tugasId,
  deadline,
  classes,
  lockedClassId,
  onSubmitted,
}: SubmissionFormProps) {
  const { user, openLoginModal } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [classId, setClassId] = useState<string | null>(lockedClassId ?? null);
  const [nim, setNim] = useState("");
  const [name, setName] = useState(user?.name ?? "");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  /** true saat isi file sedang dibaca ke memori (setelah dipilih). */
  const [readingFile, setReadingFile] = useState(false);
  /** Saat mode ubah: true kalau file lama sengaja dilepas. */
  const [dropExistingFile, setDropExistingFile] = useState(false);

  const [existing, setExisting] = useState<SubmissionRow | null>(null);
  const [count, setCount] = useState(0);
  const [editing, setEditing] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FailureInfo | null>(null);
  /** Tahap yang sedang berjalan, untuk label tombol. */
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
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
        // Tidak fatal, form tetap bisa dipakai.
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

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError(null);
    const input = e.target;
    const f = input.files?.[0] ?? null;
    // Reset supaya memilih file yang sama lagi tetap memicu onChange.
    input.value = "";
    if (!f) {
      setFile(null);
      return;
    }
    const err = validateFile(f, isAdmin);
    if (err) {
      setFileError(err);
      setFile(null);
      return;
    }

    // Admin bisa mengunggah file sangat besar (streaming), jangan dimuat ke memori.
    if (isAdmin) {
      setFile(f);
      setDropExistingFile(false);
      return;
    }

    setReadingFile(true);
    try {
      const inMemory = await readFileIntoMemory(f);
      setFile(inMemory);
      setDropExistingFile(false);
    } catch {
      setFile(null);
      setFileError(
        "File tidak bisa dibaca dari perangkat. Biasanya karena file masih di Google Drive, WhatsApp, atau iCloud. Unduh dulu ke penyimpanan perangkat (folder Download), lalu pilih ulang.",
      );
      reportClientError({ stage: "read-file", kind: "file-read", tugasId, fileSize: f.size, fileType: f.type });
    } finally {
      setReadingFile(false);
    }
  }

  function clearFile() {
    setFile(null);
    setFileError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!classId) {
      setError({ message: "Pilih kelas dulu." });
      return;
    }
    if (nim.trim().length < 3) {
      setError({ message: "Isi NIM dulu (minimal 3 karakter)." });
      return;
    }
    if (!name.trim()) {
      setError({ message: "Isi nama dulu." });
      return;
    }

    const keepOldFile = editing && !!existing?.fileUpload && !dropExistingFile && !file;
    if (!file && !keepOldFile && !note.trim()) {
      setError({ message: "Isi catatan atau lampirkan file." });
      return;
    }

    setBusy(true);
    let stage: SubmitStage = "upload";
    try {
      // ---- Tahap 1: unggah file -------------------------------------------
      let fileUploadId: string | undefined;
      if (file) {
        setProgressLabel("Mengunggah file...");
        const up = isAdmin ? await uploadAdminFile(file) : await uploadSubmissionFile(file);
        fileUploadId = up.fileId;
      } else if (keepOldFile) {
        fileUploadId = existing!.fileUpload!.id;
      }

      // ---- Tahap 2: kirim data pengumpulan --------------------------------
      stage = "submit";
      setProgressLabel("Menyimpan pengumpulan...");
      const payload = {
        classId,
        nim: nim.trim(),
        name: name.trim(),
        note: note.trim() || undefined,
        fileUploadId,
      };
      const outcome = await sendSubmission(payload, editing);

      setExisting(outcome.submission);
      setCount(outcome.total);
      setEditing(false);
      setFile(null);
      setPopup({ position: outcome.position, total: outcome.total, edited: editing });
      onSubmitted?.(outcome.submission, outcome.position, outcome.total);
    } catch (err) {
      setError(describeFailure(stage, err, file));
      if (err instanceof ApiClientError) {
        reportClientError({
          stage,
          kind: err.kind,
          status: err.status,
          message: err.apiError,
          tugasId,
          fileSize: file?.size,
          fileType: file?.type,
        });
      }
    } finally {
      setBusy(false);
      setProgressLabel(null);
    }
  }

  /**
   * Kirim data pengumpulan. Kalau koneksi putus/timeout, balasan bisa hilang
   * padahal server SUDAH menyimpan. Maka: cek ulang dulu ke server; kalau
   * memang belum tersimpan, kirim ulang satu kali.
   */
  async function sendSubmission(
    payload: { classId: string; nim: string; name: string; note?: string; fileUploadId?: string },
    isEdit: boolean,
  ): Promise<SubmitOutcome> {
    const send = () => (isEdit ? updateMySubmission(tugasId, payload) : submitTugas(tugasId, payload));

    try {
      return await send();
    } catch (err) {
      if (!isConnectionError(err)) throw err;

      const recovered = await recoverSavedSubmission(payload);
      if (recovered) return recovered;

      // Belum tersimpan → coba sekali lagi setelah jeda singkat.
      setProgressLabel("Koneksi terputus, mencoba lagi...");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        return await send();
      } catch (retryErr) {
        // POST ulang bisa ditolak "sudah mengumpulkan" bila percobaan pertama ternyata
        // tersimpan; atau koneksi putus lagi. Dua-duanya: cek ulang ke server.
        const again = await recoverSavedSubmission(payload);
        if (again) return again;
        throw retryErr;
      }
    }
  }

  /** Cek apakah pengumpulan dengan isi persis seperti `payload` sudah tersimpan di server. */
  async function recoverSavedSubmission(payload: {
    classId: string;
    nim: string;
    name: string;
    note?: string;
    fileUploadId?: string;
  }): Promise<SubmitOutcome | null> {
    try {
      const recovered = await fetchMySubmission(tugasId);
      const s = recovered.submission;
      const matches =
        !!s &&
        s.classId === payload.classId &&
        s.nim === payload.nim &&
        s.name === payload.name &&
        s.note === (payload.note ?? null) &&
        (s.fileUpload?.id ?? null) === (payload.fileUploadId ?? null);
      if (!matches || !s) return null;
      return { submission: s, position: recovered.myPosition ?? s.position, total: recovered.count };
    } catch {
      return null;
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
          ) : readingFile ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/50 px-4 py-6 text-sm text-blue-700">
              <Upload className="h-5 w-5 animate-pulse" />
              <span>Membaca file dari perangkat...</span>
            </div>
          ) : !file ? (
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 transition hover:border-blue-200 hover:bg-blue-50/50">
              <Upload className="h-5 w-5" />
              <span>
                {isAdmin ? "Pilih file (admin: tanpa batas ukuran)" : `Pilih file (maksimal ${formatFileSize(MAX_FILE_BYTES)})`}
              </span>
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
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="font-medium">{error.message}</span>
            </div>
            {error.hints && error.hints.length > 0 && (
              <div className="mt-2 pl-6">
                <p className="text-xs font-semibold text-red-800">Coba langkah ini:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-red-700">
                  {error.hints.map((hint) => (
                    <li key={hint}>{hint}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="submit" variant="primary" size="md" isLoading={busy} disabled={busy || readingFile}>
            {busy ? progressLabel ?? "Mengirim..." : editing ? "Simpan perubahan" : "Kumpulkan"}
          </Button>
        </div>
      </form>
    </>
  );
}
