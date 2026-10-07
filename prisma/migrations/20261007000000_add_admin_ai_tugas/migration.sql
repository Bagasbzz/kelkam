-- Admin AI Tugas: pertemuan, nilai, teks ekstraksi, analisis kemiripan/AI,
-- dan sesi chat admin. Semua kolom baru nullable → aman untuk data lama.

-- Tugas.pertemuan
ALTER TABLE "tugases" ADD COLUMN "pertemuan" INTEGER;

-- Nilai submission
ALTER TABLE "tugas_submissions"
  ADD COLUMN "nilai" INTEGER,
  ADD COLUMN "nilai_at" TIMESTAMP(3),
  ADD COLUMN "nilai_by_id" TEXT;

ALTER TABLE "tugas_submissions"
  ADD CONSTRAINT "tugas_submissions_nilai_by_id_fkey"
  FOREIGN KEY ("nilai_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Teks hasil ekstraksi per file upload
CREATE TABLE "extracted_texts" (
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
CREATE UNIQUE INDEX "extracted_texts_file_upload_id_key" ON "extracted_texts"("file_upload_id");
ALTER TABLE "extracted_texts"
  ADD CONSTRAINT "extracted_texts_file_upload_id_fkey"
  FOREIGN KEY ("file_upload_id") REFERENCES "file_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Analisis submission (kemiripan + indikasi AI)
CREATE TABLE "submission_analyses" (
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
CREATE UNIQUE INDEX "submission_analyses_submission_id_key" ON "submission_analyses"("submission_id");
ALTER TABLE "submission_analyses"
  ADD CONSTRAINT "submission_analyses_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "tugas_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sesi chat Admin AI
CREATE TABLE "admin_chat_sessions" (
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
CREATE INDEX "admin_chat_sessions_course_id_user_id_idx" ON "admin_chat_sessions"("course_id", "user_id");

CREATE TABLE "admin_chat_messages" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tool_calls" JSONB,
  "tokens" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_chat_messages_session_id_created_at_idx" ON "admin_chat_messages"("session_id", "created_at");
ALTER TABLE "admin_chat_messages"
  ADD CONSTRAINT "admin_chat_messages_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "admin_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
