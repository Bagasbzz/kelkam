import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationsDir = resolve(root, "prisma/migrations");
const output = resolve(root, "database-setup-jkc.sql");
const migrations = readdirSync(migrationsDir).sort().flatMap((name) => {
  const path = resolve(migrationsDir, name, "migration.sql");
  if (!existsSync(path)) return [];
  const bytes = readFileSync(path);
  return [{ name, sql: bytes.toString("utf8"), checksum: createHash("sha256").update(bytes).digest("hex") }];
});
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const tables = migrations.flatMap(({ sql }) => [...sql.matchAll(/CREATE TABLE "([^"]+)"/g)].map((m) => m[1]));
if (migrations.length !== 4 || tables.length !== 21) {
  throw new Error("Migration history changed; review the JKC setup before generating it.");
}
for (const { sql } of migrations) {
  if (/\$(?:setup|migration)\$/.test(sql)) throw new Error("SQL delimiter collision");
}
const applied = migrations.map(({ name, sql, checksum }) => `
  EXECUTE $migration$
${sql}
$migration$;
  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES (${literal(randomUUID())}, ${literal(checksum)}, clock_timestamp(), ${literal(name)}, clock_timestamp(), 1);
`).join("\n");

// A single DO statement remains atomic even when an SQL import tool splits statements.
const sql = `-- keluhkampus: initial setup for the verified empty JKC database only.
-- Run as the database owner through phpPgAdmin. No passwords or accounts are created.
-- This statement aborts without changes on the wrong database, missing app role,
-- existing public relations/types, or any migration/permission error.
DO $setup$
BEGIN
  IF current_database() <> 'keluhkam_keluhkampus_db' THEN
    RAISE EXCEPTION 'STOP: select database keluhkam_keluhkampus_db before importing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keluhkam_user' AND rolcanlogin) THEN
    RAISE EXCEPTION 'STOP: PostgreSQL login role keluhkam_user is missing. No changes applied.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) OR EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname IN ('UserRole', 'SubmissionStatus')
  ) THEN
    RAISE EXCEPTION 'STOP: public schema is not empty. Do not overwrite existing data.';
  END IF;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TABLE public._prisma_migrations (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  );
${applied}
  GRANT CONNECT ON DATABASE keluhkam_keluhkampus_db TO keluhkam_user;
  GRANT USAGE ON SCHEMA public TO keluhkam_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    ${tables.map((name) => `public.${identifier(name)}`).join(",\n    ")}
    TO keluhkam_user;
  GRANT USAGE, SELECT ON SEQUENCE public.waitlist_id_seq TO keluhkam_user;
  GRANT USAGE ON TYPE public."UserRole", public."SubmissionStatus" TO keluhkam_user;
  RAISE NOTICE 'SETUP OK: 21 application tables, 4 migrations, application permissions installed.';
END;
$setup$;

SELECT
  'SETUP OK' AS status,
  (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL) AS migrations_applied,
  to_regclass('public.users') AS users_table,
  to_regclass('public.sessions') AS sessions_table,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') AS role_column,
  has_table_privilege('keluhkam_user', 'public.users', 'SELECT,INSERT,UPDATE,DELETE') AS app_users_access,
  has_table_privilege('keluhkam_user', 'public.sessions', 'SELECT,INSERT,UPDATE,DELETE') AS app_sessions_access;
`;
writeFileSync(output, sql, { encoding: "utf8", flag: "wx" });
console.log(`Created ${output} (${migrations.length} migrations, ${tables.length} application tables)`);
