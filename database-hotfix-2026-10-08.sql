-- HOTFIX manual (idempotent, HANYA menambah kolom/tabel; tidak menghapus data).
-- Jalankan di Supabase SQL Editor kalau `prisma migrate deploy` di CI gagal.
-- Setelah jalan, tandai migrasi sebagai applied di tabel _prisma_migrations (bagian bawah).

-- 20261007000000_add_admin_ai_tugas
ALTER TABLE "tugases" ADD COLUMN IF NOT EXISTS "pertemuan" INTEGER;
ALTER TABLE "tugas_submissions"
  ADD COLUMN IF NOT EXISTS "nilai" INTEGER,
  ADD COLUMN IF NOT EXISTS "nilai_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nilai_by_id" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tugas_submissions_nilai_by_id_fkey') THEN
    ALTER TABLE "tugas_submissions" ADD CONSTRAINT "tugas_submissions_nilai_by_id_fkey"
      FOREIGN KEY ("nilai_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "extracted_texts" (
  "id" TEXT NOT NULL,
  "file_upload_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'note',
  "text" TEXT NOT NULL,
  "char_count" INTEGER NOT NULL,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "zip_manifest" JSONB,
  "summary" TEXT,
  "extracted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extracted_texts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "extracted_texts_file_upload_id_key" ON "extracted_texts"("file_upload_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'extracted_texts_file_upload_id_fkey') THEN
    ALTER TABLE "extracted_texts" ADD CONSTRAINT "extracted_texts_file_upload_id_fkey"
      FOREIGN KEY ("file_upload_id") REFERENCES "file_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "submission_analyses" (
  "id" TEXT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "text_hash" TEXT,
  "word_count" INTEGER NOT NULL DEFAULT 0,
  "ai_score" INTEGER,
  "ai_signals" JSONB,
  "sim_max_score" INTEGER,
  "sim_with_id" TEXT,
  "sim_pairs" JSONB,
  "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submission_analyses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "submission_analyses_submission_id_key" ON "submission_analyses"("submission_id");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'submission_analyses_submission_id_fkey') THEN
    ALTER TABLE "submission_analyses" ADD CONSTRAINT "submission_analyses_submission_id_fkey"
      FOREIGN KEY ("submission_id") REFERENCES "tugas_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "admin_chat_sessions" (
  "id" TEXT NOT NULL,
  "course_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" TEXT,
  "memory" JSONB,
  "summary" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "admin_chat_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_chat_sessions_course_id_user_id_idx" ON "admin_chat_sessions"("course_id", "user_id");

CREATE TABLE IF NOT EXISTS "admin_chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tool_calls" JSONB,
  "tokens" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_chat_messages_session_id_created_at_idx" ON "admin_chat_messages"("session_id", "created_at");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_chat_messages_session_id_fkey') THEN
    ALTER TABLE "admin_chat_messages" ADD CONSTRAINT "admin_chat_messages_session_id_fkey"
      FOREIGN KEY ("session_id") REFERENCES "admin_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 20261007100000_add_report_job_steps
ALTER TABLE "report_jobs" DROP CONSTRAINT IF EXISTS "report_jobs_project_id_fkey";
ALTER TABLE "report_jobs" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "report_jobs"
  ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'lengkap',
  ADD COLUMN IF NOT EXISTS "total_steps" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "report_job_steps" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  "section_id" TEXT,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "output" TEXT,
  "summary" TEXT,
  "error" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "report_job_steps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "report_job_steps_job_id_index_key" ON "report_job_steps"("job_id", "index");
CREATE INDEX IF NOT EXISTS "report_job_steps_job_id_status_idx" ON "report_job_steps"("job_id", "status");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_job_steps_job_id_fkey') THEN
    ALTER TABLE "report_job_steps" ADD CONSTRAINT "report_job_steps_job_id_fkey"
      FOREIGN KEY ("job_id") REFERENCES "report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 20261007120000_report_job_log_heartbeat
ALTER TABLE "report_jobs"
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "log" JSONB,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" TIMESTAMP(3);
ALTER TABLE "report_job_steps"
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "finished_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "tokens_used" INTEGER NOT NULL DEFAULT 0;

-- Tandai sebagai applied supaya `prisma migrate deploy` berikutnya tidak mengulang.
INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT gen_random_uuid()::text, c, now(), m, NULL, NULL, now(), 1
FROM (VALUES
  ('20261007000000_add_admin_ai_tugas', 'fa726b19919e9d6fd22f1937bd14cdccbd7afbbc6743f7c9be7e0d8e3bb54a47'),
  ('20261007100000_add_report_job_steps', '0eda2b86d69afcd90f6add0b5abbec0c73982082a3c697beac65dd8158c0c2bc'),
  ('20261007120000_report_job_log_heartbeat', '41cb1baf19a04bee2da1323c6f257dfa64218d6e00f78a29b9dc2057e6996334')
) AS v(m, c)
WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" p WHERE p.migration_name = v.m);
