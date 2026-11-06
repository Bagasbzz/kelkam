import { presentationRequest } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export function GET(req: Request) { return presentationRequest(req, "list"); }
export function POST(req: Request) { return presentationRequest(req, "create"); }
