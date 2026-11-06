import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateRequestFromCookie } from "@/lib/server/auth";
import { assertSameOriginJsonRequest } from "@/lib/server/csrf-origin";
import { ApiRequestError, enforceRateLimit, publicErrorResponse, readJsonBody } from "@/lib/server/request-guards";
import { controlAgentRun, findActiveAgentRun, getAgentRun } from "@/lib/server/agent-runs/engine";
import { streamAgentRun } from "@/lib/server/agent-runs/stream";
import { exportDeckPptx } from "@/lib/presentation/export-pptx";
import { deckSchema, THEME_IDS } from "@/lib/presentation/model";
import { startPresentationRun } from "./assistant";
import { createPresentation, deletePresentation, getPresentation, importReportText, listPresentations, resolvePresentationProposal, restorePresentation, savePresentation, snapshotPresentation } from "./repository";
import { generateSchema, PresentationError, reviseSchema, revisionSchema } from "./state";
import { artJobSchema, listPresentationArt, loadPresentationAssets, startPresentationArt } from "./art";

const privateHeaders = { "Cache-Control": "private, no-store" };
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: privateHeaders });
const baseSchema = z.object({ baseRevision: revisionSchema }).strict();
const runSchema = z.object({ runId: z.string().min(1).max(100), action: z.enum(["continue", "pause", "cancel", "resume"]) }).strict();
const restoreSchema = baseSchema.extend({ revision: revisionSchema });
const proposalSchema = baseSchema.extend({ runId: z.string().min(1).max(100), action: z.enum(["accept", "discard"]) });
const importSchema = baseSchema.extend({ sessionId: z.string().min(1).max(100) });
const patchSchema = baseSchema.extend({ deck: deckSchema });
const createSchema = z.object({ theme: z.enum(THEME_IDS) }).strict();

export type PresentationAction = "list" | "create" | "get" | "save" | "delete" | "restore" | "proposal" | "export" | "generate" | "revise" | "run-get" | "run-post" | "import-report" | "art-get" | "art-post";
export type PresentationRouteContext = { params: Promise<{ projectId: string }> };

async function body<T>(req: Request, schema: z.ZodType<T>, maxBytes = 256 * 1024): Promise<T> {
  const parsed = schema.safeParse(await readJsonBody<unknown>(req, maxBytes));
  if (!parsed.success) throw new ApiRequestError(400, "Input tidak valid atau melewati batas presentasi.");
  return parsed.data;
}

/** Every route, including reconnects, revalidates the database-backed cookie. */
export async function presentationRequest(req: Request, action: PresentationAction, context?: PresentationRouteContext): Promise<Response> {
  try {
    if (req.method !== "GET") assertSameOriginJsonRequest(req);
    const auth = await authenticateRequestFromCookie();
    if (!auth.ok) return json({ success: false, error: auth.error }, auth.status);
    const ownerId = auth.user.id;
    const polling = action === "run-get" || action === "run-post" || action === "art-get";
    const expensive = action === "generate" || action === "revise" || action === "export" || action === "art-post";
    const rate = enforceRateLimit(`presentasi:${polling ? "run" : expensive ? "work" : "crud"}:${ownerId}`, {
      limit: polling ? 300 : expensive ? 20 : 180, windowMs: 10 * 60 * 1000,
    });
    if (rate) { rate.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return rate; }
    if (action === "list") return json({ success: true, projects: await listPresentations(ownerId) });
    if (action === "create") {
      const input = await body(req, createSchema, 1024);
      return json({ success: true, project: await createPresentation(ownerId, input.theme) }, 201);
    }
    const projectId = z.string().uuid().safeParse((await context?.params)?.projectId);
    if (!projectId.success) throw new ApiRequestError(404, "Presentasi tidak ditemukan.");
    const id = projectId.data;
    if (action === "art-get") return json({ success: true, jobs: await listPresentationArt(ownerId, id) });
    if (action === "art-post") {
      const input = await body(req, artJobSchema, 16 * 1024);
      const admission = enforceRateLimit(`generate-image:${ownerId}`, { limit: 10, windowMs: 10 * 60 * 1000 });
      if (admission) { admission.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return admission; }
      return json({ success: true, job: await startPresentationArt(ownerId, id, input) }, 202);
    }
    if (action === "get") return json({ success: true, project: await getPresentation(ownerId, id) });
    if (action === "save") {
      const input = await body(req, patchSchema);
      return json({ success: true, project: await savePresentation(ownerId, id, input.baseRevision, input.deck) });
    }
    if (action === "delete") {
      await body(req, z.object({}).strict(), 1024);
      await deletePresentation(ownerId, id);
      return json({ success: true });
    }
    if (action === "restore") {
      const input = await body(req, restoreSchema, 1024);
      return json({ success: true, project: await restorePresentation(ownerId, id, input.baseRevision, input.revision) });
    }
    if (action === "proposal") {
      const input = await body(req, proposalSchema, 1024);
      return json({ success: true, project: await resolvePresentationProposal(ownerId, id, input.baseRevision, input.action, input.runId) });
    }
    if (action === "export") {
      const input = await body(req, baseSchema, 1024);
      const project = await snapshotPresentation(ownerId, id, input.baseRevision);
      const assets = await loadPresentationAssets(ownerId, project.deck);
      const file = await exportDeckPptx(project.deck, { assets });
      const filename = project.deck.title.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "presentasi";
      return new Response(new Uint8Array(file), {
        headers: { ...privateHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Content-Disposition": `attachment; filename="${filename}.pptx"`, "X-Content-Type-Options": "nosniff" },
      });
    }
    if (action === "generate" || action === "revise") {
      const operation = action === "generate"
        ? { operation: "generate" as const, ...await body(req, generateSchema, 192 * 1024) }
        : { operation: "revise" as const, ...await body(req, reviseSchema, 24 * 1024) };
      const run = await startPresentationRun(ownerId, id, operation);
      const response = streamAgentRun(run.id, ownerId);
      response.headers.set("Cache-Control", "private, no-store, no-transform");
      return response;
    }
    if (action === "import-report") {
      const input = await body(req, importSchema, 1024);
      return json({ success: true, text: await importReportText(ownerId, id, input.baseRevision, input.sessionId) });
    }
    // A run alone is not an ownership check for a deleted/non-presentation project.
    await getPresentation(ownerId, id);
    if (action === "run-get") return json({ success: true, run: await findActiveAgentRun(ownerId, "presentasi", id) });
    const input = await body(req, runSchema, 2048);
    const run = await getAgentRun(input.runId, ownerId);
    if (!run || run.kind !== "presentasi" || run.sessionId !== id) throw new ApiRequestError(404, "Run tidak ditemukan.");
    if (input.action === "pause" || input.action === "cancel") return json({ success: true, run: await controlAgentRun(run.id, ownerId, input.action) });
    if (input.action === "resume") await controlAgentRun(run.id, ownerId, "resume");
    const response = streamAgentRun(run.id, ownerId);
    response.headers.set("Cache-Control", "private, no-store, no-transform");
    return response;
  } catch (error) {
    if (error instanceof PresentationError) return json({ success: false, error: error.message }, error.status);
    const response = publicErrorResponse(error, "Permintaan presentasi gagal diproses.");
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return response;
  }
}
