/**
 * src/components/AuthMenu.tsx
 * -----------------------------------------------------------------------------
 * Menu autentikasi di navbar.
 *
 * Fungsi:
 *   - Tampilkan status user (email kalau login, "Masuk" kalau belum).
 *   - Modal login & register dengan toggle mode.
 *   - Tombol logout untuk user yang sudah login.
 *
 * State lokal (tidak di-context supaya modal UI tidak re-render seluruh app):
 *   - open: boolean — modal terbuka?
 *   - mode: "login" | "register"
 *   - email, password, name: form values
 *   - status: pesan error/info
 *   - busy: loading state saat submit
 *
 * Mode 'register' menambah field "Nama (opsional)".
 *
 * Note: untuk register, kita panggil /api/auth/register langsung (bukan
 * lewat context's register()) supaya error message dari server ditampilkan
 * dengan lebih presisi.
 * -----------------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, UserRound, X } from "lucide-react";
import { subscribeLoginModal, useAuth } from "@/components/AuthProvider";

export default function AuthMenu() {
  const { user, loading, login, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Subscribe ke global trigger supaya komponen manapun (mis. SubmissionForm)
  // bisa minta buka modal login tanpa harus lewat props drilling.
  useEffect(() => {
    return subscribeLoginModal(() => setOpen(true));
  }, []);

  /**
   * Submit handler. Mode 'register' dipanggil langsung ke /api/auth/register
   * untuk dapat error message yang lebih presisi dari server.
   * Mode 'login' pakai context.login() (yang juga update state).
   */
  async function submit() {
    setStatus(null);
    setBusy(true);
    const result = mode === "login"
      ? await login(email, password)
      : await register(email, password, name);
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error || "Gagal.");
      return;
    }
    setOpen(false);
    setStatus(null);
    setEmail("");
    setPassword("");
    setName("");
  }

  /**
   * Direct register call (bypass context) supaya error dari server
   * bisa ditampilkan apa adanya. Context's register() juga OK tapi
   * kita mau kontrol penuh di sini.
   */
  async function register(email: string, password: string, name?: string) {
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, name }),
      });
      const json = await resp.json().catch(() => ({ success: false }));
      if (!json?.success) return { ok: false as const, error: json?.error || "Pendaftaran gagal." };
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Pendaftaran gagal." };
    }
  }

  return (
    <>
      {/* Trigger button (selalu tampil di navbar) */}
      <button
        type="button"
        onClick={() => {
          setStatus(null);
          setOpen(true);
          setMode("login");
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700"
      >
        {user ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
        <span className="hidden sm:inline max-w-32 truncate">{loading ? "Memuat…" : user?.email || "Masuk"}</span>
      </button>

      {/* Modal login / register */}
      {open && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  {mode === "login" ? "Masuk ke keluhkampus" : "Daftar keluhkampus"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Akun menjaga proyek, referensi, dan hasil laporan tetap privat.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {user ? (
              // User sudah login → tampilkan info + tombol keluar
              <div>
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  Masuk sebagai <strong>{user.email || user.id}</strong>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    await logout();
                    setBusy(false);
                    setOpen(false);
                  }}
                  disabled={busy}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" /> Keluar
                </button>
              </div>
            ) : (
              // Form login / register
              <div className="space-y-3">
                {mode === "register" && (
                  <div>
                    <label className="block text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="auth-name">
                      Nama (opsional)
                    </label>
                    <input
                      id="auth-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Nama panggilan"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="auth-email">
                    Email
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submit();
                    }}
                    placeholder="nama@email.com"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="auth-password">
                    Password
                  </label>
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void submit();
                    }}
                    placeholder={mode === "register" ? "Minimal 8 karakter" : "Password"}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setMode(mode === "login" ? "register" : "login");
                  }}
                  className="w-full text-xs font-bold text-slate-500 hover:text-blue-600"
                >
                  {mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}
                </button>
              </div>
            )}

            {status && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800">{status}</p>}
          </div>
        </div>
      )}
    </>
  );
}