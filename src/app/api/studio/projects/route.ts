/**
 * /api/studio/projects
 * -----------------------------------------------------------------------------
 * Studio Project API — list & create.
 *
 * Studio adalah workspace terstruktur untuk research workflow (Intake → Questions
 * → Decisions → Specification → Artifacts → Format). Lihat src/lib/studio/engine.ts
 * untuk state machine lengkapnya.
 *
 * GET — list semua StudioProject milik user.
 *   Response: { success: true, data: StudioProject[] (dengan _count) }
 *
 * POST — buat StudioProject baru.
 *   Body: { name?: string, projectId?: string }
 *   - Kalau projectId dikasih → reuse (idempotent via upsert)
 *   - Kalau tidak → generate random `studio_xxxxxxxx`
 *   - Auto-create row di tabel `projects` (parent FK).
 *   - Name default: "Proyek baru" (max 200 char).
 *   Response: { success: true, data: StudioProject }
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

export async function GET() {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  // Include _count untuk UI badge (jumlah source/question/decision/artifact/revision).
  const projects = await prisma.studioProject.findMany({
    where: { ownerId: auth.user.id },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { sources: true, questions: true, decisions: true, artifacts: true, revisions: true } },
    },
  });

  return NextResponse.json(
    { success: true, data: projects },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => null) as { name?: string; projectId?: string } | null;
    const projectId = body?.projectId || `studio_${crypto.randomUUID().slice(0, 8)}`;
    const name = (body?.name || "Proyek baru").toString().slice(0, 200);

    // FK ke tabel `projects` (parent). Upsert idempotent.
    await prisma.project.upsert({
      where: { projectId },
      create: { projectId, ownerId: auth.user.id },
      update: { ownerId: auth.user.id },
    });

    // Upsert StudioProject — kalau projectId sudah ada (mis. user retry), cuma update name.
    const project = await prisma.studioProject.upsert({
      where: { projectId },
      create: {
        projectId,
        ownerId: auth.user.id,
        name,
      },
      update: { name },
    });

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    console.error("API /api/studio/projects POST failed:", error);
    return NextResponse.json({ success: false, error: "Gagal membuat proyek." }, { status: 500 });
  }
}