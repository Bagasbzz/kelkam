-- Run agent tool-calling tahan lama (asisten Laporan & Asisten Dosen).
-- Riwayat loop dipersist tiap langkah → bisa dilanjutkan setelah putus/restart.
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
