import { presentationRequest } from "@/lib/server/presentasi/http";

export const runtime = "nodejs";
export function POST(req: Request) { return presentationRequest(req, "create-from-report"); }
