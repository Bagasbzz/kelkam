-- Hotfix manual: migrasi 20261111000000_admin_audit (Tahap 1: log audit aksi super admin).
-- cPanel -> phpPgAdmin -> database keluhkam_kamp -> SQL -> tempel -> Execute. Idempotent.
-- Kode aman walau belum dijalankan (log dilewati), tetapi aksi admin baru tercatat setelah ini.
BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_id" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_audit_logs_created_at_idx" ON "admin_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "admin_audit_logs_target_id_idx" ON "admin_audit_logs"("target_id");


INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT md5(random()::text || clock_timestamp()::text), 'manual-hotfix', now(), '20261111000000_admin_audit', NULL, NULL, now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261111000000_admin_audit');

COMMIT;
