import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { verifyJournal } from "@/lib/references/journal-verifier";
import { normalizeJournalDoi, normalizeJournalIssns } from "@/lib/references/journal-check";
import { assertSameOriginJsonRequest } from "@/lib/server/csrf-origin";

export const runtime = "nodejs";

const schema = z.object({
  doi: z.string().trim().max(2048).refine((value) => Boolean(normalizeJournalDoi(value))).optional(),
  venue: z.string().trim().max(240).optional(),
  issn: z.array(z.string().trim().max(20).refine((value) => normalizeJournalIssns([value]).length === 1)).max(10).optional(),
}).strict().refine((value) => Boolean(value.doi || value.venue || value.issn?.length), "Identitas jurnal diperlukan.");

function noStore(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function POST(req: Request) {
  try {
    assertSameOriginJsonRequest(req);
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return noStore(NextResponse.json({ success: false, error: auth.error }, { status: auth.status }));
    const limited = enforceRateLimit(`references-verify:${auth.user.id}`, { limit: 20, windowMs: 10 * 60 * 1000 });
    if (limited) return noStore(limited);
    const body = await readJsonBody<unknown>(req, 8 * 1024);
    const parsed = schema.safeParse(body);
    if (!parsed.success) return noStore(NextResponse.json({ success: false, error: "Masukkan DOI, nama jurnal, atau ISSN yang valid." }, { status: 400 }));
    const result = await verifyJournal({ ...parsed.data, issn: normalizeJournalIssns(parsed.data.issn) });
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return noStore(publicErrorResponse(error, "Gagal memverifikasi metadata jurnal."));
  }
}
