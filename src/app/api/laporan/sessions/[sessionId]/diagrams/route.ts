/**
 * POST /api/laporan/sessions/[sessionId]/diagrams
 *   { diagramId, diagramType, title?, nodes, edges, lanes? }
 * → "Setujui ke Laporan" dari UML Builder: simpan diagram hasil edit ke rencana
 *   sesi, render SVG, dan tempatkan placeholder di bab tujuan draft.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { approveDiagramToSession } from "@/lib/server/laporan/assistant";
import { validateDiagramData, type SupportedDiagramType } from "@/lib/uml/diagram-guard";
import type { DiagramEdge, DiagramNode } from "@/lib/types/diagram";

export const runtime = "nodejs";
const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

const NodeSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum(["start", "end", "process", "decision", "actor", "usecase", "system", "activity", "fork", "join", "lifeline"]),
  text: z.string().max(400),
  lines: z.array(z.string().max(200)).max(20).default([]),
  lane: z.string().max(80).optional(),
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().positive(), height: z.number().finite().positive(),
  yes: z.string().max(80).optional(), no: z.string().max(80).optional(),
  side: z.enum(["left", "right", "center"]).optional(),
  offsetX: z.number().finite().optional(), offsetY: z.number().finite().optional(),
  pinned: z.boolean().optional(),
});
const EdgeSchema = z.object({
  id: z.string().min(1).max(80),
  fromId: z.string().min(1).max(80),
  toId: z.string().min(1).max(80),
  label: z.string().max(120).optional(),
  dashed: z.boolean().optional(),
  direction: z.enum(["right", "left", "bottom", "straight"]).optional(),
  y: z.number().finite().optional(),
});
const BodySchema = z.object({
  diagramId: z.string().min(1).max(80),
  diagramType: z.enum(["flowchart", "usecase", "activity", "sequence"]),
  title: z.string().max(160).optional(),
  nodes: z.array(NodeSchema).min(1).max(120),
  edges: z.array(EdgeSchema).max(300),
  lanes: z.array(z.string().max(80)).max(12).default([]),
});

export async function POST(req: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    const { sessionId } = await context.params;

    const rl = enforceRateLimit(`laporan-diagram:${auth.user.id}`, { limit: 30, windowMs: 10 * 60 * 1000 });
    if (rl) return rl;

    const parsed = BodySchema.safeParse(await readJsonBody<unknown>(req, 600 * 1024));
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid." }, { status: 400 });

    const nodes = parsed.data.nodes as DiagramNode[];
    const edges = parsed.data.edges as DiagramEdge[];
    const check = validateDiagramData(nodes, edges, parsed.data.diagramType as SupportedDiagramType);
    if (!check.ok) return NextResponse.json({ success: false, error: check.errors[0] || "Diagram belum lolos pemeriksaan kualitas." }, { status: 400 });

    const result = await approveDiagramToSession(sessionId, auth.user.id, {
      diagramId: parsed.data.diagramId,
      diagramType: parsed.data.diagramType,
      title: parsed.data.title,
      nodes,
      edges,
      lanes: parsed.data.lanes,
    });
    return NextResponse.json({ success: true, ...result }, NO_STORE);
  } catch (error) {
    if (error instanceof ApiRequestError) return NextResponse.json({ success: false, error: error.publicMessage }, { status: error.status });
    if (error instanceof Error && /tidak ditemukan|tidak ada di rencana|belum punya rencana/i.test(error.message)) {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    return publicErrorResponse(error, "Gagal menyimpan diagram ke laporan.");
  }
}
