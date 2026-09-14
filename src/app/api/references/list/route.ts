/**
 * GET /api/references/list?projectId=...
 * -----------------------------------------------------------------------------
 * List semua referensi yang tersimpan di library user untuk project tertentu.
 *
 * Filter & sort:
 *   - Filter by projectId + ownerId (anti leak antar user).
 *   - Order by createdAt desc (terbaru dulu).
 *   - Limit 200 per request (cukup untuk UI normal).
 *
 * Response shape:
 *   - 200 { success: true, data: ReferenceLibrary[] }
 *   - 400 — projectId format invalid
 *   - 401 — belum login
 *   - 404 — proyek tidak ditemukan / bukan milik user
 *   - 500 — DB error
 *
 * Cache-Control: private, no-store (jangan cache di proxy/browser — data
 * spesifik per user).
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { isValidProjectId, ownsProject } from "@/lib/server/projects";

export async function GET(req: Request) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  try {
    const projectId = new URL(req.url).searchParams.get("projectId");
    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ success: false, error: "Project ID tidak valid." }, { status: 400 });
    }

    // Ownership check. Return 404 kalau bukan milik user (anti enumeration).
    const ownership = await ownsProject(auth.user.id, projectId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.reason === "lookup_failed" ? "Gagal memeriksa proyek." : "Proyek tidak ditemukan." },
        { status: ownership.reason === "lookup_failed" ? 500 : 404 }
      );
    }

    // Filter by ownerId lagi sebagai defense-in-depth.
    const data = await prisma.referenceLibrary.findMany({
      where: { projectId, ownerId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("API /api/references/list failed:", error);
    return NextResponse.json({ success: false, error: "Gagal mengambil referensi." }, { status: 500 });
  }
}