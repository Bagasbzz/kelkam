/**
 * src/components/ui/ConfirmDialog.tsx
 * -----------------------------------------------------------------------------
 * Modal konfirmasi reusable — pengganti `window.confirm()`. Dipakai saat
 * aksi destruktif (delete tugas, remove admin, dll).
 *
 * Pakai:
 *   const [open, setOpen] = useState(false);
 *   <Button onClick={() => setOpen(true)}>Hapus</Button>
 *   <ConfirmDialog
 *     open={open}
 *     title="Hapus tugas?"
 *     message="Semua submission akan ikut terhapus."
 *     confirmLabel="Hapus"
 *     tone="danger"
 *     onConfirm={() => { ... }}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * Accessibility:
 *   - role="alertdialog" + aria-labelledby/aria-describedby
 *   - Focus trap ke tombol confirm saat open
 *   - ESC + backdrop click untuk cancel
 *   - Body scroll lock saat open
 * -----------------------------------------------------------------------------
 */

"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  tone = "danger",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    // Focus tombol confirm setelah render.
    confirmRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const confirmClass =
    tone === "danger"
      ? "bg-red-600 hover:bg-red-700 shadow-lg shadow-red-500/30"
      : "bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-500/30";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4"
      onClick={() => !busy && onCancel()}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl"
      >
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="absolute right-4 top-4 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          aria-label="Tutup dialog"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex items-start gap-3">
          {tone === "danger" && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-red-100 text-red-600">
              <AlertTriangle className="h-5 w-5" aria-hidden />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-slate-900">
              {title}
            </h2>
            <div id={descId} className="mt-1 text-sm text-slate-600">
              {message}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2 text-sm font-bold text-white transition disabled:opacity-60 ${confirmClass}`}
          >
            {busy ? "Memproses..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}