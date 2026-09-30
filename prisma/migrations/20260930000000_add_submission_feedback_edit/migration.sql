-- Mahasiswa bisa mengubah pengumpulan sebelum deadline; admin bisa memberi
-- satu feedback per pengumpulan. Semua kolom nullable → aman untuk data lama.

-- AlterTable
ALTER TABLE "tugas_submissions"
  ADD COLUMN "updated_at" TIMESTAMP(3),
  ADD COLUMN "feedback" TEXT,
  ADD COLUMN "feedback_at" TIMESTAMP(3),
  ADD COLUMN "feedback_by_id" TEXT;

-- AddForeignKey
ALTER TABLE "tugas_submissions"
  ADD CONSTRAINT "tugas_submissions_feedback_by_id_fkey"
  FOREIGN KEY ("feedback_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
