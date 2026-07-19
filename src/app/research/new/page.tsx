"use client";

import { useEffect, useState } from "react";
import ResearchChat from "@/components/ResearchChat";
import ProjectBrief from "@/components/ProjectBrief";
import ReferenceLibrary from "@/components/ReferenceLibrary";
import EvidenceMatrix from "@/components/EvidenceMatrix";
import Auth from "@/components/Auth";
import type { ResearchBrief } from "@/lib/types/research-project";

export default function NewResearchPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [brief, setBrief] = useState<Partial<ResearchBrief>>({});

  useEffect(() => {
    const loadProjectId = () => {
      try {
        setProjectId(localStorage.getItem("current_project_id") || null);
      } catch {
        setProjectId(null);
      }
    };

    loadProjectId();
    window.addEventListener("researchProjectChanged", loadProjectId);
    return () => window.removeEventListener("researchProjectChanged", loadProjectId);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Buat Proyek Riset Baru</h1>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-6">
          <ResearchChat
            projectId={projectId}
            brief={brief}
            onUpdateBrief={(patch) => setBrief((prev) => ({ ...prev, ...patch }))}
          />
          <EvidenceMatrix />
        </div>

        <div className="xl:col-span-1">
          <Auth />
          <div className="mt-3" />
          <ProjectBrief
            projectId={projectId}
            value={brief}
            onChange={(nextBrief) => setBrief(nextBrief)}
          />
          <div className="mt-4">
            <ReferenceLibrary initialQuery={brief.topic || brief.title || ""} />
          </div>
        </div>
      </div>
    </div>
  );
}
