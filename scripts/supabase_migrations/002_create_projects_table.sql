-- Migration: Create projects table to map project_id -> owner (supabase user id)
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.

create table if not exists public.projects (
  project_id text primary key,
  owner_id text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);

alter table public.projects enable row level security;

drop policy if exists "projects_owner_select" on public.projects;
drop policy if exists "projects_owner_insert" on public.projects;
drop policy if exists "projects_owner_update" on public.projects;
drop policy if exists "projects_owner_delete" on public.projects;

revoke all on public.projects from anon;
grant select, insert, update, delete on public.projects to authenticated;

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
