"use client";

import {
  STUDIO_SCHEMA_VERSION,
  createStudioProject,
  makeStudioId,
  normalizeStudioProject,
  refreshStudioProject,
  type ArtifactStatus,
  type ProjectType,
  type SourceAuthority,
  type SourceKind,
  type StudioProject,
  type StudioSource,
  type StudioWorkspace,
} from "@/lib/studio/engine";

export const STUDIO_WORKSPACE_KEY = "keluhkampus_project_studio_v1";
export const LEGACY_REPORT_KEY = "report_builder_project_v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

interface LegacySource {
  id?: string;
  kind?: string;
  title?: string;
  content?: string;
  fileName?: string;
}

interface LegacyDiagram {
  id?: string;
  type?: string;
  status?: string;
  diagramData?: { nodes?: unknown[]; edges?: unknown[] };
}

interface LegacyReportProject {
  projectType?: string;
  title?: string;
  topic?: string;
  course?: string;
  institution?: string;
  citationStyle?: string;
  sources?: LegacySource[];
  outline?: unknown[];
  diagrams?: LegacyDiagram[];
  reportDraft?: { content?: string; generatedAt?: string };
}

const projectTypes = new Set<ProjectType>([
  "thesis",
  "proposal",
  "capstone",
  "course",
  "practicum",
  "paper",
  "formal",
]);

function asProjectType(value: string | undefined): ProjectType {
  return value && projectTypes.has(value as ProjectType) ? (value as ProjectType) : "formal";
}

function legacySourceKind(value: string | undefined): SourceKind {
  const mapping: Record<string, SourceKind> = {
    brief: "brief",
    guide: "campus_guide",
    example: "example",
    reference: "reference",
    code: "code",
    note: "note",
  };
  return mapping[value || ""] || "note";
}

function legacySourceAuthority(kind: SourceKind): SourceAuthority {
  if (["brief", "campus_guide"].includes(kind)) return "primary";
  if (kind === "example") return "example_only";
  if (["code", "dataset", "reference"].includes(kind)) return "supporting";
  return "unverified";
}

function artifactStatusFromLegacy(diagram: LegacyDiagram): ArtifactStatus {
  const hasData = Boolean(diagram.diagramData?.nodes?.length || diagram.diagramData?.edges?.length);
  if (diagram.status === "approved" && hasData) return "approved";
  if (hasData || diagram.status === "draft") return "draft";
  return "not_started";
}

function diagramArtifactId(type: string | undefined) {
  if (type === "usecase") return "usecase-main";
  if (type === "activity" || type === "flowchart") return "activity-main";
  if (type === "sequence" || type === "communication") return "sequence-main";
  return "";
}

export function importLegacyReportProject(
  value: unknown,
  timestamp = new Date().toISOString(),
): StudioProject | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as LegacyReportProject;
  const hasMeaningfulData = Boolean(
    legacy.title?.trim() ||
      legacy.topic?.trim() ||
      legacy.sources?.length ||
      legacy.outline?.length ||
      legacy.diagrams?.length ||
      legacy.reportDraft?.content?.trim(),
  );
  if (!hasMeaningfulData) return null;

  const project = createStudioProject(
    {
      name: legacy.title?.trim() || "Proyek lama hasil import",
      importedFromLegacy: true,
      intake: {
        projectType: asProjectType(legacy.projectType),
        title: legacy.title?.trim() || "",
        topic: legacy.topic?.trim() || "",
        problem: legacy.topic?.trim() || "",
        objective: legacy.topic?.trim()
          ? `Menyusun dan menyelesaikan ${legacy.title?.trim() || legacy.topic.trim()} berdasarkan bahan yang tersedia.`
          : "",
        course: legacy.course?.trim() || "",
        institution: legacy.institution?.trim() || "",
      },
    },
    timestamp,
  );

  project.sources = (legacy.sources || [])
    .filter((source) => source?.title?.trim() && source?.content?.trim())
    .map((source): StudioSource => {
      const kind = legacySourceKind(source.kind);
      return {
        id: source.id?.trim() || makeStudioId("source"),
        kind,
        authority: legacySourceAuthority(kind),
        title: source.title?.trim() || "Sumber lama",
        content: source.content?.trim() || "",
        fileName: source.fileName?.trim() || undefined,
        provenance: "Diimpor dari Report Builder lokal",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

  const citation = legacy.citationStyle?.trim();
  if (citation) {
    project.decisions.push({
      id: makeStudioId("decision"),
      key: "citation.style",
      category: "citation",
      statement: "Gaya sitasi dan batas sumber yang boleh dipakai apa?",
      value: citation === "APA" ? "APA 7" : citation,
      rationale: "Diimpor dari pengaturan Report Builder lama.",
      status: "confirmed",
      origin: "legacy",
      sourceIds: [],
      affectedArtifactIds: ["project-spec", "outline", "report-draft", "format-profile", "final-docx"],
      version: 1,
      history: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  (legacy.diagrams || []).forEach((diagram) => {
    const artifactId = diagramArtifactId(diagram.type);
    if (!artifactId) return;
    const artifact = project.artifacts.find((item) => item.id === artifactId);
    if (!artifact) return;
    artifact.status = artifactStatusFromLegacy(diagram);
    artifact.currentVersion = artifact.status === "not_started" ? 0 : 1;
    artifact.approvedVersion = artifact.status === "approved" ? 1 : undefined;
    artifact.generatedAt = artifact.currentVersion ? timestamp : undefined;
    artifact.updatedAt = timestamp;
  });

  if (legacy.outline?.length) {
    const outline = project.artifacts.find((artifact) => artifact.id === "outline");
    if (outline) {
      outline.status = "draft";
      outline.currentVersion = 1;
      outline.generatedAt = timestamp;
    }
  }
  if (legacy.reportDraft?.content?.trim()) {
    const report = project.artifacts.find((artifact) => artifact.id === "report-draft");
    if (report) {
      report.status = "draft";
      report.currentVersion = 1;
      report.generatedAt = legacy.reportDraft.generatedAt || timestamp;
      report.updatedAt = timestamp;
    }
    project.sources.unshift({
      id: makeStudioId("source"),
      kind: "example",
      authority: "supporting",
      title: "Draft laporan dari workspace lama",
      content: legacy.reportDraft.content.trim(),
      provenance: "Diimpor sebagai bahan; bukan keputusan final",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  project.revision += 1;
  project.updatedAt = timestamp;
  return refreshStudioProject(project, timestamp);
}

export function createStudioWorkspace(
  project = createStudioProject(),
  timestamp = new Date().toISOString(),
): StudioWorkspace {
  return {
    schemaVersion: STUDIO_SCHEMA_VERSION,
    activeProjectId: project.id,
    projects: [project],
    savedAt: timestamp,
  };
}

export function loadStudioWorkspace(storage: StorageLike): StudioWorkspace {
  const timestamp = new Date().toISOString();
  const raw = storage.getItem(STUDIO_WORKSPACE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StudioWorkspace>;
      const projects = Array.isArray(parsed.projects)
        ? parsed.projects.map((project) => normalizeStudioProject(project, timestamp))
        : [];
      if (projects.length > 0) {
        const activeProjectId = projects.some((project) => project.id === parsed.activeProjectId)
          ? String(parsed.activeProjectId)
          : projects[0].id;
        return {
          schemaVersion: STUDIO_SCHEMA_VERSION,
          activeProjectId,
          projects,
          savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : timestamp,
        };
      }
    } catch {
      // Fall through to safe recovery and optional legacy import.
    }
  }

  const legacyRaw = storage.getItem(LEGACY_REPORT_KEY);
  if (legacyRaw) {
    try {
      const imported = importLegacyReportProject(JSON.parse(legacyRaw), timestamp);
      if (imported) return createStudioWorkspace(imported, timestamp);
    } catch {
      // Invalid legacy data must never prevent Studio from opening.
    }
  }
  return createStudioWorkspace(createStudioProject({}, timestamp), timestamp);
}

export function saveStudioWorkspace(storage: StorageLike, workspace: StudioWorkspace) {
  const saved: StudioWorkspace = {
    ...workspace,
    schemaVersion: STUDIO_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
  };
  storage.setItem(STUDIO_WORKSPACE_KEY, JSON.stringify(saved));
  return saved;
}

export function duplicateStudioProject(project: StudioProject, timestamp = new Date().toISOString()) {
  const duplicate = normalizeStudioProject(project, timestamp);
  duplicate.id = makeStudioId("project");
  duplicate.name = `${project.name} — Salinan`;
  duplicate.createdAt = timestamp;
  duplicate.updatedAt = timestamp;
  duplicate.revision = 1;
  duplicate.artifacts = duplicate.artifacts.map((artifact) => ({
    ...artifact,
    status: artifact.status === "locked" ? "approved" : artifact.status,
    lockedAt: undefined,
    updatedAt: timestamp,
  }));
  return refreshStudioProject(duplicate, timestamp);
}
