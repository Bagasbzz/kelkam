import { NextResponse } from "next/server";

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
    this.name = "ApiRequestError";
  }
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const globalForRateLimits = globalThis as typeof globalThis & {
  __keluhKampusRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalForRateLimits.__keluhKampusRateLimits || new Map<string, RateLimitEntry>();
globalForRateLimits.__keluhKampusRateLimits = rateLimits;

const MAX_RATE_LIMIT_KEYS = 5_000;

function pruneRateLimits(now: number) {
  for (const [key, value] of rateLimits) {
    if (value.resetAt <= now) rateLimits.delete(key);
  }

  if (rateLimits.size <= MAX_RATE_LIMIT_KEYS) return;
  const overflow = rateLimits.size - MAX_RATE_LIMIT_KEYS;
  for (const key of Array.from(rateLimits.keys()).slice(0, overflow)) {
    rateLimits.delete(key);
  }
}

export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): NextResponse | null {
  const now = Date.now();
  pruneRateLimits(now);

  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (current.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan. Coba lagi sebentar." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  current.count += 1;
  return null;
}

export async function readJsonBody<T>(req: Request, maxBytes: number): Promise<T> {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiRequestError(413, "Payload terlalu besar.");
  }

  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new ApiRequestError(413, "Payload terlalu besar.");
  }

  try {
    return JSON.parse(raw || "{}") as T;
  } catch {
    throw new ApiRequestError(400, "Payload JSON tidak valid.");
  }
}

export function publicErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    return NextResponse.json(
      { success: false, error: error.publicMessage },
      { status: error.status },
    );
  }

  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
