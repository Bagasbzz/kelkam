-- Secure report job schema. Run in Supabase SQL Editor as a project administrator.
-- Existing rows without owner_id remain inaccessible after these policies are applied.

create table if not exists public.report_jobs (
  id text primary key,
  owner_id text not null,
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  stage text not null default 'Masuk antrean generate laporan',
  project jsonb,
  result text,
  source text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.report_jobs add column if not exists owner_id text;

create index if not exists report_jobs_owner_id_idx on public.report_jobs (owner_id);
create index if not exists report_jobs_created_at_idx on public.report_jobs (created_at desc);
create index if not exists report_jobs_status_idx on public.report_jobs (status);

alter table public.report_jobs enable row level security;

drop policy if exists "report_jobs_mvp_insert" on public.report_jobs;
drop policy if exists "report_jobs_mvp_select" on public.report_jobs;
drop policy if exists "report_jobs_mvp_update" on public.report_jobs;
drop policy if exists "report_jobs_owner_insert" on public.report_jobs;
drop policy if exists "report_jobs_owner_select" on public.report_jobs;
drop policy if exists "report_jobs_owner_update" on public.report_jobs;
drop policy if exists "report_jobs_owner_delete" on public.report_jobs;

revoke all on public.report_jobs from anon;
grant select, insert, update, delete on public.report_jobs to authenticated;

create policy "report_jobs_owner_insert" on public.report_jobs
  for insert to authenticated
  with check (owner_id = auth.uid()::text);

create policy "report_jobs_owner_select" on public.report_jobs
  for select to authenticated
  using (owner_id = auth.uid()::text);

create policy "report_jobs_owner_update" on public.report_jobs
  for update to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);

create policy "report_jobs_owner_delete" on public.report_jobs
  for delete to authenticated
  using (owner_id = auth.uid()::text);
