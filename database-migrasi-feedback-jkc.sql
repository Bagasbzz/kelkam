-- keluhkampus: migrasi "20260930000000_add_submission_feedback_edit" untuk database yang dipakai aplikasi (keluhkam_kamp).
-- Menambah kolom untuk fitur ubah pengumpulan + catatan admin. Semua kolom nullable,
-- data lama aman. Berhenti tanpa mengubah apa pun kalau database salah atau migrasi sudah ada.
DO $setup$
BEGIN
  IF current_database() <> 'keluhkam_kamp' THEN
    RAISE EXCEPTION 'STOP: pilih database keluhkam_kamp dulu.';
  END IF;
  IF to_regclass('public.tugas_submissions') IS NULL THEN
    RAISE EXCEPTION 'STOP: tabel tugas_submissions tidak ada di database ini.';
  END IF;
  IF EXISTS (SELECT 1 FROM public._prisma_migrations WHERE migration_name = '20260930000000_add_submission_feedback_edit') THEN
    RAISE EXCEPTION 'STOP: migrasi ini sudah pernah dijalankan.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='tugas_submissions' AND column_name='feedback') THEN
    RAISE EXCEPTION 'STOP: kolom feedback sudah ada.';
  END IF;

  EXECUTE $migration$
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

$migration$;

  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES ('d4615590-8c31-474d-a48f-81b494c470e8', 'd4208e0f8c13a85d5496c8033e1a3b6079156a8e36ed33bd736fcc9035aeb530', clock_timestamp(), '20260930000000_add_submission_feedback_edit', clock_timestamp(), 1);

  -- Role aplikasi harus bisa membaca/menulis kolom baru; grant tabel sudah ada,
  -- tapi pastikan untuk role yang dipakai aplikasi di database ini.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keluhkam_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tugas_submissions TO keluhkam_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keluhkam_kamp') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tugas_submissions TO keluhkam_kamp;
  END IF;
END;
$setup$;

SELECT
  'MIGRASI OK' AS status,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tugas_submissions' AND column_name='feedback') AS kolom_feedback,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tugas_submissions' AND column_name='updated_at') AS kolom_updated_at,
  (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL) AS total_migrasi;
