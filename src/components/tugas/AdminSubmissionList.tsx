"use client";

import { Inbox } from "lucide-react";
import type { SubmissionRow } from "@/lib/client/tugas-api";
import SubmissionRowItem from "./SubmissionRowItem";

interface AdminSubmissionListProps {
  submissions: SubmissionRow[];
}

/**
 * Wrapper yang map submissions ke SubmissionRowItem.
 * Tampilkan empty state kalau belum ada yang submit.
 */
export default function AdminSubmissionList({ submissions }: AdminSubmissionListProps) {
  if (!submissions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center">
        <Inbox className="w-8 h-8 text-slate-300" />
        <p className="text-sm font-bold text-slate-500">Belum ada submission</p>
        <p className="text-xs text-slate-400">
          Submission mahasiswa akan muncul di sini, urut dari yang pertama.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        Total <strong>{submissions.length}</strong> submission
      </div>
      <div className="space-y-2">
        {submissions.map((s) => (
          <SubmissionRowItem key={s.id} submission={s} />
        ))}
      </div>
    </div>
  );
}