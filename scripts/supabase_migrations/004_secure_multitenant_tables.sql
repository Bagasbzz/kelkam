-- Phase 0 containment migration for an already-deployed KeluhKampus database.
-- Run after migrations 001-003 and supabase/report_jobs.sql.
-- This migration is intentionally idempotent.

alter table if exists public.projects enable row level security;
alter table if exists public.reference_library enable row level security;
alter table if exists public.reference_evidence enable row level security;
alter table if exists public.report_jobs enable row level security;

alter table if exists public.report_jobs add column if not exists owner_id text;

create index if not exists idx_projects_owner_id on public.projects(owner_id);
create index if not exists idx_reference_library_project on public.reference_library(project_id);
create index if not exists idx_reference_evidence_project on public.reference_evidence(project_id);
create index if not exists report_jobs_owner_id_idx on public.report_jobs(owner_id);

drop policy if exists "allow_authenticated_select" on public.reference_library;
drop policy if exists "allow_authenticated_insert" on public.reference_library;
drop policy if exists "allow_authenticated_update_own_project" on public.reference_library;
drop policy if exists "report_jobs_mvp_insert" on public.report_jobs;
drop policy if exists "report_jobs_mvp_select" on public.report_jobs;
drop policy if exists "report_jobs_mvp_update" on public.report_jobs;

drop policy if exists "projects_owner_select" on public.projects;
drop policy if exists "projects_owner_insert" on public.projects;
drop policy if exists "projects_owner_update" on public.projects;
drop policy if exists "projects_owner_delete" on public.projects;
drop policy if exists "reference_library_owner_all" on public.reference_library;
drop policy if exists "reference_evidence_owner_all" on public.reference_evidence;
drop policy if exists "report_jobs_owner_insert" on public.report_jobs;
drop policy if exists "report_jobs_owner_select" on public.report_jobs;
drop policy if exists "report_jobs_owner_update" on public.report_jobs;
drop policy if exists "report_jobs_owner_delete" on public.report_jobs;

revoke all on public.projects from anon;
revoke all on public.reference_library from anon;
revoke all on public.reference_evidence from anon;
revoke all on public.report_jobs from anon;

grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.reference_library to authenticated;
grant select, insert, update, delete on public.reference_evidence to authenticated;
grant select, insert, update, delete on public.report_jobs to authenticated;

create policy "projects_owner_select" on public.projects
  for select to authenticated using (owner_id = auth.uid()::text);
create policy "projects_owner_insert" on public.projects
  for insert to authenticated with check (owner_id = auth.uid()::text);
create policy "projects_owner_update" on public.projects
  for update to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);
create policy "projects_owner_delete" on public.projects
  for delete to authenticated using (owner_id = auth.uid()::text);

create policy "reference_library_owner_all" on public.reference_library
  for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.project_id = reference_library.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.project_id = reference_library.project_id
        and p.owner_id = auth.uid()::text
    )
  );

create policy "reference_evidence_owner_all" on public.reference_evidence
  for all to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.project_id = reference_evidence.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.project_id = reference_evidence.project_id
        and p.owner_id = auth.uid()::text
    )
  );

create policy "report_jobs_owner_insert" on public.report_jobs
  for insert to authenticated with check (owner_id = auth.uid()::text);
create policy "report_jobs_owner_select" on public.report_jobs
  for select to authenticated using (owner_id = auth.uid()::text);
create policy "report_jobs_owner_update" on public.report_jobs
  for update to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);
create policy "report_jobs_owner_delete" on public.report_jobs
  for delete to authenticated using (owner_id = auth.uid()::text);

-- Rows that predate owner_id cannot be safely attributed automatically.
-- Keep them inaccessible, inspect them manually, then purge or backfill owner_id.
