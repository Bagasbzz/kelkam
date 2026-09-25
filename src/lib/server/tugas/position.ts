/**
 * src/lib/server/tugas/position.ts
 * -----------------------------------------------------------------------------
 * Helper untuk assign posisi antrian submission (1-based).
 *
 * Strategi 2 lapis (defense-in-depth):
 *
 *   1. Schema: `@@unique([tugasId, position])` di TugasSubmission — DB yang
 *      menjamin tidak ada dua submission di posisi sama dalam 1 tugas.
 *
 *   2. App-level: `assignPositionWithRetry()` retry sampai 5x kalau kena
 *      P2002 (unique constraint) — artinya ada submission lain yang dapat
 *      posisi yang sama di antara `findFirst` dan `create` kita.
 *
 * Single-instance JKC + index ini = cukup untuk handle 2 mahasiswa klik
 * submit di detik yang sama. Multi-instance nanti perlu advisory lock
 * Postgres (`pg_advisory_xact_lock`) atau sequence khusus tugas.
 *
 * Pemakaian:
 *   await prisma.$transaction(async (tx) => {
 *     const { position } = await assignPositionWithRetry(tx, tugasId);
 *     await tx.tugasSubmission.create({ data: { ..., position } });
 *   });
 * -----------------------------------------------------------------------------
 */

import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;

/** Batas retry sebelum lempar error ke caller. */
const MAX_RETRIES = 5;

/**
 * Hitung posisi berikutnya: max existing position + 1.
 * Tidak atomic dengan insert — pakai versi ini hanya kalau caller SUDAH
 * handle race (mis. unique constraint).
 *
 * @param tx - Prisma transaction client
 * @param tugasId - id tugas
 * @returns posisi 1-based
 */
export async function assignPosition(tx: Tx, tugasId: string): Promise<number> {
  const max = await tx.tugasSubmission.findFirst({
    where: { tugasId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return (max?.position ?? 0) + 1;
}

/**
 * Hitung posisi baru + retry kalau kena unique-constraint race.
 *
 * Return `{ position, attempts }` supaya caller bisa observability (log
 * kalau attempts > 1 artinya ada race beneran).
 */
export async function assignPositionWithRetry(
  tx: Tx,
  tugasId: string,
): Promise<{ position: number; attempts: number }> {
  let attempts = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts += 1;
    const position = await assignPosition(tx, tugasId);
    // Cek dulu apakah posisi ini sudah ada — kalau iya, retry dengan +1.
    // Ini cara sederhana untuk anti race; query-nya cheap karena ada index.
    const conflict = await tx.tugasSubmission.findFirst({
      where: { tugasId, position },
      select: { id: true },
    });
    if (!conflict) return { position, attempts };
    if (attempts >= MAX_RETRIES) {
      throw new Error(
        `Gagal assign posisi antrian setelah ${MAX_RETRIES} percobaan (tugas ${tugasId}).`,
      );
    }
    // Loop lagi — next iteration akan query max position lagi dan +1 dari yang baru.
  }
}

/**
 * Cek apakah error Prisma adalah P2002 (unique constraint violation).
 * Dipakai oleh submit endpoint untuk nge-handle duplicate (tugasId, userId).
 */
export function isPrismaUniqueViolation(
  error: unknown,
  target?: string | string[],
): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  if (!target) return true;
  const meta = (error.meta?.target as string[] | string | undefined) ?? [];
  const fields = Array.isArray(meta) ? meta : [meta];
  const wanted = Array.isArray(target) ? target : [target];
  return wanted.some((w) => fields.includes(w));
}