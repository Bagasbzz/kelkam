/**
 * src/lib/server/ai-access.ts
 * -----------------------------------------------------------------------------
 * Gerbang bersama untuk route yang memanggil AI (anti penyalahgunaan).
 *
 * Setiap route AI memanggil `guardAiRequest()` di baris pertama:
 *   1. Auth ke DB (bukan cuma JWT di proxy): sesi yang sudah logout/di-revoke ditolak.
 *   2. Rate limit per route per user (burst).
 *   3. Anggaran harian durable diperiksa di transport provider, bukan di gate ini.
 *
 * Contoh:
 *   const gate = await guardAiRequest("academic-rewrite", { limit: 15 });
 *   if (!gate.ok) return gate.response;
 *   const { user } = gate;
 * -----------------------------------------------------------------------------
 */

import { NextResponse } from "next/server";
import { authenticateRequestFromCookie, type SessionUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/request-guards";
import { runWithAiOwner } from "@/lib/server/ai-budget";

const TEN_MINUTES = 10 * 60 * 1000;
export type AiGateResult =
  | { ok: true; user: SessionUser; run: <T>(fn: () => T) => T }
  | { ok: false; response: NextResponse };

export interface AiGateOptions {
  /** Maks request per jendela untuk route ini (default 20). */
  limit?: number;
  /** Panjang jendela rate limit (default 10 menit). */
  windowMs?: number;
  /** Bobot terhadap kuota harian (mis. 2 untuk fitur berat seperti vision). */
  cost?: number;
}

/** Auth + rate limit + kuota harian untuk route AI. */
export async function guardAiRequest(routeKey: string, options: AiGateOptions = {}): Promise<AiGateResult> {
  const auth = await authenticateRequestFromCookie();
  if (!auth.ok) {
    return { ok: false, response: NextResponse.json({ success: false, error: auth.error }, { status: auth.status }) };
  }
  const { user } = auth;

  const burst = enforceRateLimit(`ai:${routeKey}:${user.id}`, { limit: options.limit ?? 20, windowMs: options.windowMs ?? TEN_MINUTES });
  if (burst) return { ok: false, response: burst };

  // Route weights cannot represent actual provider fanout. Every transport attempt
  // (including tools, jobs and retries) is charged by the shared provider boundary.
  return { ok: true, user, run: (fn) => runWithAiOwner(user.id, routeKey, fn) };
}
