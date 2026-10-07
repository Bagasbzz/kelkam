"use client";

import { useEffect, useState } from "react";
import { Loader2, UserX } from "lucide-react";
import Card from "@/components/ui/Card";
import { fetchMissingSubmitters } from "@/lib/client/tugas-api";

type MissingData = Awaited<ReturnType<typeof fetchMissingSubmitters>>;

/** Kartu "belum mengumpulkan" berdasarkan roster course vs pengumpulan tugas. */
export default function MissingSubmittersCard({ tugasId }: { tugasId: string }) {
  const [data, setData] = useState<MissingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMissingSubmitters(tugasId)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Gagal memuat."));
    return () => { cancelled = true; };
  }, [tugasId]);

  if (error) return null;
  if (!data) {
    return (
      <Card>
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      </Card>
    );
  }
  if (data.rosterTotal === 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <UserX className="h-5 w-5 text-red-500" />
          Belum mengumpulkan
        </h2>
        <span className="text-sm text-slate-600">
          {data.missing.length} dari {data.rosterTotal} di roster
        </span>
      </div>
      {data.missing.length === 0 ? (
        <p className="mt-2 text-sm text-emerald-700">Semua mahasiswa di roster sudah mengumpulkan.</p>
      ) : (
        <ul className="mt-3 grid gap-1 text-sm text-slate-800 sm:grid-cols-2">
          {data.missing.map((m) => (
            <li key={m.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1">
              <span className="font-mono text-xs text-slate-500">{m.nim}</span>
              <span className="truncate">{m.name}</span>
              {m.class && <span className="ml-auto text-xs text-slate-400">{m.class.name}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
