"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  MessageSquareText,
  Pencil,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Textarea from "@/components/ui/Textarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  clearSubmissionFeedback,
  setSubmissionFeedback,
  type SubmissionRow,
} from "@/lib/client/tugas-api";

interface SubmissionRowItemProps {
  submission: SubmissionRow;
  /** Dipanggil setelah catatan disimpan/dihapus supaya daftar induk ikut segar. */
  onChanged?: (updated: SubmissionRow) => void;
}

function formatWaktu(iso: string) {
  return new Date(iso).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: SubmissionRow["status"]) {
  if (status === "LATE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
        <Clock className="h-3 w-3" />
        Terlambat
      </span>
    );
  }
  if (status === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
        <AlertCircle className="h-3 w-3" />
        Ditolak
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
      <CheckCircle2 className="h-3 w-3" />
      Tepat waktu
    </span>
  );
}

export default function SubmissionRowItem({ submission, onChanged }: SubmissionRowItemProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(submission.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setDraft(submission.feedback ?? "");
    setError(null);
    setOpen(true);
  }

  async function save() {
    const text = draft.trim();
    if (!text) {
      setError("Catatan tidak boleh kosong.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await setSubmissionFeedback(submission.id, text);
      onChanged?.(res.submission);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan catatan.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await clearSubmissionFeedback(submission.id);
      onChanged?.(res.submission);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus catatan.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {submission.position}
            </span>
            <h4 className="truncate text-sm font-bold text-slate-900">
              {submission.name}{" "}
              <span className="font-mono text-xs text-slate-500">({submission.nim})</span>
            </h4>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
              Kelas {submission.class.name}
            </span>
            {statusBadge(submission.status)}
          </div>

          <p className="mt-1 text-xs text-slate-500">
            Dikumpulkan {formatWaktu(submission.submittedAt)}
            {submission.updatedAt ? ` · diubah ${formatWaktu(submission.updatedAt)}` : ""}
            {submission.user?.email ? ` · ${submission.user.email}` : ""}
          </p>

          {submission.note && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">
                Catatan mahasiswa
              </summary>
              <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
                {submission.note}
              </p>
            </details>
          )}
        </div>

        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          {submission.fileUpload ? (
            <a
              href={`/api/tugas/submissions/${encodeURIComponent(submission.id)}/download`}
              className="inline-flex max-w-full items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
              title={`Unduh ${submission.fileUpload.originalName}`}
            >
              <FileText className="h-4 w-4 shrink-0" />
              <span className="max-w-[140px] truncate">{submission.fileUpload.originalName}</span>
              <Download className="h-4 w-4 shrink-0" />
              <span className="sr-only">Unduh file</span>
            </a>
          ) : (
            <span className="text-xs text-slate-400">Tanpa file</span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={submission.feedback ? Pencil : MessageSquareText}
            onClick={openDialog}
          >
            {submission.feedback ? "Ubah catatan" : "Beri catatan"}
          </Button>
        </div>
      </div>

      {submission.feedback && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-bold text-blue-800">Catatan untuk mahasiswa</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{submission.feedback}</p>
          {submission.feedbackAt && (
            <p className="mt-1 text-xs text-blue-700">{formatWaktu(submission.feedbackAt)}</p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={open}
        tone="primary"
        title={submission.feedback ? "Ubah catatan" : "Beri catatan"}
        message={
          <div className="space-y-2">
            <p>
              Catatan ini akan dilihat oleh <strong>{submission.name}</strong> di riwayat
              pengumpulannya.
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Contoh: Format sudah benar, tapi bagian kesimpulan perlu ditambah."
              disabled={busy}
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            {submission.feedback && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Hapus catatan
              </button>
            )}
          </div>
        }
        confirmLabel="Simpan"
        cancelLabel="Batal"
        busy={busy}
        onConfirm={() => void save()}
        onCancel={() => !busy && setOpen(false)}
      />
    </div>
  );
}
