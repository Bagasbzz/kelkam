-- Lampiran tugas dari admin (screenshot output yang diharapkan, file contoh, dll).
-- File fisik ada di file_uploads (dedup SHA256); baris ini hanya rujukan + caption.

-- CreateTable
CREATE TABLE IF NOT EXISTS "tugas_attachments" (
    "id" TEXT NOT NULL,
    "tugas_id" TEXT NOT NULL,
    "file_upload_id" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tugas_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tugas_attachments_tugas_id_idx" ON "tugas_attachments"("tugas_id");
CREATE INDEX IF NOT EXISTS "tugas_attachments_file_upload_id_idx" ON "tugas_attachments"("file_upload_id");

-- AddForeignKey
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
