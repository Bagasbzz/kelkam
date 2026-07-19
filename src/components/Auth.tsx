"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase-browser";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [user, setUser] = useState<any | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [projectIdInput, setProjectIdInput] = useState("");
  const [currentProject, setCurrentProject] = useState<string | null>(() => {
    try {
      return localStorage.getItem("current_project_id") || null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let mounted = true;

    async function loadUser() {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setUser(data?.user ?? null);
      } catch {
        // ignore
      }
    }

    loadUser();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
    } catch (e: any) {
      setStatus("Network error: " + String(e?.message || e));
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
      if (!projectIdInput) {
        setStatus("Masukkan projectId terlebih dahulu");
        return;
      }
      localStorage.setItem("current_project_id", projectIdInput);
      setCurrentProject(projectIdInput);
      setProjectIdInput("");
      setStatus("Project dipilih: " + projectIdInput);
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
          Current project: <strong>{currentProject || "proj_local_1 (default)"}</strong>
        </div>
        <div className="flex gap-2">
          <button onClick={clearProject} className="px-2 py-1 border rounded text-xs">Clear project</button>
        </div>
      </div>

      {status && <div className="mt-3 text-xs text-slate-600">{status}</div>}
    </div>
  );
}
