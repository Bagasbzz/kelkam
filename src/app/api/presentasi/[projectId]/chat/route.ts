import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export const maxDuration = 120;
export function POST(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "chat", ctx); }
