-- Hotfix manual: migrasi 20261009000000_add_agent_runs tidak terpasang di server.
-- Jalankan di cPanel → phpPgAdmin → database keluhkam_kamp → SQL. Idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS "agent_runs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "model" TEXT NOT NULL,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "max_steps" INTEGER NOT NULL DEFAULT 60,
    "messages" JSONB NOT NULL,
    "meta" JSONB,
    "events" JSONB,
    "tools_used" JSONB,
    "attachments" JSONB,
    "pending_question" JSONB,
    "reply" TEXT,
    "error" TEXT,
    "control" TEXT,
    "lock_token" TEXT,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_runs_owner_id_kind_session_id_status_idx" ON "agent_runs"("owner_id", "kind", "session_id", "status");
CREATE INDEX IF NOT EXISTS "agent_runs_status_heartbeat_at_idx" ON "agent_runs"("status", "heartbeat_at");

-- Tandai applied supaya `prisma migrate deploy` berikutnya tidak mengulang.
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, c, now(), m, NULL, NULL, now(), 1
FROM (VALUES
  ('20261009000000_add_agent_runs', '6eb8ba76d1ca51dc668c706b249bd4bcf2391ae555105499b7ef8ac54e61a2f6')
) AS v(m, c)
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.m);

COMMIT;
