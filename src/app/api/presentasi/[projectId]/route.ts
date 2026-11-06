import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export function GET(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "get", ctx); }
export function PATCH(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "save", ctx); }
export function DELETE(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "delete", ctx); }
