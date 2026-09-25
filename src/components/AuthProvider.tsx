/**
 * src/components/AuthProvider.tsx
 * -----------------------------------------------------------------------------
 * React Context untuk autentikasi user.
 *
 * Provider ini membungkus seluruh app (lihat src/app/layout.tsx) dan menyediakan:
 *   - `user`: SessionUser | null — siapa yang sedang login
 *   - `loading`: boolean — apakah initial fetch masih jalan
 *   - `refresh()`: panggil ulang /api/auth/me
 *   - `login(email, password)`: hit /api/auth/login
 *   - `register(email, password, name?)`: hit /api/auth/register
 *   - `logout()`: hit /api/auth/logout
 *
 * Pakai di komponen:
 *   import { useAuth, authenticatedFetch } from "@/components/AuthProvider";
 *
 *   function MyComponent() {
 *     const { user, login, logout } = useAuth();
 *     if (user) return <p>Halo, {user.email}</p>;
 *   }
 *
 * `authenticatedFetch()`: wrapper fetch yang include credentials. Dipakai
 * untuk request ke API yang butuh cookie session (semua /api routes kecuali
 * waitlist). credentials: "same-origin" supaya cookie terkirim.
 *
 * Karena pakai cookie httpOnly (bukan Authorization header), TIDAK ada Bearer
 * token yang perlu di-include — browser otomatis kirim cookie kalau
 * credentials="same-origin".
 * -----------------------------------------------------------------------------
 */

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Module-level modal trigger
// ---------------------------------------------------------------------------

/**
 * Event emitter supaya komponen manapun bisa minta buka modal login,
 * tanpa harus nge-bubble callback lewat props.
 *
 * AuthMenu subscribe ke ini (lihat useEffect di bawah) — dia satu-satunya
 * yang render modal login (state-nya lokal supaya gak re-render seluruh app).
 */
let loginModalListeners = new Set<() => void>();

function emitLoginModal() {
  for (const fn of loginModalListeners) fn();
}

export function subscribeLoginModal(fn: () => void) {
  loginModalListeners.add(fn);
  return () => {
    loginModalListeners.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (email: string, password: string, name?: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  /**
   * Trigger global login modal dari komponen manapun. Berguna untuk CTA
   * "Login untuk submit" di halaman Tugas yang posisinya di luar Navbar.
   *
   * Implementasi: AuthMenu subscribe ke event ini via state global (lihat
   * file ini — kita pakai `authModalOpen` setter yang di-share lewat
   * module-level event emitter supaya AuthMenu bisa re-render).
   */
  openLoginModal: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  /** Refresh state dari /api/auth/me. Dipanggil saat mount & setelah login/logout. */
  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" });
      const json = await resp.json().catch(() => ({ success: false }));
      setUser(json?.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Fetch /api/auth/me saat mount untuk tau status login awal. */
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Login via /api/auth/login. Kalau sukses, update state lokal. */
  const login = useCallback<AuthContextValue["login"]>(async (email, password) => {
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const json = await resp.json().catch(() => ({ success: false }));
      if (!json?.success) {
        return { ok: false, error: json?.error || "Login gagal." };
      }
      setUser(json.user);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Login gagal." };
    }
  }, []);

  /** Register via /api/auth/register. Kalau sukses, otomatis login. */
  const register = useCallback<AuthContextValue["register"]>(async (email, password, name) => {
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password, name }),
      });
      const json = await resp.json().catch(() => ({ success: false }));
      if (!json?.success) {
        return { ok: false, error: json?.error || "Pendaftaran gagal." };
      }
      setUser(json.user);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Pendaftaran gagal." };
    }
  }, []);

  /** Logout: hit /api/auth/logout, lalu clear state lokal. */
  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      setUser(null);
    }
  }, []);

  /** Buka modal login dari komponen manapun. Bridge ke AuthMenu via event. */
  const openLoginModal = useCallback(() => {
    emitLoginModal();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, refresh, login, register, logout, openLoginModal }),
    [user, loading, refresh, login, register, logout, openLoginModal]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth harus dipakai di dalam <AuthProvider>.");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/**
 * Wrapper fetch yang include credentials. Supaya cookie session terkirim
 * otomatis ke API route (yang selanjutnya memvalidasi via getCurrentUser).
 *
 * Pakai untuk SEMUA request ke /api/* (kecuali publik seperti /api/waitlist).
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.headers || {}),
    },
  });
}