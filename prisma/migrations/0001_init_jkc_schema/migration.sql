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

