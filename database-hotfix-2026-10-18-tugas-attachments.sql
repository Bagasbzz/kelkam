-- Hotfix manual: migrasi 20261016000000_add_tugas_attachments belum terpasang di server.
-- Fitur: lampiran tugas dari admin (screenshot output yang diharapkan, file contoh).
--
-- URUTAN RILIS (penting, agar tidak 500):
--   1. Jalankan file ini di cPanel → phpPgAdmin → database keluhkam_kamp → SQL.
--   2. Verifikasi: SELECT count(*) FROM tugas_attachments;  (harus 0, bukan error)
--   3. Baru commit + push ke main → CI/CD deploy kode.
--
-- Idempotent: aman dijalankan ulang.
BEGIN;

CREATE TABLE IF NOT EXISTS "tugas_attachments" (
    "id" TEXT NOT NULL,
    "tugas_id" TEXT NOT NULL,
    "file_upload_id" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tugas_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "tugas_attachments_tugas_id_idx" ON "tugas_attachments"("tugas_id");
CREATE INDEX IF NOT EXISTS "tugas_attachments_file_upload_id_idx" ON "tugas_attachments"("file_upload_id");

-- FK: hapus tugas → lampiran ikut terhapus; hapus file_uploads → lampiran ikut terhapus.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tugas_attachments_tugas_id_fkey') THEN
    ALTER TABLE "tugas_attachments" ADD CONSTRAINT "tugas_attachments_tugas_id_fkey"
      FOREIGN KEY ("tugas_id") REFERENCES "tugases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tugas_attachments_file_upload_id_fkey') THEN
    ALTER TABLE "tugas_attachments" ADD CONSTRAINT "tugas_attachments_file_upload_id_fkey"
      FOREIGN KEY ("file_upload_id") REFERENCES "file_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Grant ke semua role aplikasi (pola sama dengan database-grant-2026-10-08.sql).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname LIKE 'keluhkam%' AND rolcanlogin AND rolname <> current_user LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tugas_attachments" TO %I', r.rolname);
  END LOOP;
END $$;

-- Tandai applied supaya `prisma migrate deploy` berikutnya tidak mengulang.
-- Checksum = sha256(prisma/migrations/20261016000000_add_tugas_attachments/migration.sql).
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, c, now(), m, NULL, NULL, now(), 1
FROM (VALUES
  ('20261016000000_add_tugas_attachments', 'f93d332a27aeddb3076db57b97da55ef94827fd08940320ecc8b7e6b484fe557')
) AS v(m, c)
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.m);

COMMIT;

-- Verifikasi cepat (jalankan terpisah):
-- SELECT count(*) AS lampiran FROM tugas_attachments;
-- SELECT migration_name FROM _prisma_migrations WHERE migration_name LIKE '2026101%';
