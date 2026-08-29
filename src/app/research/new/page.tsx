"use client";

import { useEffect, useState } from "react";
import ResearchChat from "@/components/ResearchChat";
import ProjectBrief from "@/components/ProjectBrief";
import ReferenceLibrary from "@/components/ReferenceLibrary";
import EvidenceMatrix from "@/components/EvidenceMatrix";
import NoveltyWorkbench from "@/components/NoveltyWorkbench";
import OutlineWorkbench from "@/components/OutlineWorkbench";
import ReportDraftWorkbench from "@/components/ReportDraftWorkbench";
import { FolderKanban, X } from "lucide-react";
import type { ResearchBrief } from "@/lib/types/research-project";

export default function NewResearchPage() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectIdInput, setProjectIdInput] = useState("");
  const [projectStatus, setProjectStatus] = useState<string | null>(null);
  const [brief, setBrief] = useState<Partial<ResearchBrief>>({});

  const notifyProjectChanged = () => {
    window.dispatchEvent(new Event("referenceResultsUpdated"));
    window.dispatchEvent(new Event("researchProjectChanged"));
  };

  const saveProjectId = () => {
    const nextProjectId = projectIdInput.trim();

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(nextProjectId)) {
      setProjectStatus("Project ID harus 3-80 karakter, diawali huruf/angka, dan hanya memakai huruf, angka, _ atau -.");
      return;
    }

    try {
      localStorage.setItem("current_project_id", nextProjectId);
      setProjectId(nextProjectId);
      setProjectIdInput("");
      setProjectStatus(`Project aktif: ${nextProjectId}`);
      notifyProjectChanged();
    } catch {
      setProjectStatus("Project ID gagal disimpan di browser.");
    }
  };

  const clearProjectId = () => {
    try {
      localStorage.removeItem("current_project_id");
      setProjectId(null);
      setProjectStatus("Project lokal dikosongkan.");
      notifyProjectChanged();
    } catch {
      setProjectStatus("Project ID gagal dihapus dari browser.");
    }
  };

  useEffect(() => {
    const loadProjectId = () => {
      try {
        const savedProjectId = localStorage.getItem("current_project_id") || null;
        window.setTimeout(() => setProjectId(savedProjectId), 0);
      } catch {
        window.setTimeout(() => setProjectId(null), 0);
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
          <NoveltyWorkbench brief={brief} />
          <OutlineWorkbench brief={brief} />
          <ReportDraftWorkbench brief={brief} />
        </div>

        <div className="xl:col-span-1">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-900">Project lokal</h2>
              </div>
              {projectId && (
                <button
                  type="button"
                  onClick={clearProjectId}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Kosongkan project lokal"
                  title="Kosongkan project lokal"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <label htmlFor="research-project-id" className="mb-1 block text-xs font-medium text-slate-600">
              ID project
            </label>
            <div className="flex gap-2">
              <input
                id="research-project-id"
                value={projectIdInput}
                onChange={(event) => setProjectIdInput(event.target.value)}
                placeholder={projectId || "contoh: skripsi_local_1"}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={saveProjectId}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Pakai
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Aktif: <span className="font-medium text-slate-700">{projectId || "default browser"}</span>
            </p>
            {projectStatus && <p className="mt-2 text-xs text-slate-600">{projectStatus}</p>}
          </section>
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
