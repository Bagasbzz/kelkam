-- Run this once in Supabase SQL Editor before enabling persistent report jobs.
-- For production with private reports, set SUPABASE_SERVICE_ROLE_KEY in Vercel and keep RLS locked down.

create table if not exists public.report_jobs (
  id text primary key,
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

create index if not exists report_jobs_created_at_idx on public.report_jobs (created_at desc);
create index if not exists report_jobs_status_idx on public.report_jobs (status);

alter table public.report_jobs enable row level security;

-- MVP policy for this app while it has no login system.
-- The Next.js API still acts as the main UI boundary, but this policy is intentionally permissive
-- because a publishable key cannot bypass RLS. Replace with service-role-only writes later.
drop policy if exists "report_jobs_mvp_insert" on public.report_jobs;
drop policy if exists "report_jobs_mvp_select" on public.report_jobs;
drop policy if exists "report_jobs_mvp_update" on public.report_jobs;

create policy "report_jobs_mvp_insert" on public.report_jobs
  for insert to anon, authenticated
  with check (true);

create policy "report_jobs_mvp_select" on public.report_jobs
  for select to anon, authenticated
  using (true);

create policy "report_jobs_mvp_update" on public.report_jobs
  for update to anon, authenticated
  using (true)
  with check (true);
