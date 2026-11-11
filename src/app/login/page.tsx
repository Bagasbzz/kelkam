"use client";

import { getErrorMessage } from "@/lib/errors";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, LogOut, UserPlus } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";

/**
 * /login, Full-page login (and register) form.
 *
 * Dipakai ketika middleware (src/proxy.ts) redirect user yang belum login
 * dari path terproteksi. Selalu include `?redirect=<path>` di query.
 *
 * Pakai AuthProvider context supaya state sinkron dengan Navbar / modal lain.
 *
 * useSearchParams() WAJIB dibungkus <Suspense> di Next.js 15+, tanpa itu
 * `next build` fail dengan "should be wrapped in a suspense boundary".
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[calc(100dvh-72px)] items-center justify-center bg-slate-50">
          <p className="text-sm text-slate-500">Memuat…</p>
        </div>
      }
    >
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const searchParams = useSearchParams();
  const redirectTarget = searchParams.get("redirect") || "/";
  const initialMode = searchParams.get("mode") === "register" ? "register" : "login";

  const { user, loading, login, logout } = useAuth();

  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Full-page navigation, bukan router.replace: halaman tujuan dijaga proxy
  // yang membaca cookie sesi, dan hosting me-rewrite path ke subfolder app.
  // Navigasi client-side ke sana bisa berhenti diam tanpa pindah halaman.
  function goToTarget() {
    // Hanya path internal yang diizinkan, cegah open redirect ke domain lain.
    const safeTarget =
      redirectTarget.startsWith("/") && !redirectTarget.startsWith("//") ? redirectTarget : "/";
    window.location.assign(safeTarget);
  }

  // Kalau user udah login, redirect sekalian ke target.
  useEffect(() => {
    if (!loading && user) {
      goToTarget();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, redirectTarget]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError("Isi email dan password dulu.");
      return;
    }
    if (mode === "register" && password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    setBusy(true);
    try {
      const result = mode === "login"
        ? await login(email.trim(), password)
        : await register(email.trim(), password, name.trim() || undefined);
      if (!result.ok) {
        setError(result.error || "Gagal.");
        return;
      }
      goToTarget();
    } finally {
      setBusy(false);
    }
  }

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
    } catch (err) {
      return { ok: false as const, error: getErrorMessage(err, "Pendaftaran gagal.") };
    }
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    setBusy(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-72px)] items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Memuat sesi…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-[calc(100dvh-72px)] items-center justify-center bg-slate-50 px-4 py-8 sm:py-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900">Kamu sudah masuk</h1>
          <p className="mt-2 text-sm text-slate-600">
            Masuk sebagai <strong>{user.email || user.id}</strong>.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              variant="primary"
              size="md"
              icon={ArrowRight}
              onClick={goToTarget}
            >
              Lanjutkan
            </Button>
            <Button
              variant="outline"
              size="md"
              icon={LogOut}
              onClick={() => void handleLogout()}
              disabled={busy}
            >
              Keluar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-72px)] items-center justify-center bg-slate-50 px-4 py-8 sm:py-16">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl sm:p-8">
        <Link
          href="/"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-bold text-slate-500 hover:text-blue-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Beranda
        </Link>

        <div className="mt-4 flex items-center gap-2 text-sm font-medium text-blue-600">
          {mode === "login" ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {mode === "login" ? "Masuk" : "Daftar"}
        </div>
        <h1 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">
          {mode === "login" ? "Masuk" : "Buat akun"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {mode === "login"
            ? "Masuk untuk melihat tugas dan laporan kamu."
            : "Buat akun untuk mulai mengumpulkan tugas dan menyimpan laporan."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label
                className="mb-1 block text-sm font-medium text-slate-700"
                htmlFor="login-name"
              >
                Nama (opsional)
              </label>
              <input
                id="login-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Nama panggilan"
                maxLength={80}
                autoComplete="name"
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none transition focus:border-blue-500 sm:text-sm"
              />
            </div>
          )}
          <div>
            <label
              className="mb-1 block text-sm font-medium text-slate-700"
              htmlFor="login-email"
            >
              Email
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nama@email.com"
              autoComplete={mode === "login" ? "username" : "email"}
              required
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-base outline-none transition focus:border-blue-500 sm:text-sm"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-sm font-medium text-slate-700"
              htmlFor="login-password"
            >
              Password
            </label>
            <div className="relative">
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "register" ? "Minimal 8 karakter" : "Password"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              className="w-full rounded-xl border border-slate-200 py-3 pl-4 pr-12 text-base outline-none transition focus:border-blue-500 sm:text-sm"
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

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="md"
            icon={ArrowRight}
            isLoading={busy}
            disabled={busy}
            className="w-full"
          >
            {busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar"}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-3 text-center text-sm">
          {mode === "login" ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("register");
              }}
              className="min-h-11 w-full rounded-xl px-3 py-2.5 font-bold text-blue-600 hover:bg-slate-50 hover:underline"
            >
              Belum punya akun? Daftar di sini
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("login");
              }}
              className="min-h-11 w-full rounded-xl px-3 py-2.5 font-bold text-blue-600 hover:bg-slate-50 hover:underline"
            >
              Sudah punya akun? Masuk
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Kami memakai cookie agar kamu tetap masuk.
        </p>
      </div>
    </div>
  );
}