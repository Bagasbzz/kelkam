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
 *   - open: boolean, modal terbuka?
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

import { getErrorMessage } from "@/lib/errors";
import { useEffect, useState } from "react";
import { Eye, EyeOff, LogIn, LogOut, UserRound, X } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);

  // Subscribe ke global trigger supaya komponen manapun (mis. SubmissionForm)
  // bisa minta buka modal login tanpa harus lewat props drilling.
  useEffect(() => {
    return subscribeLoginModal(() => setOpen(true));
  }, []);

  // Tutup dengan Escape key
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

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
      return { ok: false as const, error: getErrorMessage(error, "Pendaftaran gagal.") };
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
        aria-label={loading ? "Memuat akun" : user ? `Akun: ${user.email}` : "Masuk atau daftar"}
        className="inline-flex h-11 min-w-11 items-center justify-center gap-1.5 sm:gap-2 rounded-xl border border-slate-200 bg-white/90 px-2.5 sm:px-3 text-sm font-black text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700"
      >
        {user ? <UserRound className="h-5 w-5 xl:h-4 xl:w-4" /> : <LogIn className="h-4 w-4" />}
        {/* Belum login: "Masuk" selalu terlihat (juga di HP). Sudah login: email di layar lebar (1280px+), selain itu ikon saja. */}
        {/* Saat memuat cukup ikon (agar lebar tombol tidak melompat dan nama situs tidak terpotong di HP). */}
        {!loading && <span className={`${user ? "hidden xl:inline" : "inline"} max-w-40 truncate`}>{user?.email || "Masuk"}</span>}
      </button>

      {/* Modal login / register */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm overflow-y-auto"
        >
          <div className="w-full max-w-md my-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 id="auth-modal-title" className="text-xl font-black text-slate-900">
                  {mode === "login" ? "Masuk" : "Buat akun"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Dengan akun, tugas dan laporan kamu tersimpan dan hanya bisa dilihat oleh kamu.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
                {user.superAdmin && (
                  <a href="/superadmin" className="mt-3 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white hover:bg-slate-800">
                    Panel super admin
                  </a>
                )}
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
              // Form login / register. Teks input 16px di HP agar iPhone tidak memperbesar layar saat mengetik.
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
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
                      autoComplete="name"
                      className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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
                    inputMode="email"
                    autoComplete={mode === "login" ? "username" : "email"}
                    autoCapitalize="none"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="nama@email.com"
                    className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-base sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="auth-password">
                    Password
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={mode === "register" ? "Minimal 8 karakter" : "Password"}
                      className="w-full rounded-xl border border-slate-200 py-3 pl-4 pr-12 text-base sm:text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                      className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-400 hover:text-slate-700"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3.5 text-base sm:text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStatus(null);
                    setMode(mode === "login" ? "register" : "login");
                  }}
                  className="w-full rounded-xl py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 hover:text-blue-600"
                >
                  {mode === "login" ? <>Belum punya akun? <span className="text-blue-600">Daftar</span></> : <>Sudah punya akun? <span className="text-blue-600">Masuk</span></>}
                </button>
              </form>
            )}

            {status && <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-800">{status}</p>}
          </div>
        </div>
      )}
    </>
  );
}