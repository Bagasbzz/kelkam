/**
 * /api/studio/projects
 * -----------------------------------------------------------------------------
 * Studio Project API, list & create.
 *
 * Studio adalah workspace terstruktur untuk research workflow (Intake → Questions
 * → Decisions → Specification → Artifacts → Format). Lihat src/lib/studio/engine.ts
 * untuk state machine lengkapnya.
 *
 * GET, list semua StudioProject milik user.
 *   Response: { success: true, data: StudioProject[] (dengan _count) }
 *
 * POST, buat StudioProject baru.
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
import { ensureOwnedProject, isValidProjectId } from "@/lib/server/projects";

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
    const body = await req.json().catch(() => null) as { name?: unknown; projectId?: unknown } | null;
    // projectId dari klien WAJIB string berformat valid (anti operator injection / ID aneh).
    if (body?.projectId !== undefined && body?.projectId !== null && body?.projectId !== "" && !isValidProjectId(body.projectId)) {
      return NextResponse.json({ success: false, error: "projectId tidak valid." }, { status: 400 });
    }
    const projectId = isValidProjectId(body?.projectId) ? body.projectId : `studio_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const name = (typeof body?.name === "string" && body.name.trim() ? body.name : "Proyek baru").slice(0, 200);

    // Keamanan: JANGAN pernah memindahkan kepemilikan project yang sudah ada.
    // Dulu upsert menimpa ownerId → user lain bisa mengambil alih project orang
    // hanya dengan menebak projectId. Sekarang: buat baru atau tolak bila milik orang lain.
    const owned = await ensureOwnedProject(auth.user.id, projectId);
    if (!owned.ok) {
      const status = owned.reason === "lookup_failed" || owned.reason === "create_failed" ? 500 : 409;
      return NextResponse.json({ success: false, error: "projectId sudah dipakai. Gunakan ID lain." }, { status });
    }

    const existing = await prisma.studioProject.findUnique({ where: { projectId }, select: { ownerId: true } });
    if (existing && existing.ownerId !== auth.user.id) {
      return NextResponse.json({ success: false, error: "projectId sudah dipakai. Gunakan ID lain." }, { status: 409 });
    }

    // Upsert StudioProject milik user sendiri (idempotent saat retry): cuma update name.
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