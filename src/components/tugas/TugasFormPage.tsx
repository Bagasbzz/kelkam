"use client";

import { getErrorMessage } from "@/lib/errors";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, ImagePlus, Loader2, Video, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import KelasPicker from "@/components/tugas/KelasPicker";
import {
  VIDEO_MIME_CLIENT_RE,
  createTugas,
  fetchCourseByToken,
  tugasAttachmentUrl,
  updateTugas,
  uploadAdminFile,
  type CourseSummary,
  type TugasSummary,
} from "@/lib/client/tugas-api";
import { useAuth } from "@/components/AuthProvider";

const MAX_ATTACHMENTS = 8;
/** Admin tidak dibatasi ukuran; tipe executable/skrip ditolak server. */
const ATTACHMENT_ACCEPT = "*/*";

/** Deteksi video dari MIME browser atau ekstensi (MKV/AVI sering MIME kosong). */
function isVideoFile(f: File): boolean {
  return VIDEO_MIME_CLIENT_RE.test(f.type) || /\.(mp4|m4v|webm|ogv|mov|mkv|avi|3gp)$/i.test(f.name);
}

interface DraftAttachment {
  key: string;
  fileId: string;
  name: string;
  mime: string;
  size: number;
  caption: string;
  /** URL preview: blob lokal (baru) atau URL publik (lampiran lama). */
  previewUrl: string | null;
  kind: "image" | "video" | "file";
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface TugasFormPageProps {
  token: string;
  /** Kalau undefined = create mode. Kalau ada = edit mode. */
  initial?: TugasSummary;
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Format YYYY-MM-DDTHH:mm (local).
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export default function TugasFormPage({ token, initial }: TugasFormPageProps) {
  const router = useRouter();
  const { user, loading: authLoading, openLoginModal } = useAuth();
  const isEdit = Boolean(initial);

  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [loadingCourse, setLoadingCourse] = useState(true);

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [classId, setClassId] = useState<string | null>(initial?.classId ?? null);
  const [pertemuan, setPertemuan] = useState<string>(
    initial?.pertemuan != null ? String(initial.pertemuan) : "",
  );
  const [deadlineLocal, setDeadlineLocal] = useState<string>(
    initial ? toDatetimeLocal(initial.deadline) : "",
  );
  const [attachments, setAttachments] = useState<DraftAttachment[]>(() =>
    (initial?.attachments ?? []).map((a) => ({
      key: a.id,
      fileId: a.fileId,
      name: a.name,
      mime: a.mime,
      size: a.size,
      caption: a.caption,
      previewUrl: (a.isImage || a.isVideo) && initial ? tugasAttachmentUrl(initial.id, a.id, token) : null,
      kind: a.isImage ? "image" : a.isVideo ? "video" : "file",
    })),
  );
  const [uploading, setUploading] = useState(false);
  /** Progres upload video aktif (0..1), null kalau tidak ada video yang sedang diunggah. */
  const [videoProgress, setVideoProgress] = useState<{ name: string; fraction: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setError(null);
    if (attachments.length + files.length > MAX_ATTACHMENTS) {
      setError(`Maksimal ${MAX_ATTACHMENTS} lampiran.`);
      return;
    }
    // Admin: tanpa batas ukuran (upload streaming ke /api/files/upload-admin).
    setUploading(true);
    try {
      const uploaded: DraftAttachment[] = [];
      for (const f of files) {
        const video = isVideoFile(f);
        setVideoProgress({ name: f.name, fraction: 0 });
        const r = await uploadAdminFile(f, (fraction) => setVideoProgress({ name: f.name, fraction }));
        setVideoProgress(null);
        const isImage = /^image\/(png|jpeg|webp|gif)$/.test(r.mime);
        uploaded.push({
          key: `${r.fileId}:${Date.now()}:${uploaded.length}`,
          fileId: r.fileId,
          name: f.name,
          mime: r.mime || f.type,
          size: r.size,
          caption: "",
          previewUrl: isImage || video ? URL.createObjectURL(f) : null,
          kind: isImage ? "image" : video ? "video" : "file",
        });
      }
      setAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setError(getErrorMessage(err, "Upload lampiran gagal."));
    } finally {
      setUploading(false);
      setVideoProgress(null);
    }
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => {
      const target = prev.find((a) => a.key === key);
      if (target?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.key !== key);
    });
  }

  function setCaption(key: string, caption: string) {
    setAttachments((prev) => prev.map((a) => (a.key === key ? { ...a, caption } : a)));
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingCourse(true);
    fetchCourseByToken(token)
      .then((data) => {
        if (cancelled) return;
        setCourse(data.course);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err, "Gagal memuat mata kuliah."));
      })
      .finally(() => {
        if (!cancelled) setLoadingCourse(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (authLoading || loadingCourse) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Masuk dulu</h1>
          <div className="pt-2">
            <Button onClick={openLoginModal} variant="primary" size="md">
              Masuk
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!course) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Mata kuliah tidak ditemukan</h1>
        </div>
      </div>
    );
  }

  if (user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <h1 className="text-2xl font-black text-slate-900">Tidak punya akses</h1>
          <p className="text-sm text-slate-600">Kamu bukan pengelola mata kuliah ini.</p>
        </div>
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError("Judul wajib diisi.");
      return;
    }
    if (!deadlineLocal) {
      setError("Deadline wajib diisi.");
      return;
    }
    const iso = fromDatetimeLocal(deadlineLocal);
    if (!iso) {
      setError("Format deadline tidak valid.");
      return;
    }
    const pertemuanTrim = pertemuan.trim();
    const pertemuanNum = pertemuanTrim === "" ? null : Number(pertemuanTrim);
    if (pertemuanNum !== null && (!Number.isInteger(pertemuanNum) || pertemuanNum < 1 || pertemuanNum > 99)) {
      setError("Pertemuan harus angka 1-99.");
      return;
    }

    setSubmitting(true);
    try {
      const attachmentInput = attachments.map((a) => ({ fileId: a.fileId, caption: a.caption.trim() || undefined }));
      if (isEdit && initial) {
        await updateTugas(initial.id, {
          title: title.trim(),
          description,
          deadline: iso,
          classId,
          pertemuan: pertemuanNum,
          attachments: attachmentInput,
        });
      } else {
        await createTugas({
          courseId: course!.id,
          classId,
          title: title.trim(),
          description,
          deadline: iso,
          // undefined → server menebak dari judul ("Pertemuan 3", "Minggu 2", "P4").
          pertemuan: pertemuanNum ?? undefined,
          attachments: attachmentInput,
        });
      }
      router.push(`/tugas/${token}/admin`);
    } catch (err) {
      setError(getErrorMessage(err, "Gagal menyimpan."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-2xl space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-sm font-bold text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Kembali
        </button>

        <div className="rounded-[2rem] bg-slate-950 px-7 py-8 text-white shadow-2xl md:px-10 md:py-10">
          <p className="text-sm font-medium text-blue-300">
            {course.name} ({course.code})
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">
            {isEdit ? "Edit Tugas" : "Bikin Tugas Baru"}
          </h1>
        </div>

        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <Input
              label="Judul"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tugas 1: Sorting Algorithm"
              maxLength={160}
            />

            <Textarea
              label="Deskripsi"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={8000}
              placeholder="Instruksi tugas, format file, dll..."
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">
                  Lampiran (opsional): screenshot output yang diharapkan, file contoh, dll
                </p>
                <span className="text-xs text-slate-500">{attachments.length}/{MAX_ATTACHMENTS}</span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={onPickFiles}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || attachments.length >= MAX_ATTACHMENTS}
                className="inline-flex items-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-600 transition hover:border-blue-400 hover:text-blue-600 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {uploading ? "Mengunggah..." : "Tambah gambar / video / file"}
              </button>
              <p className="mt-1 text-xs text-slate-500">
                Gambar, video, PDF, Word, PPT, Excel, ZIP, dan file lain, tanpa batas ukuran (program/skrip .exe/.bat dll diblokir). Mahasiswa bisa melihat dan mengunduhnya; Asisten AI bisa membaca gambar dan dokumen.
              </p>
              {videoProgress && (
                <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2">
                  <div className="flex items-center justify-between text-xs text-blue-700">
                    <span className="truncate">Mengunggah {videoProgress.name}</span>
                    <span className="ml-2 flex-none font-semibold">{Math.round(videoProgress.fraction * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                    <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.round(videoProgress.fraction * 100)}%` }} />
                  </div>
                </div>
              )}

              {attachments.length > 0 && (
                <ul className="mt-3 space-y-3">
                  {attachments.map((a) => (
                    <li key={a.key} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3">
                      {a.kind === "image" && a.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.previewUrl} alt={a.name} className="h-20 w-28 flex-none rounded-xl border border-slate-200 object-cover" />
                      ) : a.kind === "video" && a.previewUrl ? (
                        <video src={a.previewUrl} muted preload="metadata" className="h-20 w-28 flex-none rounded-xl border border-slate-200 bg-black object-cover" />
                      ) : (
                        <div className="flex h-20 w-28 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                          {a.kind === "video" ? <Video className="h-6 w-6" /> : <FileText className="h-6 w-6" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <p className="truncate text-sm font-medium text-slate-800" title={a.name}>
                            {a.name} <span className="text-xs font-normal text-slate-500">({formatBytes(a.size)})</span>
                          </p>
                          <button
                            type="button"
                            onClick={() => removeAttachment(a.key)}
                            aria-label="Hapus lampiran"
                            className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <input
                          type="text"
                          value={a.caption}
                          onChange={(e) => setCaption(a.key, e.target.value)}
                          maxLength={500}
                          placeholder="Keterangan, mis. Output yang harus muncul di terminal"
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-blue-500"
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-2 block text-sm font-medium text-slate-700">
                Kelas (opsional): kosongkan untuk semua kelas
              </p>
              <KelasPicker
                options={course.classes}
                value={classId}
                onChange={(id) => setClassId(id === classId ? null : id)}
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Pertemuan ke- (opsional)
              </label>
              <input
                type="number"
                min={1}
                max={99}
                step={1}
                value={pertemuan}
                onChange={(e) => setPertemuan(e.target.value)}
                placeholder="Kosongkan → ditebak dari judul"
                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Dipakai Asisten AI untuk &quot;siapa yang belum kumpul pertemuan N&quot;.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Deadline
              </label>
              <input
                type="datetime-local"
                value={deadlineLocal}
                onChange={(e) => setDeadlineLocal(e.target.value)}
                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Disimpan UTC. Tampil di WIB (Asia/Jakarta) untuk mahasiswa.
              </p>
            </div>

            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="primary"
                size="md"
                isLoading={submitting}
                disabled={submitting || uploading}
              >
                {isEdit ? "Simpan Perubahan" : "Bikin Tugas"}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}