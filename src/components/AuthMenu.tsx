"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogIn, LogOut, UserRound, X } from "lucide-react";
import { supabase } from "@/lib/supabase-browser";

export default function AuthMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (mounted) setUser(data.user || null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const sendMagicLink = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setStatus("Masukkan email yang valid.");
      return;
    }

    setLoading(true);
    setStatus("Mengirim tautan masuk...");
    const { error } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: { emailRedirectTo: window.location.href },
    });
    setLoading(false);
    setStatus(error ? "Tautan masuk gagal dikirim." : "Tautan masuk sudah dikirim. Cek inbox email.");
  };

  const signOut = async () => {
    setLoading(true);
    await supabase.auth.signOut();
    setLoading(false);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setStatus(null);
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700"
      >
        {user ? <UserRound className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
        <span className="hidden sm:inline max-w-32 truncate">{user?.email || "Masuk"}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900">Akun KeluhKampus</h2>
                <p className="mt-1 text-sm text-slate-500">Akun menjaga proyek, referensi, dan hasil laporan tetap privat.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X className="h-5 w-5" />
              </button>
            </div>

            {user ? (
              <div>
                <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  Masuk sebagai <strong>{user.email || user.id}</strong>
                </div>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={loading}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  <LogOut className="h-4 w-4" /> Keluar
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs font-black uppercase tracking-wider text-slate-500" htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void sendMagicLink();
                  }}
                  placeholder="nama@email.com"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={sendMagicLink}
                  disabled={loading}
                  className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {loading ? "Mengirim..." : "Kirim tautan masuk"}
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
