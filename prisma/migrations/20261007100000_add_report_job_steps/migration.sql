-- Report pipeline per-BAB: project_id jadi optional, tambah mode/total_steps,
-- dan tabel report_job_steps (1 row per section outline).

ALTER TABLE "report_jobs" DROP CONSTRAINT IF EXISTS "report_jobs_project_id_fkey";
ALTER TABLE "report_jobs" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "report_jobs"
  ADD CONSTRAINT "report_jobs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "report_jobs"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'lengkap',
  ADD COLUMN "total_steps" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "report_job_steps" (
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
CREATE UNIQUE INDEX "report_job_steps_job_id_index_key" ON "report_job_steps"("job_id", "index");
CREATE INDEX "report_job_steps_job_id_status_idx" ON "report_job_steps"("job_id", "status");
ALTER TABLE "report_job_steps"
  ADD CONSTRAINT "report_job_steps_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
