-- Sesi asisten "Laporan" (chat → rencana → eksekusi → revisi)
CREATE TABLE IF NOT EXISTS "report_sessions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'intake',
    "brief" JSONB,
    "plan" JSONB,
    "sources" JSONB,
    "materials" JSONB,
    "job_id" TEXT,
    "draft" TEXT,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_sessions_owner_id_updated_at_idx" ON "report_sessions"("owner_id", "updated_at");

CREATE TABLE IF NOT EXISTS "report_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "report_messages_session_id_created_at_idx" ON "report_messages"("session_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_messages_session_id_fkey') THEN
    ALTER TABLE "report_messages" ADD CONSTRAINT "report_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "report_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
