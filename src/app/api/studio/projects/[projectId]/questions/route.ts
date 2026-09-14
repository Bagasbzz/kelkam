/**
 * /api/studio/projects/[projectId]/questions
 * -----------------------------------------------------------------------------
 * StudioQuestion: pertanyaan terbuka yang perlu dijawab user untuk lock
 * requirement project. Dipakai oleh Question Engine (lihat src/lib/studio/engine.ts).
 *
 * POST — tambah pertanyaan baru.
 *   Body: { questionKey?, category, questionClass, prompt, why?, answerHint?, ... }
 *   - questionKey unik per project (lihat @@unique di schema).
 *   - Kalau duplicate → 409.
 *
 * PUT — update pertanyaan berdasarkan questionKey.
 *   Body: { questionKey: string, patch: { status?, answer?, waiverReason?, priority? } }
 *   - status: "unanswered" | "answered" | "waived"
 *   - updateMany (bukan update) supaya idempotent kalau row tidak ada.
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

    const question = await prisma.studioQuestion.create({
      data: {
        projectId,
        ownerId: auth.user.id,
        questionKey: String(body.questionKey || `q_${crypto.randomUUID().slice(0, 6)}`).slice(0, 100),
        category: String(body.category || "scope").slice(0, 50),
        questionClass: String(body.questionClass || "important").slice(0, 30),
        prompt: String(body.prompt || "").slice(0, 2_000),
        why: String(body.why || "").slice(0, 2_000),
        answerHint: String(body.answerHint || "").slice(0, 1_500),
        status: String(body.status || "unanswered").slice(0, 20),
        answer: String(body.answer || "").slice(0, 5_000),
        waiverReason: body.waiverReason ? String(body.waiverReason).slice(0, 500) : null,
        priority: typeof body.priority === "number" ? Math.max(1, Math.floor(body.priority)) : 1,
        affectedArtifactIds: Array.isArray(body.affectedArtifactIds) ? (body.affectedArtifactIds as object) : [],
        sourceIds: Array.isArray(body.sourceIds) ? (body.sourceIds as object) : [],
        origin: String(body.origin || "system").slice(0, 30),
      },
    });

    return NextResponse.json({ success: true, data: question });
  } catch (error) {
    // P2002 = unique constraint violation pada (project_id, question_key).
    const message = error instanceof Error ? error.message : "";
    if ((error as { code?: string }).code === "P2002") {
      return NextResponse.json({ success: false, error: "Pertanyaan dengan key ini sudah ada." }, { status: 409 });
    }
    console.error("API /api/studio/projects/[id]/questions POST failed:", message);
    return NextResponse.json({ success: false, error: "Gagal menambah pertanyaan." }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  try {
    const body = await req.json().catch(() => null) as { questionKey?: string; patch?: Record<string, unknown> } | null;
    if (!body?.questionKey) return NextResponse.json({ success: false, error: "questionKey wajib diisi." }, { status: 400 });

    // Filter by ownerId + projectId → tidak bisa update pertanyaan user lain.
    const updated = await prisma.studioQuestion.updateMany({
      where: { projectId, ownerId: auth.user.id, questionKey: body.questionKey },
      data: {
        status: typeof body.patch?.status === "string" ? body.patch.status.slice(0, 20) : undefined,
        answer: typeof body.patch?.answer === "string" ? body.patch.answer.slice(0, 5_000) : undefined,
        waiverReason: typeof body.patch?.waiverReason === "string" ? body.patch.waiverReason.slice(0, 500) : undefined,
        priority: typeof body.patch?.priority === "number" ? body.patch.priority : undefined,
      },
    });
    return NextResponse.json({ success: true, count: updated.count });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/questions PUT failed:", error);
    return NextResponse.json({ success: false, error: "Gagal memperbarui pertanyaan." }, { status: 500 });
  }
}