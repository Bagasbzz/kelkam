"use client";

import { getErrorMessage } from "@/lib/errors";
import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Bot,
  Upload,
} from "lucide-react";
import Button from "@/components/ui/Button";
import {
  bulkImportMahasiswas,
  fetchMahasiswas,
  type MahasiswaRow,
} from "@/lib/client/tugas-api";

interface MahasiswaBulkImportProps {
  courseId: string;
  /** Daftar kelas course buat display di preview. */
  classes: { id: string; name: string }[];
  onImported?: (inserted: number) => void;
}

type Tab = "paste" | "ai";

/**
 * Komponen bulk-import roster mahasiswa.
 *
 * Tab "Paste text" → user paste CSV-like text (NIM,Nama,Kelas per baris).
 * Tab "AI" → user paste freeform (dari Excel/Word); AI extract jadi entries.
 *
 * Preview table sebelum commit. Counter: inserted / skipped / duplicate.
 */
export default function MahasiswaBulkImport({
  courseId,
  classes,
  onImported,
}: MahasiswaBulkImportProps) {
  const [tab, setTab] = useState<Tab>("paste");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
    duplicateInDb: number;
    totalSubmitted: number;
    aiParsed: boolean;
  } | null>(null);
  const [existing, setExisting] = useState<MahasiswaRow[]>([]);

  async function doImport() {
    setError(null);
    setResult(null);
    if (rawText.trim().length < 3) {
      setError("Paste data dulu.");
      return;
    }
    setBusy(true);
    try {
      const payload = tab === "paste"
        ? { rawText: rawText.trim() }
        : { rawText: rawText.trim() };
      const res = await bulkImportMahasiswas(courseId, payload);
      setResult(res);
      setRawText("");
      const updated = await fetchMahasiswas(courseId);
      setExisting(updated.mahasiswas);
      onImported?.(res.inserted);
    } catch (err) {
      setError(getErrorMessage(err, "Import gagal."));
    } finally {
      setBusy(false);
    }
  }

  async function refreshExisting() {
    try {
      const r = await fetchMahasiswas(courseId);
      setExisting(r.mahasiswas);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h3 className="text-lg font-bold text-slate-900">Import Roster Mahasiswa</h3>
        <p className="mt-1 text-xs text-slate-500">
          Paste daftar dari Excel/Word/CSV. Format umum:{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">
            NIM,Nama,Kelas
          </code>{" "}
          per baris. Duplicate NIM di-skip.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("paste")}
          className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition ${
            tab === "paste"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Upload className="mr-1 inline h-3 w-3" />
          Paste text
        </button>
        <button
          type="button"
          onClick={() => setTab("ai")}
          className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold transition ${
            tab === "ai"
              ? "border-violet-200 bg-violet-50 text-violet-700"
              : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
          }`}
        >
          <Bot className="mr-1 inline h-3 w-3" />
          Analisa dengan AI
        </button>
      </div>

      <textarea
        value={rawText}
        onChange={(e) => setRawText(e.target.value)}
        placeholder={
          tab === "paste"
            ? "231234567,Budi Santoso,A\n231234568,Siti Aminah,B\n..."
            : "Paste data bebas dari Excel/Word. AI akan extract NIM, nama, kelas."
        }
        rows={8}
        maxLength={20000}
        className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs outline-none transition focus:border-blue-500"
      />

      {error && (
        <div className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-4 w-4" />
            Import selesai
          </div>
          <p className="mt-1 text-xs">
            {result.aiParsed && "(Dianalisa dengan AI) "}
            {result.totalSubmitted} baris diinput, {result.inserted} baru
            ditambahkan, {result.duplicateInDb} sudah ada di roster.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-slate-500">
          {existing.length > 0
            ? `Roster saat ini: ${existing.length} mahasiswa`
            : `Kelas tersedia: ${classes.map((c) => c.name).join(", ") || "(belum ada kelas)"}`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refreshExisting} disabled={busy}>
            Refresh Roster
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={tab === "ai" ? Bot : Upload}
            onClick={() => void doImport()}
            isLoading={busy}
            disabled={busy}
          >
            {tab === "ai" ? "Analisa & Import" : "Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}