/**
 * src/lib/server/ai-access.ts
 * -----------------------------------------------------------------------------
 * Gerbang bersama untuk route yang memanggil AI (anti penyalahgunaan).
 *
 * Setiap route AI memanggil `guardAiRequest()` di baris pertama:
 *   1. Auth ke DB (bukan cuma JWT di proxy): sesi yang sudah logout/di-revoke ditolak.
 *   2. Rate limit per route per user (burst).
 *   3. Kuota harian per user lintas SEMUA fitur AI (biaya total terkendali).
 *      Admin mendapat kuota lebih besar.
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

const TEN_MINUTES = 10 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

/** Kuota harian panggilan AI (bisa diatur lewat env di hosting). */
const DAILY_LIMIT_USER = Number(process.env.AI_DAILY_LIMIT_USER || 150);
const DAILY_LIMIT_ADMIN = Number(process.env.AI_DAILY_LIMIT_ADMIN || 1500);

export type AiGateResult =
  | { ok: true; user: SessionUser }
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

  // Kuota harian dihitung per unit biaya. Rate limiter dipanggil `cost` kali (cost kecil, 1-3).
  const dailyLimit = user.role === "ADMIN" ? DAILY_LIMIT_ADMIN : DAILY_LIMIT_USER;
  for (let i = 0; i < Math.max(1, Math.min(options.cost ?? 1, 5)); i++) {
    const daily = enforceRateLimit(`ai-daily:${user.id}`, { limit: dailyLimit, windowMs: ONE_DAY });
    if (daily) {
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: "Kuota AI harian kamu sudah habis. Coba lagi besok." },
          { status: 429, headers: daily.headers },
        ),
      };
    }
  }

  return { ok: true, user };
}
