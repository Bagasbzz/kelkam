-- Hotfix manual: migrasi 20261110000000_analytics (Tahap 3 pencatatan data).
-- Tabel: activity_events, user_presence, login_events, ai_usage, feedbacks. Tabel users TIDAK diubah.
--
-- CARA PAKAI:
--   1. cPanel → phpPgAdmin → database keluhkam_kamp → SQL → tempel seluruh isi file ini → Execute.
--   2. Verifikasi: SELECT count(*) FROM activity_events;  (harus 0 atau lebih, bukan error)
-- Kode sudah aman walau file ini belum dijalankan (pencatatan dilewati diam-diam), tetapi data baru tercatat
-- setelah file ini dijalankan.
--
-- Idempotent: aman dijalankan ulang.
BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "activity_events" (
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'page',
    "path" TEXT NOT NULL,
    "feature" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_presence" (
    "user_id" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_presence_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "login_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'password',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ai_usage" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'chat',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "actual" BOOLEAN NOT NULL DEFAULT false,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "feedbacks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "target_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_events_created_at_idx" ON "activity_events"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_events_user_id_created_at_idx" ON "activity_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activity_events_visitor_id_created_at_idx" ON "activity_events"("visitor_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_presence_last_seen_at_idx" ON "user_presence"("last_seen_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_events_user_id_created_at_idx" ON "login_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "login_events_created_at_idx" ON "login_events"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_created_at_idx" ON "ai_usage"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ai_usage_owner_id_created_at_idx" ON "ai_usage"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "feedbacks_feature_created_at_idx" ON "feedbacks"("feature", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "feedbacks_user_id_feature_target_id_key" ON "feedbacks"("user_id", "feature", "target_id");


INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT md5(random()::text || clock_timestamp()::text), 'manual-hotfix', now(), '20261110000000_analytics', NULL, NULL, now(), 1
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = '20261110000000_analytics');

COMMIT;
