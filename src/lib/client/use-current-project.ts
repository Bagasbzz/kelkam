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
