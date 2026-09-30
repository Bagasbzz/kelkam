"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, LogIn, LogOut, UserPlus } from "lucide-react";
import Button from "@/components/ui/Button";
import { useAuth } from "@/components/AuthProvider";

/**
 * /login — Full-page login (and register) form.
 *
 * Dipakai ketika middleware (src/proxy.ts) redirect user yang belum login
 * dari path terproteksi. Selalu include `?redirect=<path>` di query.
 *
 * Pakai AuthProvider context supaya state sinkron dengan Navbar / modal lain.
 *
 * useSearchParams() WAJIB dibungkus <Suspense> di Next.js 15+ — tanpa itu
 * `next build` fail dengan "should be wrapped in a suspense boundary".
 */
export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Full-page navigation, bukan router.replace: halaman tujuan dijaga proxy
  // yang membaca cookie sesi, dan hosting me-rewrite path ke subfolder app.
  // Navigasi client-side ke sana bisa berhenti diam tanpa pindah halaman.
  function goToTarget() {
    // Hanya path internal yang diizinkan — cegah open redirect ke domain lain.
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
      return { ok: false as const, error: err instanceof Error ? err.message : "Pendaftaran gagal." };
    }
  }

  async function handleLogout() {
    setBusy(true);
    await logout();
    setBusy(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Memuat sesi…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
          <h1 className="text-2xl font-black text-slate-900">Sesi aktif</h1>
          <p className="mt-2 text-sm text-slate-600">
            Kamu masuk sebagai <strong>{user.email || user.id}</strong>.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              variant="primary"
              size="md"
              icon={ArrowRight}
              onClick={goToTarget}
            >
              Lanjut ke {redirectTarget === "/" ? "beranda" : redirectTarget}
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-blue-600"
        >
          <ArrowLeft className="h-3 w-3" />
          Beranda
        </Link>

        <div className="mt-6 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-blue-600">
          {mode === "login" ? (
            <LogIn className="h-4 w-4" />
          ) : (
            <UserPlus className="h-4 w-4" />
          )}
          {mode === "login" ? "Masuk" : "Daftar"}
        </div>
        <h1 className="mt-2 text-2xl font-black text-slate-900 md:text-3xl">
          {mode === "login" ? "Masuk ke keluhkampus" : "Buat akun keluhkampus"}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {mode === "login"
            ? "Course, token, dan progress tugas kamu nunggu di sini."
            : "Daftar dulu untuk mulai kumpulkan tugas dan simpan referensi."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode === "register" && (
            <div>
              <label
                className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500"
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
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500"
              />
            </div>
          )}
          <div>
            <label
              className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500"
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
              autoComplete="email"
              required
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500"
            />
          </div>
          <div>
            <label
              className="mb-1 block text-xs font-black uppercase tracking-wider text-slate-500"
              htmlFor="login-password"
            >
              Password
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "register" ? "Minimal 8 karakter" : "Password"}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-blue-500"
            />
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

        <div className="mt-6 border-t border-slate-100 pt-4 text-center text-sm">
          {mode === "login" ? (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("register");
              }}
              className="font-bold text-blue-600 hover:underline"
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
              className="font-bold text-blue-600 hover:underline"
            >
              Sudah punya akun? Masuk
            </button>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          Dengan masuk, kamu menyetujui penggunaan cookie untuk sesi.
        </p>
      </div>
    </div>
  );
}