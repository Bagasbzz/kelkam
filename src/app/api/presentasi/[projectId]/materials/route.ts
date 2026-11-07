import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export function POST(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "materials-post", ctx); }
export function DELETE(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "materials-delete", ctx); }
