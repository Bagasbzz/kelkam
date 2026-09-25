/**
 * src/lib/server/tugas/position.ts
 * -----------------------------------------------------------------------------
 * Helper untuk assign posisi antrian submission (1-based).
 *
 * Strategi: pakai `prisma.$transaction` agar findFirst + insert atomic.
 * Single-instance JKC → cukup untuk handle 2 mahasiswa klik submit di detik
 * yang sama. Multi-instance nanti perlu advisory lock atau sequence.
 *
 * Pemakaian:
 *   await prisma.$transaction(async (tx) => {
 *     const position = await assignPosition(tx, tugasId);
 *     await tx.tugasSubmission.create({ data: { ..., position } });
 *   });
 * -----------------------------------------------------------------------------
 */

import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/**
 * Hitung posisi baru untuk tugas tertentu (max existing + 1).
 *
 * @param tx - Prisma transaction client (wajib, supaya atomic dengan insert)
 * @param tugasId - id tugas
 * @returns posisi 1-based (1 kalau belum ada submission)
 */
export async function assignPosition(tx: Tx, tugasId: string): Promise<number> {
  const max = await tx.tugasSubmission.findFirst({
    where: { tugasId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (max?.position ?? 0) + 1;
}