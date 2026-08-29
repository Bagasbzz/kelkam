import { NextResponse, type NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";

const ROUTE_PROTECTED_PREFIXES = [
  "/api/report-jobs/",
  "/api/context/extract",
  "/api/references/persist",
  "/api/references/list",
  "/api/references/evidence",
  "/api/research/novelty",
  "/api/research/outline",
];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname === "/api/waitlist") return NextResponse.next();

  // These routes validate the token themselves because they also need a user-scoped DB client.
  if (ROUTE_PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const authentication = await authenticateRequest(request);
  if (!authentication.ok) return authentication.response;

  const { user } = authentication.auth;
  const expensive = pathname.startsWith("/api/ai/") || pathname.startsWith("/api/fix-format");
  const rateLimit = enforceRateLimit(`api-gateway:${user.id}:${pathname}`, {
    limit: expensive ? 20 : 40,
    windowMs: 10 * 60 * 1000,
  });
  if (rateLimit) return rateLimit;

  const headers = new Headers(request.headers);
  headers.delete("x-keluh-user-id");
  headers.set("x-keluh-user-id", user.id);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/api/:path*"],
};
