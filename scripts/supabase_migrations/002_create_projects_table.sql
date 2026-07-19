-- Migration: Create projects table to map project_id -> owner (supabase user id)
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.

create table if not exists public.projects (
  project_id text primary key,
  owner_id text not null,
  metadata jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);