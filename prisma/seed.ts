/**
 * prisma/seed.ts
 * -----------------------------------------------------------------------------
 * One-off idempotent seed. Promote super admin user ke role ADMIN.
 *
 * Default target: hensellbagas@gmail.com. Override via SUPER_ADMIN_EMAIL.
 *
 * Idempotent: kalau user gak ada, count=0 (gak error). Kalau sudah ADMIN,
 * updateMany tetap no-op (sama value). Kalau role=USER, di-promote.
 *
 * Jalankan via: node --import tsx prisma/seed.ts
 * Atau otomatis di .github/workflows/deploy.yml step "Seed super admin".
 * -----------------------------------------------------------------------------
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL || "hensellbagas@gmail.com";
  const result = await prisma.user.updateMany({
    where: { email },
    data: { role: "ADMIN" },
  });
  if (result.count === 0) {
    console.log(
      `[seed] User ${email} belum terdaftar. Daftar manual dulu via /api/auth/register, lalu re-run seed.`,
    );
  } else {
    console.log(`[seed] Promoted ${result.count} user(s) to ADMIN (super admin): ${email}`);
  }
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });