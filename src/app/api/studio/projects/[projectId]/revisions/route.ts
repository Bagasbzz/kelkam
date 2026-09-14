/**
 * /api/studio/projects/[projectId]/revisions
 * -----------------------------------------------------------------------------
 * Studio Project Revision: snapshot histori project untuk rollback & audit.
 *
 * Setiap kali user "lock" atau "approve" artifact (atau perubahan besar),
 * client bisa POST snapshot lengkap project ke sini. Revision number auto
 * match dengan project.revision saat ini.
 *
 * GET — list revision terakhir (max 20).
 *   Order by revision DESC. Berguna untuk UI "history".
 *
 * POST — buat snapshot baru.
 *   Body: { reason?: string, snapshot: Record<string, unknown> }
 *   - Snapshot biasanya berisi { sources, questions, decisions, artifacts } lengkap.
 *   - Bisa di-restore di frontend dengan menulis balik ke endpoint PUT.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const items = await prisma.studioProjectRevision.findMany({
    where: { projectId, ownerId: auth.user.id },
    orderBy: { revision: "desc" },
    take: 20,
  });
  return NextResponse.json({ success: true, data: items });
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const project = await prisma.studioProject.findUnique({ where: { projectId } });
  if (!project || project.ownerId !== auth.user.id) {
    return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { reason?: string; snapshot?: Record<string, unknown> };
    const revision = await prisma.studioProjectRevision.create({
      data: {
        projectId,
        ownerId: auth.user.id,
        revision: project.revision,
        reason: (body.reason || "").slice(0, 200),
        snapshot: (body.snapshot || {}) as object,
      },
    });
    return NextResponse.json({ success: true, data: revision });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/revisions POST failed:", error);
    return NextResponse.json({ success: false, error: "Gagal membuat snapshot." }, { status: 500 });
  }
}