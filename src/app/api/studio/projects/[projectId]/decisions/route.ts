/**
 * /api/studio/projects/[projectId]/decisions
 * -----------------------------------------------------------------------------
 * StudioDecision: keputusan terkunci yang jadi acuan lintas artifact.
 *
 * Berbeda dengan StudioQuestion (yang open-ended), StudioDecision adalah
 * "fakta final" yang sudah dikonfirmasi user. Question → Answer → Decision.
 *
 * Status lifecycle: "suggested" → "draft" → "confirmed" → "locked" (atau "superseded" / "rejected").
 *
 * POST — tambah decision baru.
 *   Body: { decisionKey?, category, statement, value, rationale?, status?, origin?, questionId?, sourceIds?, affectedArtifactIds?, history? }
 *
 * PUT — update decision berdasarkan decisionKey.
 *   Body: { decisionKey: string, patch: { status?, value?, rationale? } }
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
    const decision = await prisma.studioDecision.create({
      data: {
        projectId,
        ownerId: auth.user.id,
        decisionKey: String(body.decisionKey || `d_${crypto.randomUUID().slice(0, 6)}`).slice(0, 100),
        category: String(body.category || "general").slice(0, 50),
        statement: String(body.statement || "").slice(0, 2_000),
        value: String(body.value || "").slice(0, 2_000),
        rationale: String(body.rationale || "").slice(0, 2_000),
        status: String(body.status || "draft").slice(0, 20),
        origin: String(body.origin || "user").slice(0, 30),
        questionId: typeof body.questionId === "string" ? body.questionId : null,
        sourceIds: Array.isArray(body.sourceIds) ? (body.sourceIds as object) : [],
        affectedArtifactIds: Array.isArray(body.affectedArtifactIds) ? (body.affectedArtifactIds as object) : [],
        history: Array.isArray(body.history) ? (body.history as object) : [],
      },
    });
    return NextResponse.json({ success: true, data: decision });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/decisions POST failed:", error);
    return NextResponse.json({ success: false, error: "Gagal menambah keputusan." }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  try {
    const body = await req.json().catch(() => null) as { decisionKey?: string; patch?: Record<string, unknown> } | null;
    if (!body?.decisionKey) return NextResponse.json({ success: false, error: "decisionKey wajib diisi." }, { status: 400 });
    const updated = await prisma.studioDecision.updateMany({
      where: { projectId, ownerId: auth.user.id, decisionKey: body.decisionKey },
      data: {
        status: typeof body.patch?.status === "string" ? body.patch.status.slice(0, 20) : undefined,
        value: typeof body.patch?.value === "string" ? body.patch.value.slice(0, 2_000) : undefined,
        rationale: typeof body.patch?.rationale === "string" ? body.patch.rationale.slice(0, 2_000) : undefined,
      },
    });
    return NextResponse.json({ success: true, count: updated.count });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/decisions PUT failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memperbarui keputusan." }, { status: 500 });
  }
}