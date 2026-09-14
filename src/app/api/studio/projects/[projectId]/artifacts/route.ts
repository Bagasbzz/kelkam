/**
 * /api/studio/projects/[projectId]/artifacts
 * -----------------------------------------------------------------------------
 * StudioArtifact: output deliverable dari project (project-spec, requirements,
 * actor-matrix, use-case diagram, activity diagram, sequence diagram, test-cases,
 * outline, report-draft, format-profile, final-docx).
 *
 * Composite primary key (projectId, artifactId) — composite uniqueness.
 *
 * POST — upsert artifact (insert kalau baru, update kalau sudah ada).
 *   Body: { artifactId, kind, title, description?, status?, dependencyIds?, decisionIds?, currentVersion?, approvedVersion?, payload?, validationIssues? }
 *   - artifactId WAJIB diisi (composite PK).
 *   - status: "not_started" | "draft" | "stale" | "ready" | "approved" | "locked"
 *   - Kalau status ready/approved → set generatedAt = now.
 *
 * Payload & validationIssues disimpan sebagai JSON (lihat schema.prisma).
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const project = await prisma.studioProject.findUnique({ where: { projectId } });
  if (!project || project.ownerId !== auth.user.id) {
    return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });
  }
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
    }
    const artifactId = String(body.artifactId || "").slice(0, 100);
    if (!artifactId) return NextResponse.json({ success: false, error: "artifactId wajib diisi." }, { status: 400 });

    const artifact = await prisma.studioArtifact.upsert({
      where: { projectId_artifactId: { projectId, artifactId } },
      create: {
        projectId,
        ownerId: auth.user.id,
        artifactId,
        kind: String(body.kind || "artifact").slice(0, 50),
        title: String(body.title || artifactId).slice(0, 200),
        description: String(body.description || "").slice(0, 1_000),
        status: String(body.status || "not_started").slice(0, 20),
        dependencyIds: Array.isArray(body.dependencyIds) ? (body.dependencyIds as object) : [],
        decisionIds: Array.isArray(body.decisionIds) ? (body.decisionIds as object) : [],
        currentVersion: typeof body.currentVersion === "number" ? Math.max(0, Math.floor(body.currentVersion)) : 0,
        approvedVersion: typeof body.approvedVersion === "number" ? body.approvedVersion : null,
        payload: body.payload && typeof body.payload === "object" ? (body.payload as object) : ({} as object),
        validationIssues: Array.isArray(body.validationIssues) ? (body.validationIssues as object) : [],
      },
      update: {
        status: String(body.status || "not_started").slice(0, 20),
        currentVersion: typeof body.currentVersion === "number" ? Math.max(0, Math.floor(body.currentVersion)) : undefined,
        approvedVersion: typeof body.approvedVersion === "number" ? body.approvedVersion : undefined,
        payload: body.payload && typeof body.payload === "object" ? (body.payload as object) : undefined,
        validationIssues: Array.isArray(body.validationIssues) ? (body.validationIssues as object) : undefined,
        generatedAt: body.status === "ready" || body.status === "approved" ? new Date() : undefined,
        updatedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true, data: artifact });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/artifacts POST failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memperbarui artefak." }, { status: 500 });
  }
}