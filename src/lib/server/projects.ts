/**
 * src/lib/server/projects.ts
 * -----------------------------------------------------------------------------
 * Helper ownership check untuk project di keluhkampus.
 *
 * Pattern: setiap kali API route butuh akses row ber-project (reference_library,
 * reference_evidence, report_jobs, studio_*, dll), dia WAJIB panggil
 * `ownsProject(userId, projectId)` dulu — kecuali projectId sudah divalidasi
 * oleh client (mis. UI selalu kirim projectId sendiri).
 *
 * Kenapa perlu helper ini, bukan langsung `prisma.project.findUnique`?
 *   - Konsisten: result shape `{ ok, project }` atau `{ ok: false, reason }`.
 *   - Anti-data-leak: kalau owner tidak cocok, kita return "not_found"
 *     (bukan "forbidden"), supaya tidak bocorin "project ini ada tapi bukan punya kamu".
 *   - Idempotent create: `ensureOwnedProject` auto-create kalau belum ada
 *     (untuk first-time project usage).
 *
 * Result shape:
 *   - { ok: true, project: { projectId, ownerId } }
 *   - { ok: false, reason: "not_found" | "lookup_failed" | "already_owned" | "create_failed" }
 *
 * Bedanya reason:
 *   - "not_found"      : project tidak ada ATAU owner_id tidak cocok
 *   - "lookup_failed"  : DB error saat query
 *   - "already_owned"  : race condition, project sudah ada dengan owner lain
 *   - "create_failed"  : DB error saat INSERT
 * -----------------------------------------------------------------------------
 */

import { prisma } from "@/lib/db/prisma";

/**
 * Validator projectId format.
 * Pattern: 3-80 char, alphanumeric + dash + underscore, tidak mulai dengan dash/underscore.
 * Sama dengan yang dipakai di auth.ts-nya Supabase yang lama, supaya migrasi
 * existing project ID dari Supabase tidak patah.
 */
export function isValidProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(value);
}

export type ProjectOwnershipResult =
  | { ok: true; project: { projectId: string; ownerId: string } }
  | { ok: false; reason: "not_found" | "lookup_failed" | "already_owned" | "create_failed" };

/**
 * Cek apakah user adalah owner dari project.
 * Kalau tidak ada atau bukan milik user → return "not_found" (jangan bocorin info).
 * Kalau DB error → "lookup_failed" (supaya caller bisa 500).
 */
export async function ownsProject(userId: string, projectId: string): Promise<ProjectOwnershipResult> {
  try {
    const project = await prisma.project.findUnique({
      where: { projectId },
      select: { projectId: true, ownerId: true },
    });
    if (!project) return { ok: false, reason: "not_found" };
    // Sengaja return "not_found" untuk owner-mismatch juga, supaya tidak bocorin
    // "project ini ada tapi bukan punya kamu" → enumeration prevention.
    if (project.ownerId !== userId) return { ok: false, reason: "not_found" };
    return { ok: true, project };
  } catch (error) {
    console.error("ownsProject lookup failed:", error instanceof Error ? error.message : "unknown");
    return { ok: false, reason: "lookup_failed" };
  }
}

/**
 * Idempotent: kalau project belum ada → INSERT dengan owner=userId.
 * Kalau sudah ada dan milik user → return existing.
 * Kalau sudah ada tapi bukan milik user → return "not_found" (lihat ownsProject).
 *
 * Race condition handling:
 *   - Kalau INSERT kena unique constraint (P2002), artinya project baru dibuat
 *     oleh request lain antara check & insert → return "already_owned".
 *   - Caller bisa decide: 409 (conflict) atau retry.
 */
export async function ensureOwnedProject(userId: string, projectId: string): Promise<ProjectOwnershipResult> {
  const existing = await ownsProject(userId, projectId);
  if (existing.ok) return existing;
  if (existing.reason === "not_found") {
    try {
      const created = await prisma.project.create({
        data: { projectId, ownerId: userId },
        select: { projectId: true, ownerId: true },
      });
      return { ok: true, project: created };
    } catch (error) {
      // Prisma error code P2002 = unique constraint violation
      const code = (error as { code?: string }).code;
      if (code === "P2002") return { ok: false, reason: "already_owned" };
      console.error("ensureOwnedProject create failed:", error instanceof Error ? error.message : "unknown");
      return { ok: false, reason: "create_failed" };
    }
  }
  return existing;
}