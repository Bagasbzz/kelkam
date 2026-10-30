/**
 * /api/laporan/sessions/[sessionId]
 *   GET    → state sesi (brief/plan/sources/materials/draft/job) + riwayat pesan
 *   PATCH  → update draft manual { draft } (hasil edit user), title, atau
 *            centang sumber { sources: [{ id, selected }] }
 *   DELETE → hapus sesi
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { getSessionState } from "@/lib/server/laporan/assistant";
import { listImageJobs } from "@/lib/server/image-jobs";
import type { VerifiedSource } from "@/lib/references/find-sources";
import { sanitizePublicErrorText, toPublicAssistantMessage } from "@/lib/errors";
import { parseJournalVerification, type JournalVerification } from "@/lib/references/journal-check";

export const runtime = "nodejs";

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };
type Ctx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, context: Ctx) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { sessionId } = await context.params;

  const found = await getSessionState(sessionId, auth.user.id);
  if (!found) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });

  const [messages, figures] = await Promise.all([
    prisma.reportMessage.findMany({
      where: { sessionId, role: { in: ["user", "assistant"] } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, role: true, content: true, toolCalls: true, createdAt: true },
    }),
    listImageJobs(auth.user.id, { sessionId, limit: 30 }),
  ]);

  const { state, job } = found;
  return NextResponse.json({
    success: true,
    session: {
      id: state.id,
      title: state.title,
      stage: state.stage,
      brief: state.brief,
      plan: state.plan,
      // fullText tidak dikirim ke klien (besar); cukup jumlah karakternya.
      sources: state.sources.map((s) => {
        const copy: VerifiedSource = { ...s };
        delete copy.fullText;
        return copy;
      }),
      materials: state.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, fileName: m.fileName, chars: m.content.length })),
      jobId: state.jobId,
      draft: state.draft,
    },
    job,
    figures,
    messages: messages.map((message) => {
      if (message.role !== "assistant") return message;
      const tools = message.toolCalls;
      return {
        ...message,
        content: toPublicAssistantMessage(message.content),
        toolCalls: tools && typeof tools === "object" && !Array.isArray(tools) && Array.isArray(tools.events)
          ? { ...tools, events: tools.events.map((event) => typeof event === "string" ? sanitizePublicErrorText(event) : event) }
          : tools,
      };
    }),
  }, NO_STORE);
}

export async function PATCH(req: Request, context: Ctx) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const body = await readJsonBody<{ draft?: unknown; title?: unknown; sources?: unknown }>(req, 1_500_000);
    const data: { draft?: string; title?: string; sources?: object } = {};
    if (typeof body.draft === "string") data.draft = body.draft.slice(0, 1_200_000);
    if (typeof body.title === "string") data.title = body.title.trim().slice(0, 120);
    if (Array.isArray(body.sources)) {
      const changes = new Map<string, { selected?: boolean; journalVerification?: JournalVerification | null }>();
      for (const item of body.sources.slice(0, 200)) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          const value = item as Record<string, unknown>;
          const change: { selected?: boolean; journalVerification?: JournalVerification | null } = {};
          if ("selected" in value) {
            if (typeof value.selected !== "boolean") throw new ApiRequestError(400, "Pilihan sumber tidak valid.");
            change.selected = value.selected;
          }
          if ("journalVerification" in value) {
            const verification = parseJournalVerification(value.journalVerification);
            if (value.journalVerification !== null && (!verification || !verification.evidenceUrl)) throw new ApiRequestError(400, "Hasil cek jurnal perlu peringkat dan tautan bukti resmi yang valid.");
            change.journalVerification = verification ? { ...verification, checkedAt: new Date().toISOString() } : null;
          }
          if (Object.keys(change).length) changes.set(value.id as string, change);
        }
      }
      if (changes.size) {
        const row = await prisma.reportSession.findFirst({ where: { id: sessionId, ownerId: auth.user.id }, select: { sources: true } });
        if (!row) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
        const sources = (Array.isArray(row.sources) ? row.sources : []) as unknown as VerifiedSource[];
        if ([...changes.keys()].some((id) => !sources.some((s) => s.id === id))) throw new ApiRequestError(404, "Sumber tidak ditemukan di sesi ini.");
        data.sources = sources.map((s) => {
          const change = changes.get(s.id);
          if (!change) return s;
          const updated = { ...s, ...change };
          if (change.journalVerification === null) delete updated.journalVerification;
          return updated;
        });
      }
    }
    if (!Object.keys(data).length) return NextResponse.json({ success: false, error: "Tidak ada perubahan." }, { status: 400 });

    const result = await prisma.reportSession.updateMany({ where: { id: sessionId, ownerId: auth.user.id }, data });
    if (!result.count) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ success: true }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    return publicErrorResponse(error, "Gagal menyimpan.");
  }
}

export async function DELETE(_req: Request, context: Ctx) {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { sessionId } = await context.params;
  const result = await prisma.reportSession.deleteMany({ where: { id: sessionId, ownerId: auth.user.id } });
  if (!result.count) return NextResponse.json({ success: false, error: "Sesi tidak ditemukan." }, { status: 404 });
  return NextResponse.json({ success: true }, NO_STORE);
}
