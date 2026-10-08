"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, KeyRound, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { authenticatedFetch, useAuth } from "@/components/AuthProvider";

type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  createdAt: string;
  submissions: number;
  activeSessions: number;
};

/** Sandi acak 10 karakter, tanpa huruf ambigu (0/O, 1/l/I). */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * /tugas/admin694/users — super admin: daftar akun + reset sandi.
 * Use case: mahasiswa lupa sandi → admin set sandi baru tanpa hapus akun
 * (riwayat pengumpulan tetap utuh).
 */
export default function AdminUsersPage() {
  const { user, loading: authLoading, openLoginModal } = useAuth();

  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal reset sandi
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Gagal memuat daftar user.");
      setUsers(data.users);
      setTotal(data.total);
      setPageSize(data.pageSize);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat daftar user.");
    } finally {
      setLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    if (authLoading || !user || user.role !== "ADMIN") return;
    void load();
  }, [authLoading, user, load]);

  function openReset(u: AdminUser) {
    setTarget(u);
    setNewPassword(generatePassword());
    setResult(null);
    setCopied(false);
  }

  async function submitReset() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await authenticatedFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-password", userId: target.id, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Gagal mengganti sandi.");
      setResult({ email: target.email, password: newPassword });
      setTarget(null);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengganti sandi.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    await navigator.clipboard.writeText(`Email: ${result.email}\nSandi baru: ${result.password}`);
    setCopied(true);
  }

  if (!authLoading && !user) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 text-center">
        <h1 className="text-2xl font-black text-slate-900">Masuk dulu</h1>
        <div className="pt-4">
          <Button onClick={openLoginModal} variant="primary" size="md">Masuk</Button>
        </div>
      </div>
    );
  }
  if (!authLoading && user && user.role !== "ADMIN") {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-24 text-center">
        <h1 className="text-2xl font-black text-slate-900">Khusus admin</h1>
        <p className="mt-2 text-sm text-slate-600">Akun kamu tidak punya akses ke halaman ini.</p>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-24 md:px-8 md:py-28">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-[2rem] bg-slate-950 px-7 py-10 text-white shadow-2xl md:px-12">
          <Link href="/tugas/admin694" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
            <ArrowLeft className="h-3 w-3" /> Admin Tugas
          </Link>
          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-blue-300">
            <ShieldCheck className="h-4 w-4" /> Super Admin
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Daftar akun</h1>
          <p className="mt-2 text-sm text-slate-300">
            Reset sandi mahasiswa yang lupa tanpa menghapus akun — riwayat pengumpulan tetap aman.
          </p>
        </div>

        {result && (
          <Card className="border-emerald-200 bg-emerald-50">
            <p className="text-sm font-bold text-emerald-900">Sandi baru untuk {result.email}</p>
            <p className="mt-1 text-xs text-emerald-800">Simpan sekarang — tidak akan ditampilkan lagi.</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-white px-3 py-2 font-mono text-base font-bold tracking-wider text-slate-900">{result.password}</code>
              <Button onClick={copyResult} variant="primary" size="sm">
                <Copy className="mr-1 h-3 w-3" /> {copied ? "Tersalin" : "Salin email + sandi"}
              </Button>
              <button onClick={() => setResult(null)} className="text-xs text-slate-500 underline">Tutup</button>
            </div>
          </Card>
        )}

        <Card>
          <form
            onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q.trim()); }}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="relative flex-1 min-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Cari email atau nama…"
                className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm"
              />
            </div>
            <Button type="submit" variant="primary" size="sm">Cari</Button>
            <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" title="Muat ulang">
              <RefreshCw className="h-4 w-4" />
            </button>
            <span className="ml-auto text-xs text-slate-500">{total} akun</span>
          </form>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Nama</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Kumpul</th>
                  <th className="py-2 pr-3">Daftar</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-500"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
                )}
                {!loading && users.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-slate-500">Tidak ada user.</td></tr>
                )}
                {!loading && users.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs">{u.email}</td>
                    <td className="py-2 pr-3">{u.name || <span className="text-slate-400">—</span>}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${u.role === "ADMIN" ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-700"}`}>{u.role}</span>
                    </td>
                    <td className="py-2 pr-3">{u.submissions}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{new Date(u.createdAt).toLocaleDateString("id-ID")}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => openReset(u)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <KeyRound className="h-3 w-3" /> Reset sandi
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2 text-xs">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border px-2 py-1 disabled:opacity-40">Sebelumnya</button>
              <span>{page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border px-2 py-1 disabled:opacity-40">Berikutnya</button>
            </div>
          )}
        </Card>
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4" onClick={() => !submitting && setTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-black text-slate-900">Reset sandi</h2>
            <p className="mt-1 text-sm text-slate-600">
              Untuk <span className="font-mono">{target.email}</span>. Semua sesi login lama akan dicabut.
            </p>
            <label className="mt-4 block text-xs font-semibold text-slate-700">Sandi baru (min. 8 karakter)</label>
            <div className="mt-1 flex gap-2">
              <input
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                autoComplete="off"
              />
              <button type="button" onClick={() => setNewPassword(generatePassword())} className="rounded-xl border px-3 text-xs" title="Acak ulang">
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={submitting} onClick={() => setTarget(null)} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">Batal</button>
              <Button onClick={submitReset} variant="primary" size="sm" disabled={submitting || newPassword.length < 8}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ganti sandi"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
