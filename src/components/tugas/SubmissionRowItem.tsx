"use client";

import { AlertCircle, CheckCircle2, Clock, FileText } from "lucide-react";
import type { SubmissionRow } from "@/lib/client/tugas-api";

interface SubmissionRowItemProps {
  submission: SubmissionRow;
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
        <Clock className="w-3 h-3" />
        Late
      </span>
    );
  }
  if (status === "REJECTED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
        <AlertCircle className="w-3 h-3" />
        Ditolak
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">
      <CheckCircle2 className="w-3 h-3" />
      Submitted
    </span>
  );
}

export default function SubmissionRowItem({ submission }: SubmissionRowItemProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
            #{submission.position}
          </span>
          <h4 className="text-sm font-bold text-slate-900 truncate">
            {submission.name}{" "}
            <span className="font-mono text-xs text-slate-500">({submission.nim})</span>
          </h4>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">
            {submission.class.name}
          </span>
          {statusBadge(submission.status)}
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {formatWaktu(submission.submittedAt)}
          {submission.user?.email ? ` • ${submission.user.email}` : ""}
        </p>

        {submission.note && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-bold text-slate-600 hover:text-slate-900">
              Catatan
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
              {submission.note}
            </p>
          </details>
        )}
      </div>

      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
        {submission.fileUpload ? (
          <div className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700">
            <FileText className="w-4 h-4 text-blue-500" />
            <span className="truncate max-w-[140px]">{submission.fileUpload.originalName}</span>
            <span className="text-slate-400">
              ({(submission.fileUpload.size / 1024).toFixed(1)} KB)
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Tanpa file</span>
        )}
      </div>
    </div>
  );
}