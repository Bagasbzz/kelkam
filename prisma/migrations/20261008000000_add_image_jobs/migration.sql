-- Job background untuk generate gambar AI (gpt-image-2 butuh 1.5-2.5 menit).
-- Hasil PNG disimpan sebagai FileUpload; row ini hanya status + rujukan.

-- CreateTable
CREATE TABLE IF NOT EXISTS "image_jobs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "session_id" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "file_upload_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "image_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "image_jobs_owner_id_idx" ON "image_jobs"("owner_id");
CREATE INDEX IF NOT EXISTS "image_jobs_session_id_idx" ON "image_jobs"("session_id");
CREATE INDEX IF NOT EXISTS "image_jobs_status_idx" ON "image_jobs"("status");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'image_jobs_owner_id_fkey') THEN
    ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'image_jobs_file_upload_id_fkey') THEN
    ALTER TABLE "image_jobs" ADD CONSTRAINT "image_jobs_file_upload_id_fkey"
      FOREIGN KEY ("file_upload_id") REFERENCES "file_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
