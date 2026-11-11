-- Hotfix manual: migrasi 20261111120000_app_settings (pengaturan sistem, dipakai batas biaya AI rupiah).
-- cPanel -> phpPgAdmin -> database keluhkam_kamp -> SQL -> tempel -> Execute. Idempotent.
-- Selama belum dijalankan, panel tidak bisa menyimpan batas biaya dan batas rupiah tidak aktif
-- (rem harian lama tetap berjalan).
BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT md5(random()::text || clock_timestamp()::text), 'manual-hotfix', now(), '20261111120000_app_settings', NULL, NULL, now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261111120000_app_settings');

COMMIT;
