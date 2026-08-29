import { NextResponse } from "next/server";
import { authenticateRequest, ensureOwnedProject, isValidProjectId } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { sanitizeForPersistence } from "@/lib/security/redact-secrets";

function clamp(value: unknown, max: number) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, max) || null;
}

export async function POST(req: Request) {
  const authentication = await authenticateRequest(req);
  if (!authentication.ok) return authentication.response;
  const { supabase, user } = authentication.auth;

  const rateLimit = enforceRateLimit(`references-persist:${user.id}`, {
    limit: 12,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  try {
    const body = await readJsonBody<{ projectId?: unknown; references?: unknown[] }>(req, 600_000);
    const { projectId, references } = body;

    if (!isValidProjectId(projectId)) {
      return NextResponse.json({ success: false, error: "Project ID tidak valid." }, { status: 400 });
    }
    if (!Array.isArray(references) || references.length === 0 || references.length > 50) {
      return NextResponse.json(
        { success: false, error: "Kirim 1–50 referensi dalam satu permintaan." },
        { status: 400 },
      );
    }

    const project = await ensureOwnedProject(supabase, user.id, projectId);
    if (!project.ok) {
      const conflict = project.reason === "already_owned";
      return NextResponse.json(
        { success: false, error: conflict ? "Project ID sudah digunakan." : "Gagal menyiapkan proyek." },
        { status: conflict ? 409 : 500 },
      );
    }

    const rows = references.map((input) => {
      const reference = sanitizeForPersistence(input) as Record<string, unknown>;
      return {
        project_id: projectId,
        reference_id: clamp(reference.doi || reference.id, 300),
        title: clamp(reference.title, 500),
        authors: Array.isArray(reference.authors) ? reference.authors.slice(0, 50) : null,
        year: Number.isInteger(reference.year) ? reference.year : null,
        venue: clamp(reference.venue, 300),
        abstract: clamp(reference.abstract, 10_000),
        url: clamp(reference.url, 2_000),
        pdf_url: clamp(reference.pdfUrl, 2_000),
        doi: clamp(reference.doi, 300),
        citation_count: Number.isFinite(Number(reference.citationCount)) ? Number(reference.citationCount) : null,
        is_open_access: Boolean(reference.isOpenAccess),
        source: clamp(reference.source, 100),
        citation_apa: clamp(reference.citationApa, 2_000),
        raw: null,
      };
    });

    const { data, error } = await supabase.from("reference_library").insert(rows).select("*");
    if (error) {
      console.error("Reference insert failed:", error.code || "unknown");
      return NextResponse.json({ success: false, error: "Gagal menyimpan referensi." }, { status: 500 });
    }

    return NextResponse.json({ success: true, inserted: data?.length || 0, data });
  } catch (error) {
    console.error("API /api/references/persist failed:", error);
    return publicErrorResponse(error, "Gagal menyimpan referensi.");
  }
}
