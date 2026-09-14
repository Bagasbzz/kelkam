/**
 * scripts/check-db.js
 * -----------------------------------------------------------------------------
 * Verifikasi koneksi + tampilkan schema PostgreSQL.
 *
 * USAGE:
 *   node scripts/check-db.js
 *
 * Berguna untuk:
 *   - Troubleshooting deployment (apakah DATABASE_URL benar?).
 *   - Cek tabel apa saja yang sudah ter-create setelah migrate.
 *   - Smoke-test connectivity dari local dev ke JKC.
 *
 * Output:
 *   - PostgreSQL version (mis. "PostgreSQL 16.x on x86_64-pc-linux-gnu")
 *   - Daftar tabel di schema 'public', sorted by name.
 *
 * Exit codes:
 *   - 0 — sukses
 *   - 2 — DATABASE_URL missing
 *   - 3 — DB error (connection / query gagal)
 * -----------------------------------------------------------------------------
 */

require("dotenv").config();
const { Client } = require("pg");

async function run() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL belum diset.");
    process.exit(2);
  }

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();

    // Server version — handy untuk cek kompatibilitas.
    const version = await client.query("SELECT version()");
    // eslint-disable-next-line no-console
    console.log("Connected:", version.rows[0]?.version);

    // List tabel public schema.
    const tables = await client.query(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const names = tables.rows.map((r) => r.tablename);
    // eslint-disable-next-line no-console
    console.log("Tables:", names.length ? names.join(", ") : "(empty)");
  } catch (err) {
    console.error("DB check failed:", err instanceof Error ? err.message : err);
    process.exit(3);
  } finally {
    await client.end();
  }
}

run();