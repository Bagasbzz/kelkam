/**
 * /api/studio/projects/[projectId]/sources
 * -----------------------------------------------------------------------------
 * CRUD untuk StudioSource (sumber konteks proyek).
 *
 * StudioSource merepresentasikan satu input ke project — bisa brief dari
 * user, file yang di-upload, jurnal yang sudah diekstrak, dll.
 * Authority menandakan "trusted level" (binding/primary/supporting/dll).
 *
 * POST — tambah source baru.
 *   Body: { kind, authority, title, content, fileName?, provenance?, notes? }
 *   - kind: "brief" | "guide" | "code" | "dataset" | "reference" | "note"
 *   - authority: "binding" | "primary" | "supporting" | "example_only" | "unverified"
 *   - content max 2MB (untuk handle PDF text hasil extract).
 *
 * DELETE — hapus source.
 *   Query: ?sourceId=<id>
 *   - deleteMany (bukan delete) supaya idempotent kalau id sudah tidak ada.
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;

  // Ownership check.
  const project = await prisma.studioProject.findUnique({ where: { projectId } });
  if (!project || project.ownerId !== auth.user.id) {
    return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
    }

    const source = await prisma.studioSource.create({
      data: {
        projectId,
        ownerId: auth.user.id,
        kind: String(body.kind || "note").slice(0, 40),
        authority: String(body.authority || "unverified").slice(0, 30),
        title: String(body.title || "Sumber").slice(0, 500),
        content: String(body.content || "").slice(0, 2_000_000),
        fileName: body.fileName ? String(body.fileName).slice(0, 200) : null,
        provenance: body.provenance ? String(body.provenance).slice(0, 500) : null,
        notes: body.notes ? String(body.notes).slice(0, 1_000) : null,
      },
    });

    return NextResponse.json({ success: true, data: source });
  } catch (error) {
    console.error("API /api/studio/projects/[id]/sources POST failed:", error);
    return publicErrorResponse(error, "Gagal menambah sumber.");
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId");
  if (!sourceId) return NextResponse.json({ success: false, error: "sourceId wajib diisi." }, { status: 400 });

  const project = await prisma.studioProject.findUnique({ where: { projectId } });
  if (!project || project.ownerId !== auth.user.id) {
    return NextResponse.json({ success: false, error: "Proyek tidak ditemukan." }, { status: 404 });
  }

  // deleteMany (bukan delete) — idempotent, return count=0 kalau sudah tidak ada.
  await prisma.studioSource.deleteMany({ where: { id: sourceId, projectId, ownerId: auth.user.id } });
  return NextResponse.json({ success: true });
}

/** Re-export helper kalau route file lain butuh. */
function publicErrorResponse(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ success: false, error: message }, { status: 500 });
}