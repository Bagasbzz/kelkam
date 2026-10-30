import { NextResponse } from "next/server";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { getSessionState } from "@/lib/server/laporan/assistant";
import { exportSessionDocx } from "@/lib/server/laporan/export-docx";
import { DOCX_PRESETS } from "@/utils/markdown-docx-exporter";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };
type Ctx = { params: Promise<{ sessionId: string }> };

export async function POST(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status, headers: NO_STORE });
    const limited = enforceRateLimit(`laporan-export:${auth.user.id}`, { limit: 6, windowMs: 60_000 });
    if (limited) {
      limited.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
      return limited;
    }
    const { sessionId } = await context.params;
    const body = await readJsonBody<{ draft?: unknown; preset?: unknown } | null>(req, 1_500_000);
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.draft !== "string" || !body.draft.trim()) {
      throw new ApiRequestError(400, "Draft laporan wajib diisi.");
    }
    if (body.draft.length > 1_200_000) throw new ApiRequestError(413, "Draft laporan terlalu besar.");
    if (typeof body.preset !== "string" || !Object.hasOwn(DOCX_PRESETS, body.preset)) {
      throw new ApiRequestError(400, "Preset format DOCX tidak valid.");
    }
    const found = await getSessionState(sessionId, auth.user.id);
    if (!found) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404, headers: NO_STORE });
    const { state } = found;
    const exported = await exportSessionDocx({
      sessionId: state.id,
      ownerId: auth.user.id,
      title: state.title || state.brief.title || state.brief.topic || "Laporan",
      // Export the current editor text without overwriting the persisted draft.
      draft: body.draft,
      preset: body.preset as keyof typeof DOCX_PRESETS,
      brief: state.brief,
      outline: state.plan?.outline || [],
      diagrams: state.plan?.diagrams || [],
      figures: state.plan?.figures || [],
    });
    return NextResponse.json({ success: true, ...exported }, { headers: NO_STORE });
  } catch (error) {
    const response = publicErrorResponse(error, "Gagal mengekspor laporan.");
    response.headers.set("Cache-Control", NO_STORE["Cache-Control"]);
    return response;
  }
}
