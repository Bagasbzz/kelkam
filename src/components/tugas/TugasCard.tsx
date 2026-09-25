"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, Pencil, Trash2, FileText, Tag } from "lucide-react";
import Button from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import CountdownTimer from "./CountdownTimer";
import type { TugasSummary } from "@/lib/client/tugas-api";

interface TugasCardProps {
  tugas: TugasSummary;
  /** Path ke detail tugas (mahasiswa). */
  href: string;
  /** Tampilkan tombol admin (edit/delete). */
  isAdmin?: boolean;
  /** Path edit (admin only). */
  editHref?: string;
  /** Path submissions list (admin only). */
  submissionsHref?: string;
  /** Delete handler (admin only). */
  onDelete?: (tugas: TugasSummary) => void;
  /** Total submissions (untuk context, optional). */
  submissionsCount?: number;
}

function formatDeadline(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TugasCard({
  tugas,
  href,
  isAdmin,
  editHref,
  submissionsHref,
  onDelete,
  submissionsCount,
}: TugasCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900 truncate">{tugas.title}</h3>
            {tugas.class && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                <Tag className="w-3 h-3" />
                {tugas.class.name}
              </span>
            )}
          </div>

          {tugas.description && (
            <p className="mt-1 line-clamp-2 text-sm text-slate-600">{tugas.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="w-4 h-4" />
              {formatDeadline(tugas.deadline)}
            </span>
            <CountdownTimer deadline={tugas.deadline} />
            {submissionsCount !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
                <FileText className="w-3 h-3" />
                {submissionsCount} submission
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isAdmin ? (
            <>
              {submissionsHref && (
                <Link href={submissionsHref}>
                  <Button variant="outline" size="sm" icon={FileText}>
                    Lihat Submission
                  </Button>
                </Link>
              )}
              {editHref && (
                <Link href={editHref}>
                  <Button variant="secondary" size="sm" icon={Pencil}>
                    Edit
                  </Button>
                </Link>
              )}
              {onDelete && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={Trash2}
                  onClick={() => setConfirmDelete(true)}
                >
                  Hapus
                </Button>
              )}
            </>
          ) : (
            <Link href={href}>
              <Button variant="primary" size="sm">
                Lihat / Submit
              </Button>
            </Link>
          )}
        </div>
      </div>

      {onDelete && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Hapus tugas "${tugas.title}"?`}
          message={
            <>
              Tindakan ini tidak bisa dibatalkan. Semua submission terkait
              (termasuk file yang di-upload) akan ikut terhapus.
            </>
          }
          confirmLabel="Hapus"
          tone="danger"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(tugas);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}