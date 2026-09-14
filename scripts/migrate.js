/**
 * scripts/migrate.js
 * -----------------------------------------------------------------------------
 * Apply Prisma migrations ke PostgreSQL JKC.
 *
 * USAGE:
 *   node scripts/migrate.js
 *
 * REQUIREMENTS:
 *   - DATABASE_URL di .env.local (atau di environment).
 *   - File migrasi ada di prisma/migrations/ (auto-generated via
 *     `npx prisma migrate dev` atau via diff tool).
 *
 * CARA KERJA:
 *   1. Load .env.local via dotenv (kalau ada).
 *   2. Spawn `npx prisma migrate deploy` (production-safe command).
 *   3. Forward exit code (0 sukses, non-0 error).
 *
 * KENAPA `migrate deploy` BUKAN `migrate dev`?
 *   - `migrate dev`: untuk development, apply migration + reset DB kalau
 *     schema drift (BAHAYA di production).
 *   - `migrate deploy`: apply pending migration tanpa reset. Production-safe.
 *
 * RUNBOOK:
 *   - Pertama kali deploy ke JKC: jalanin `node scripts/migrate.js` dari
 *     SSH ke server (lihat DEPLOYMENT.md step 6).
 *   - Setiap ada schema baru: commit prisma/migrations/xxx, push ke main,
 *     CI/CD auto-deploy. Migration ke-apply otomatis saat deploy script
 *     jalankan `npx prisma migrate deploy`.
 * -----------------------------------------------------------------------------
 */

require("dotenv").config();
const { spawn } = require("child_process");

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error("DATABASE_URL belum diset di environment atau .env.local.");
  console.error("Buat database dulu di cPanel JKC → PostgreSQL Databases.");
  process.exit(2);
}

// eslint-disable-next-line no-console
console.log("Running: npx prisma migrate deploy");
// eslint-disable-next-line no-console
console.log("Target:", dbUrl.replace(/:[^:@]+@/, ":****@"));

const child = spawn(
  "npx",
  ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
  {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: dbUrl },
  }
);

child.on("close", (code) => {
  process.exit(code || 0);
});

child.on("error", (err) => {
  console.error("Migration runner error:", err);
  process.exit(3);
});