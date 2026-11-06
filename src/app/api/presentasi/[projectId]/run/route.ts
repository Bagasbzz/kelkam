import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export const maxDuration = 120;
export function GET(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "run-get", ctx); }
export function POST(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "run-post", ctx); }
