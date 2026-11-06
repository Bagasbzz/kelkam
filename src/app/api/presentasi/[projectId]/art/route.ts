import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export const maxDuration = 30;
export function GET(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "art-get", ctx); }
export function POST(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "art-post", ctx); }
