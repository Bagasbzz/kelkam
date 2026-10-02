"use client";

import { Inbox } from "lucide-react";
import type { SubmissionRow } from "@/lib/client/tugas-api";
import SubmissionRowItem from "./SubmissionRowItem";

interface AdminSubmissionListProps {
  submissions: SubmissionRow[];
  /** Dipanggil saat satu baris berubah (mis. catatan disimpan). */
  onChanged?: (updated: SubmissionRow) => void;
  onDeleted?: () => Promise<void>;
}

/** Daftar pengumpulan untuk admin, urut dari yang pertama mengumpulkan. */
export default function AdminSubmissionList({ submissions, onChanged, onDeleted }: AdminSubmissionListProps) {
  if (!submissions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <Inbox className="h-8 w-8 text-slate-300" />
        <p className="text-sm font-bold text-slate-500">Belum ada yang mengumpulkan</p>
        <p className="text-xs text-slate-400">
          Pengumpulan mahasiswa akan muncul di sini, urut dari yang pertama.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-600">
        <strong>{submissions.length}</strong> mahasiswa sudah mengumpulkan
      </div>
      <div className="space-y-2">
        {submissions.map((s) => (
          <SubmissionRowItem key={s.id} submission={s} onChanged={onChanged} onDeleted={onDeleted} />
        ))}
      </div>
    </div>
  );
}
