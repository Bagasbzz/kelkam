/**
 * src/lib/client/use-current-project.ts
 * -----------------------------------------------------------------------------
 * React hook untuk baca/monitor `current_project_id` di localStorage.
 *
 * Project ID disimpan per-user di localStorage (key: "current_project_id")
 * supaya multi-device tidak konflik (project itu milik user spesifik, lihat
 * tabel `projects.owner_id`).
 *
 * Pakai:
 *   import { useCurrentProjectId } from "@/lib/client/use-current-project";
 *
 *   function MyComponent() {
 *     const projectId = useCurrentProjectId();
 *     // projectId: string | null
 *   }
 *
 * Event yang di-monitor:
 *   - `researchProjectChanged` — di-dispatch ketika project ID diubah di
 *     tempat lain (lihat project-store.ts).
 * -----------------------------------------------------------------------------
 */

"use client";

import { useEffect, useState } from "react";

export function useCurrentProjectId() {
  const [projectId, setProjectId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      try {
        setProjectId(localStorage.getItem("current_project_id") || null);
      } catch {
        setProjectId(null);
      }
    };

    refresh();
    window.addEventListener("researchProjectChanged", refresh);
    return () => window.removeEventListener("researchProjectChanged", refresh);
  }, []);

  return projectId;
}