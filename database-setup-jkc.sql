-- keluhkampus: initial setup for the verified empty JKC database only.
-- Run as the database owner through phpPgAdmin. No passwords or accounts are created.
-- This statement aborts without changes on the wrong database, missing app role,
-- existing public relations/types, or any migration/permission error.
DO $setup$
BEGIN
  IF current_database() <> 'keluhkam_keluhkampus_db' THEN
    RAISE EXCEPTION 'STOP: select database keluhkam_keluhkampus_db before importing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keluhkam_user' AND rolcanlogin) THEN
    RAISE EXCEPTION 'STOP: PostgreSQL login role keluhkam_user is missing. No changes applied.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) OR EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname IN ('UserRole', 'SubmissionStatus')
  ) THEN
    RAISE EXCEPTION 'STOP: public schema is not empty. Do not overwrite existing data.';
  END IF;
  PERFORM set_config('search_path', 'public, pg_temp', true);
  CREATE SCHEMA IF NOT EXISTS public;
  CREATE TABLE public._prisma_migrations (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT,
    rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_steps_count INTEGER NOT NULL DEFAULT 0
  );

  EXECUTE $migration$
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "reference_library" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "title" TEXT,
    "authors" JSONB,
    "year" INTEGER,
    "venue" TEXT,
    "abstract" TEXT,
    "url" TEXT,
    "pdf_url" TEXT,
    "doi" TEXT,
    "citation_count" INTEGER,
    "is_open_access" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "citation_apa" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference_evidence" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "summary" TEXT,
    "methods" TEXT,
    "results" TEXT,
    "limitations" TEXT,
    "keywords" JSONB,
    "citation_sentence" TEXT,
    "model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT NOT NULL DEFAULT '',
    "result" TEXT,
    "source" TEXT,
    "error" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_uploads" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "original_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_projects" (
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "imported_from_legacy" BOOLEAN NOT NULL DEFAULT false,
    "intake" JSONB NOT NULL DEFAULT '{}',
    "specification" JSONB NOT NULL DEFAULT '{}',
    "format_profile" JSONB NOT NULL DEFAULT '{}',
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("project_id")
);

-- CreateTable
CREATE TABLE "studio_sources" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "file_name" TEXT,
    "provenance" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_questions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "question_class" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "why" TEXT NOT NULL DEFAULT '',
    "answer_hint" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'unanswered',
    "answer" TEXT NOT NULL DEFAULT '',
    "waiver_reason" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "affected_artifact_ids" JSONB NOT NULL DEFAULT '[]',
    "source_ids" JSONB NOT NULL DEFAULT '[]',
    "origin" TEXT NOT NULL DEFAULT 'system',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_decisions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "decision_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "origin" TEXT NOT NULL DEFAULT 'user',
    "question_id" TEXT,
    "source_ids" JSONB NOT NULL DEFAULT '[]',
    "affected_artifact_ids" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_artifacts" (
    "project_id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "dependency_ids" JSONB NOT NULL DEFAULT '[]',
    "decision_ids" JSONB NOT NULL DEFAULT '[]',
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "approved_version" INTEGER,
    "payload" JSONB,
    "validation_issues" JSONB NOT NULL DEFAULT '[]',
    "locked_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_artifacts_pkey" PRIMARY KEY ("project_id","artifact_id")
);

-- CreateTable
CREATE TABLE "studio_project_revisions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "studio_project_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "projects_owner_id_idx" ON "projects"("owner_id");

-- CreateIndex
CREATE INDEX "reference_library_project_id_idx" ON "reference_library"("project_id");

-- CreateIndex
CREATE INDEX "reference_library_owner_id_idx" ON "reference_library"("owner_id");

-- CreateIndex
CREATE INDEX "reference_library_doi_idx" ON "reference_library"("doi");

-- CreateIndex
CREATE INDEX "reference_library_created_at_idx" ON "reference_library"("created_at");

-- CreateIndex
CREATE INDEX "reference_evidence_project_id_idx" ON "reference_evidence"("project_id");

-- CreateIndex
CREATE INDEX "reference_evidence_owner_id_idx" ON "reference_evidence"("owner_id");

-- CreateIndex
CREATE INDEX "reference_evidence_reference_id_idx" ON "reference_evidence"("reference_id");

-- CreateIndex
CREATE INDEX "reference_evidence_created_at_idx" ON "reference_evidence"("created_at");

-- CreateIndex
CREATE INDEX "report_jobs_owner_id_idx" ON "report_jobs"("owner_id");

-- CreateIndex
CREATE INDEX "report_jobs_project_id_idx" ON "report_jobs"("project_id");

-- CreateIndex
CREATE INDEX "report_jobs_status_idx" ON "report_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "file_uploads_sha256_key" ON "file_uploads"("sha256");

-- CreateIndex
CREATE INDEX "file_uploads_owner_id_idx" ON "file_uploads"("owner_id");

-- CreateIndex
CREATE INDEX "file_uploads_created_at_idx" ON "file_uploads"("created_at");

-- CreateIndex
CREATE INDEX "studio_projects_owner_id_idx" ON "studio_projects"("owner_id");

-- CreateIndex
CREATE INDEX "studio_sources_project_id_idx" ON "studio_sources"("project_id");

-- CreateIndex
CREATE INDEX "studio_sources_owner_id_idx" ON "studio_sources"("owner_id");

-- CreateIndex
CREATE INDEX "studio_sources_project_id_authority_idx" ON "studio_sources"("project_id", "authority");

-- CreateIndex
CREATE INDEX "studio_questions_project_id_status_idx" ON "studio_questions"("project_id", "status");

-- CreateIndex
CREATE INDEX "studio_questions_owner_id_idx" ON "studio_questions"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_questions_project_id_question_key_key" ON "studio_questions"("project_id", "question_key");

-- CreateIndex
CREATE INDEX "studio_decisions_project_id_status_idx" ON "studio_decisions"("project_id", "status");

-- CreateIndex
CREATE INDEX "studio_decisions_owner_id_idx" ON "studio_decisions"("owner_id");

-- CreateIndex
CREATE INDEX "studio_artifacts_project_id_status_idx" ON "studio_artifacts"("project_id", "status");

-- CreateIndex
CREATE INDEX "studio_artifacts_owner_id_idx" ON "studio_artifacts"("owner_id");

-- CreateIndex
CREATE INDEX "studio_project_revisions_project_id_revision_idx" ON "studio_project_revisions"("project_id", "revision");

-- CreateIndex
CREATE INDEX "studio_project_revisions_owner_id_idx" ON "studio_project_revisions"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_project_revisions_project_id_revision_key" ON "studio_project_revisions"("project_id", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- CreateIndex
CREATE INDEX "waitlist_created_at_idx" ON "waitlist"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_library" ADD CONSTRAINT "reference_library_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_library" ADD CONSTRAINT "reference_library_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_evidence" ADD CONSTRAINT "reference_evidence_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_evidence" ADD CONSTRAINT "reference_evidence_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_uploads" ADD CONSTRAINT "file_uploads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_sources" ADD CONSTRAINT "studio_sources_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_sources" ADD CONSTRAINT "studio_sources_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_questions" ADD CONSTRAINT "studio_questions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_questions" ADD CONSTRAINT "studio_questions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_decisions" ADD CONSTRAINT "studio_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_decisions" ADD CONSTRAINT "studio_decisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_artifacts" ADD CONSTRAINT "studio_artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_artifacts" ADD CONSTRAINT "studio_artifacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_project_revisions" ADD CONSTRAINT "studio_project_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_projects"("project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_project_revisions" ADD CONSTRAINT "studio_project_revisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


$migration$;
  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES ('9489c60f-a041-4363-b721-b23d502afc74', 'a1f30b139420ce1ef72018841765d9322f2b075c877780611380e57ee76518dc', clock_timestamp(), '0001_init_jkc_schema', clock_timestamp(), 1);


  EXECUTE $migration$
-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'LATE', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "token" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_classes" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "course_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_admins" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_enrollments" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tugases" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "class_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tugases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tugas_submissions" (
    "id" TEXT NOT NULL,
    "tugas_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "class_id" TEXT NOT NULL,
    "nim" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "file_upload_id" TEXT,
    "position" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tugas_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_token_key" ON "courses"("token");

-- CreateIndex
CREATE INDEX "courses_token_idx" ON "courses"("token");

-- CreateIndex
CREATE INDEX "courses_created_by_id_idx" ON "courses"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_classes_course_id_name_key" ON "course_classes"("course_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "course_admins_course_id_user_id_key" ON "course_admins"("course_id", "user_id");

-- CreateIndex
CREATE INDEX "course_enrollments_course_id_idx" ON "course_enrollments"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_enrollments_course_id_user_id_key" ON "course_enrollments"("course_id", "user_id");

-- CreateIndex
CREATE INDEX "tugases_course_id_idx" ON "tugases"("course_id");

-- CreateIndex
CREATE INDEX "tugases_class_id_idx" ON "tugases"("class_id");

-- CreateIndex
CREATE INDEX "tugases_deadline_idx" ON "tugases"("deadline");

-- CreateIndex
CREATE INDEX "tugas_submissions_tugas_id_position_idx" ON "tugas_submissions"("tugas_id", "position");

-- CreateIndex
CREATE INDEX "tugas_submissions_tugas_id_class_id_idx" ON "tugas_submissions"("tugas_id", "class_id");

-- CreateIndex
CREATE INDEX "tugas_submissions_user_id_idx" ON "tugas_submissions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tugas_submissions_tugas_id_user_id_key" ON "tugas_submissions"("tugas_id", "user_id");

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_classes" ADD CONSTRAINT "course_classes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_admins" ADD CONSTRAINT "course_admins_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_admins" ADD CONSTRAINT "course_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugases" ADD CONSTRAINT "tugases_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugases" ADD CONSTRAINT "tugases_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "course_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugases" ADD CONSTRAINT "tugases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugas_submissions" ADD CONSTRAINT "tugas_submissions_tugas_id_fkey" FOREIGN KEY ("tugas_id") REFERENCES "tugases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugas_submissions" ADD CONSTRAINT "tugas_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugas_submissions" ADD CONSTRAINT "tugas_submissions_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "course_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tugas_submissions" ADD CONSTRAINT "tugas_submissions_file_upload_id_fkey" FOREIGN KEY ("file_upload_id") REFERENCES "file_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;


$migration$;
  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES ('705bf887-8f38-435e-bcc7-46ab6f24e4c9', '01e185e1e9cb3c07c3d897fd26ec7c8c6f9e6708e95513428491d79ddae326b8', clock_timestamp(), '20260925114406_add_tugas_models', clock_timestamp(), 1);


  EXECUTE $migration$
-- Add unique constraint on (tugas_id, position) for atomic position assignment.
-- Pairs with `assignPositionWithRetry()` in src/lib/server/tugas/position.ts
-- to prevent two concurrent submissions from landing on the same position.

CREATE UNIQUE INDEX "tugas_submissions_tugas_id_position_key" ON "tugas_submissions"("tugas_id", "position");

-- Drop the now-redundant non-unique index.
DROP INDEX IF EXISTS "tugas_submissions_tugas_id_position_idx";
$migration$;
  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES ('af6d4c7d-569f-4b62-840c-ad5c78c1c81f', 'a0b5c9a0e70cb0b445ae7d17c518449830404bd5436345059a2020915b4242fc', clock_timestamp(), '20260925120000_add_unique_tugas_position', clock_timestamp(), 1);


  EXECUTE $migration$
-- CreateTable
CREATE TABLE "mahasiswas" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "class_id" TEXT,
    "nim" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mahasiswas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mahasiswas_course_id_nim_key" ON "mahasiswas"("course_id", "nim");

-- CreateIndex
CREATE INDEX "mahasiswas_course_id_class_id_idx" ON "mahasiswas"("course_id", "class_id");

-- AddForeignKey
ALTER TABLE "mahasiswas" ADD CONSTRAINT "mahasiswas_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mahasiswas" ADD CONSTRAINT "mahasiswas_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "course_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
$migration$;
  INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
  VALUES ('5ba49161-8994-4a35-a1b1-88cb332554a8', 'd88ab85cb2e7aeb257cffd5d31b6c9ff6cc76f3f35e57e59b59a045ef719dc7b', clock_timestamp(), '20260927000000_add_mahasiswa_roster', clock_timestamp(), 1);

  GRANT CONNECT ON DATABASE keluhkam_keluhkampus_db TO keluhkam_user;
  GRANT USAGE ON SCHEMA public TO keluhkam_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public."users",
    public."sessions",
    public."projects",
    public."reference_library",
    public."reference_evidence",
    public."report_jobs",
    public."file_uploads",
    public."studio_projects",
    public."studio_sources",
    public."studio_questions",
    public."studio_decisions",
    public."studio_artifacts",
    public."studio_project_revisions",
    public."waitlist",
    public."courses",
    public."course_classes",
    public."course_admins",
    public."course_enrollments",
    public."tugases",
    public."tugas_submissions",
    public."mahasiswas"
    TO keluhkam_user;
  GRANT USAGE, SELECT ON SEQUENCE public.waitlist_id_seq TO keluhkam_user;
  GRANT USAGE ON TYPE public."UserRole", public."SubmissionStatus" TO keluhkam_user;
  RAISE NOTICE 'SETUP OK: 21 application tables, 4 migrations, application permissions installed.';
END;
$setup$;

SELECT
  'SETUP OK' AS status,
  (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL) AS migrations_applied,
  to_regclass('public.users') AS users_table,
  to_regclass('public.sessions') AS sessions_table,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') AS role_column,
  has_table_privilege('keluhkam_user', 'public.users', 'SELECT,INSERT,UPDATE,DELETE') AS app_users_access,
  has_table_privilege('keluhkam_user', 'public.sessions', 'SELECT,INSERT,UPDATE,DELETE') AS app_sessions_access;
