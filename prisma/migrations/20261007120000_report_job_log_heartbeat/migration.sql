-- Report job: detailed event log, heartbeat, title; step timing + token usage.
ALTER TABLE "report_jobs"
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "log" JSONB,
  ADD COLUMN "heartbeat_at" TIMESTAMP(3);

ALTER TABLE "report_job_steps"
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "finished_at" TIMESTAMP(3),
  ADD COLUMN "tokens_used" INTEGER NOT NULL DEFAULT 0;
