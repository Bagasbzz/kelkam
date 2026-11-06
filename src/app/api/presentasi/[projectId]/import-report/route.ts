import { presentationRequest, type PresentationRouteContext } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export function POST(req: Request, ctx: PresentationRouteContext) { return presentationRequest(req, "import-report", ctx); }
