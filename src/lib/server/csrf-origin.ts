import { ApiRequestError } from "@/lib/server/request-guards";

const JSON_CONTENT_TYPE_RE = /^application\/json(?:\s*;|$)/i;

function configuredOrigin(): string {
  const configured = process.env.AUTH_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || "https://keluhkampus.my.id";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid scheme");
    return url.origin;
  } catch {
    throw new Error("AUTH_ORIGIN/NEXT_PUBLIC_SITE_URL harus berupa URL HTTP(S) yang valid.");
  }
}

/**
 * Require browser mutation requests to be same-origin JSON.
 * The configured origin is authoritative; Host/X-Forwarded-Host are never
 * used to derive a trusted origin.
 */
export function assertSameOriginJsonRequest(req: Request): void {
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const contentType = req.headers.get("content-type");

  let expectedOrigin = configuredOrigin();
  if (process.env.NODE_ENV !== "production" && !process.env.AUTH_ORIGIN && !process.env.NEXT_PUBLIC_SITE_URL) {
    const url = new URL(req.url);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) expectedOrigin = url.origin;
  }
  if (!origin || origin !== expectedOrigin) {
    throw new ApiRequestError(403, "Permintaan lintas situs ditolak.");
  }
  if (fetchSite && fetchSite !== "same-origin") {
    throw new ApiRequestError(403, "Permintaan lintas situs ditolak.");
  }
  if (!contentType || !JSON_CONTENT_TYPE_RE.test(contentType)) {
    throw new ApiRequestError(415, "Permintaan harus menggunakan JSON.");
  }
}
