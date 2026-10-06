import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { PGlite } = await import(pathToFileURL(process.env.PGLITE_ENTRY).href);
const root = resolve(import.meta.dirname, "..");
const original = readFileSync(resolve(root, "database-setup-jkc.sql"), "utf8");
const probe = new PGlite();
const databaseName = (await probe.query("SELECT current_database() AS name")).rows[0].name;
await probe.close();
// PGlite has no network logins and cannot update its template database ACL.
// The database CONNECT grant must be verified on hosting; all table grants run here.
const sql = original.replaceAll("keluhkam_keluhkampus_db", databaseName)
  .replace(`  GRANT CONNECT ON DATABASE ${databaseName} TO keluhkam_user;`, "");
const tableCount = async (db) => Number((await db.query("SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'")).rows[0].n);

{
  const db = new PGlite();
  await assert.rejects(db.exec(original), /select database/);
  assert.equal(await tableCount(db), 0);
  await db.close();
  console.log("PASS wrong database rejected without creating tables");
}
{
  const db = new PGlite();
  await assert.rejects(db.exec(sql), /login role keluhkam_user is missing/);
  assert.equal(await tableCount(db), 0);
  await db.close();
  console.log("PASS missing application role rejected without creating tables");
}
{
  const db = new PGlite();
  await db.exec("CREATE ROLE keluhkam_user LOGIN; CREATE TABLE public.keep_me (id int); INSERT INTO public.keep_me VALUES (7);");
  await assert.rejects(db.exec(sql), /public schema is not empty/);
  assert.equal(await tableCount(db), 1);
  assert.equal((await db.query("SELECT id FROM public.keep_me")).rows[0].id, 7);
  await db.close();
  console.log("PASS existing data preserved and setup refused");
}
{
  const db = new PGlite();
  await db.exec("CREATE ROLE keluhkam_user LOGIN;");
  // Force an error after migration work begins to verify statement-level rollback.
  const broken = sql.replace('GRANT USAGE, SELECT ON SEQUENCE public.waitlist_id_seq', 'GRANT USAGE, SELECT ON SEQUENCE public.missing_sequence');
  assert.notEqual(broken, sql);
  await assert.rejects(db.exec(broken), /missing_sequence/);
  assert.equal(await tableCount(db), 0);
  await db.exec(sql);
  assert.equal(await tableCount(db), 22);
  const rows = (await db.query("SELECT migration_name, checksum, applied_steps_count FROM public._prisma_migrations ORDER BY migration_name")).rows;
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const bytes = readFileSync(resolve(root, "prisma/migrations", row.migration_name, "migration.sql"));
    assert.equal(row.checksum, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(row.applied_steps_count, 1);
  }
  assert.equal((await db.query("SELECT count(*) AS n FROM pg_indexes WHERE schemaname='public' AND indexname='tugas_submissions_tugas_id_position_key'")).rows[0].n, 1);
  await db.exec("SET ROLE keluhkam_user;");
  await db.exec(`
    INSERT INTO public.users (id,email,password_hash,updated_at) VALUES ('smoke','smoke@example.invalid','not-a-real-hash',now());
    INSERT INTO public.sessions (id,user_id,expires_at) VALUES ('test-token','smoke',now() + interval '1 day');
    INSERT INTO public.waitlist (email) VALUES ('smoke@example.invalid');
  `);
  assert.equal((await db.query("SELECT role FROM public.users WHERE id='smoke'")).rows[0].role, "USER");
  await db.exec("UPDATE public.users SET name='Test' WHERE id='smoke'; DELETE FROM public.users WHERE id='smoke';");
  assert.equal((await db.query("SELECT count(*) AS n FROM public.sessions")).rows[0].n, 0);
  await db.exec("RESET ROLE;");
  await assert.rejects(db.exec(sql), /public schema is not empty/);
  assert.equal(await tableCount(db), 22);
  await db.close();
  console.log("PASS rollback, all 4 migrations and checksums, role defaults, app CRUD, sequence access, cascade, and repeat-import guard");
}
console.log("All SQL setup validation checks passed (embedded PostgreSQL, no production connection).");
