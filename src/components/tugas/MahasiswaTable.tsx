"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search, Trash2, Users } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  deleteMahasiswa,
  fetchMahasiswas,
  type MahasiswaRow,
} from "@/lib/client/tugas-api";

interface MahasiswaTableProps {
  courseId: string;
  /** Optional refresh signal — increment to force reload. */
  refreshKey?: number;
  onChanged?: () => void;
}

/**
 * Tabel roster mahasiswa per course dengan search + delete per-row.
 */
export default function MahasiswaTable({
  courseId,
  refreshKey,
  onChanged,
}: MahasiswaTableProps) {
  const [rows, setRows] = useState<MahasiswaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchMahasiswas(courseId, search);
      setRows(r.mahasiswas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat.");
    } finally {
      setLoading(false);
    }
  }, [courseId, search]);

  useEffect(() => {
    load();
  }, [courseId, refreshKey, load]);

  function onSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(load, 300);
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Hapus ${name} dari roster?`)) return;
    setBusyId(id);
    try {
      await deleteMahasiswa(courseId, id);
      setRows((r) => r.filter((x) => x.id !== id));
      onChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal hapus.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Roster Mahasiswa</h3>
          <p className="mt-1 text-xs text-slate-500">
            {rows.length > 0 ? `${rows.length} terdaftar.` : "Belum ada data."}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Cari NIM/nama..."
            className="w-40 bg-transparent text-xs outline-none"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600">{error}</p>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat roster…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            <Users className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            Belum ada mahasiswa di roster. Import di atas dulu.
          </div>
        ) : (
          <div className="max-h-[480px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">NIM</th>
                  <th className="px-4 py-2 text-left">Nama</th>
                  <th className="px-4 py-2 text-left">Kelas</th>
                  <th className="px-4 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-slate-100 transition hover:bg-slate-50"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.nim}</td>
                    <td className="px-4 py-2 font-bold text-slate-900">{r.name}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {r.class?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDelete(r.id, r.name)}
                        disabled={busyId === r.id}
                        className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        aria-label={`Hapus ${r.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 text-right">
        <Button variant="outline" size="sm" onClick={load}>
          Refresh
        </Button>
      </div>
    </div>
  );
}