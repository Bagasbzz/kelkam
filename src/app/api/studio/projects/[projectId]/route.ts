/**
 * /api/studio/projects/[projectId]
 * -----------------------------------------------------------------------------
 * Single Studio Project CRUD.
 *
 * GET — ambil project + semua relasi (sources, questions, decisions, artifacts, revisions).
 *   Dipakai oleh Studio page untuk hydrate state dari cloud.
 *
 * PUT — update field tertentu.
 *   Body: { name?, revision?, importedFromLegacy?, intake?, specification?, formatProfile?, readiness? }
 *   - Hanya field yang didefine di schema yang akan di-update.
 *   - revision di-increment otomatis kalau dikirim (untuk version tracking).
 *
 * DELETE — hapus project (cascade ke sources/questions/decisions/artifacts/revisions).
 *
 * Semua endpoint ownership-checked (loadOwned) — return 404 kalau bukan milik user.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

/** Helper: load project + verify owner. Return null kalau bukan milik user. */
async function loadOwned(projectId: string, userId: string) {
  const project = await prisma.studioProject.findUnique({ where: { projectId } });
  if (!project || project.ownerId !== userId) return null;
  return project;
}

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const project = await loadOwned(projectId, auth.user.id);
  if (!project) return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });

  // Parallel fetch semua relasi — hemat latency.
  const [sources, questions, decisions, artifacts, revisions] = await Promise.all([
    prisma.studioSource.findMany({ where: { projectId, ownerId: auth.user.id }, orderBy: { createdAt: "asc" } }),
    prisma.studioQuestion.findMany({ where: { projectId, ownerId: auth.user.id }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] }),
    prisma.studioDecision.findMany({ where: { projectId, ownerId: auth.user.id }, orderBy: { createdAt: "asc" } }),
    prisma.studioArtifact.findMany({ where: { projectId, ownerId: auth.user.id } }),
    prisma.studioProjectRevision.findMany({ where: { projectId, ownerId: auth.user.id }, orderBy: { revision: "desc" }, take: 10 }),
  ]);

  return NextResponse.json({ success: true, data: { project, sources, questions, decisions, artifacts, revisions } });
}

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const existing = await loadOwned(projectId, auth.user.id);
  if (!existing) return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    // Hanya set field yang dikirim — sisanya undefined biar Prisma skip.
    const updated = await prisma.studioProject.update({
      where: { projectId },
      data: {
        name: typeof body.name === "string" ? body.name.slice(0, 200) : undefined,
        revision: typeof body.revision === "number" ? body.revision + 1 : undefined,
        importedFromLegacy: typeof body.importedFromLegacy === "boolean" ? body.importedFromLegacy : undefined,
        intake: body.intake && typeof body.intake === "object" ? (body.intake as object) : undefined,
        specification: body.specification && typeof body.specification === "object" ? (body.specification as object) : undefined,
        formatProfile: body.formatProfile && typeof body.formatProfile === "object" ? (body.formatProfile as object) : undefined,
        readiness: body.readiness && typeof body.readiness === "object" ? (body.readiness as object) : undefined,
      },
    });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("API /api/studio/projects/[id] PUT failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memperbarui proyek." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const existing = await loadOwned(projectId, auth.user.id);
  if (!existing) return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });

  // Cascade delete (sources/questions/decisions/artifacts/revisions) dihandle
  // oleh onDelete: Cascade di schema.prisma.
  await prisma.studioProject.delete({ where: { projectId } });
  return NextResponse.json({ success: true });
}