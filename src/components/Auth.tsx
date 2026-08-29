"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase-browser";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export default function Auth() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [projectIdInput, setProjectIdInput] = useState("");
  const [currentProject, setCurrentProject] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        window.setTimeout(() => {
          if (mounted) setUser(data?.user ?? null);
        }, 0);
      } catch {
        // ignore
      }
    }

    try {
      const current = localStorage.getItem("current_project_id") || null;
      window.setTimeout(() => {
        if (mounted) setCurrentProject(current);
      }, 0);
    } catch {
      window.setTimeout(() => {
        if (mounted) setCurrentProject(null);
      }, 0);
    }

    loadUser();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        if (mounted) setUser(session?.user ?? null);
      }, 0);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sendMagicLink = async () => {
    setStatus("Mengirim magic link...");
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) {
        setStatus("Error: " + error.message);
      } else {
        setStatus("Magic link dikirim. Cek inbox email Anda.");
      }
    } catch (error) {
      setStatus("Network error: " + getErrorMessage(error));
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setStatus("Signed out");
  };

  const notifyProjectChanged = () => {
    window.dispatchEvent(new Event("referenceResultsUpdated"));
    window.dispatchEvent(new Event("researchProjectChanged"));
  };

  const saveProject = () => {
    try {
      const projectId = projectIdInput.trim();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(projectId)) {
        setStatus("Project ID harus 3–80 karakter dan hanya memakai huruf, angka, _ atau -.");
        return;
      }
      localStorage.setItem("current_project_id", projectId);
      setCurrentProject(projectId);
      setProjectIdInput("");
      setStatus("Project dipilih: " + projectId);
      notifyProjectChanged();
    } catch {
      setStatus("Gagal menyimpan projectId");
    }
  };

  const clearProject = () => {
    localStorage.removeItem("current_project_id");
    setCurrentProject(null);
    setStatus("Project dihapus (kembali ke default)");
    notifyProjectChanged();
  };

  return (
    <div className="p-3 border rounded bg-white">
      <div className="text-sm font-bold mb-2">User (Auth)</div>

      {user ? (
        <div className="text-sm">
          <div className="mb-2">Signed in as: <strong>{user.email || user.id}</strong></div>
          <div className="flex gap-2 mb-3">
            <button onClick={signOut} className="px-3 py-1 bg-red-600 text-white rounded text-sm">Sign out</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="w-full p-2 border rounded" />
          <div className="flex gap-2">
            <button onClick={sendMagicLink} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">Kirim Magic Link</button>
            <button onClick={() => { setEmail("test@example.com"); setStatus(null); }} className="px-3 py-1 border rounded text-sm">Fill demo</button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs text-slate-500 mb-1">Project selector</div>
        <div className="flex gap-2 mb-2">
          <input value={projectIdInput} onChange={(e) => setProjectIdInput(e.target.value)} placeholder="project id (e.g. proj_local_1)" className="flex-1 p-2 border rounded text-sm" />
          <button onClick={saveProject} className="px-3 py-1 bg-green-600 text-white rounded text-sm">Pilih</button>
        </div>
        <div className="text-xs mb-2">
          Current project: <strong>{currentProject || "belum dipilih"}</strong>
        </div>
        <div className="flex gap-2">
          <button onClick={clearProject} className="px-2 py-1 border rounded text-xs">Clear project</button>
        </div>
      </div>

      {status && <div className="mt-3 text-xs text-slate-600">{status}</div>}
    </div>
  );
}
