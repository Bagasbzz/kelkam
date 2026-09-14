/**
 * GET /api/references/evidence?projectId=...
 * -----------------------------------------------------------------------------
 * List hasil ekstraksi evidence (ringkasan/methods/results/limitations)
 * dari referensi jurnal. Dipakai oleh EvidenceMatrix untuk render.
 *
 * Perbedaan dengan /api/references/list:
 *   - list = data referensi mentah dari provider (Semantic Scholar dll)
 *   - evidence = ringkasan AI yang sudah di-extract dari referensi
 *
 * Limit 500 per request — evidence matrix biasanya butuh lebih banyak
 * daripada reference list karena tiap referensi bisa punya 1+ evidence row.
 *
 * Response shape:
 *   - 200 { success: true, data: ReferenceEvidence[] }
 *   - 400 — projectId format invalid
 *   - 401 — belum login
 *   - 404 — proyek tidak ditemukan
 *   - 500 — DB error
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

    const ownership = await ownsProject(auth.user.id, projectId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.reason === "lookup_failed" ? "Gagal memeriksa proyek." : "Proyek tidak ditemukan." },
        { status: ownership.reason === "lookup_failed" ? 500 : 404 }
      );
    }

    const data = await prisma.referenceEvidence.findMany({
      where: { projectId, ownerId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return NextResponse.json(
      { success: true, data },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("API /api/references/evidence failed:", error);
    return NextResponse.json({ success: false, error: "Gagal mengambil evidence." }, { status: 500 });
  }
}