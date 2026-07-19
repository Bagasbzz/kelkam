-- Migration: Create reference_library table (with Row Level Security)
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.
-- Recommended for production: enable RLS and allow only authenticated users (UI) while service_role
-- key (server) always bypasses RLS.

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- Create table
create table if not exists public.reference_library (
  id uuid primary key default gen_random_uuid(),
  project_id text,
  reference_id text, -- provider id or DOI-normalized
  title text,
  authors jsonb,
  year integer,
  venue text,
  abstract text,
  url text,
  pdf_url text,
  doi text,
  citation_count integer,
  is_open_access boolean,
  source text,
  citation_apa text,
  raw jsonb,
  created_at timestamptz default now()
);

-- indexes
create index if not exists idx_reference_library_project on public.reference_library(project_id);
create index if not exists idx_reference_library_doi on public.reference_library(doi);
create index if not exists idx_reference_library_created_at on public.reference_library(created_at);

-- Enable Row Level Security
alter table public.reference_library enable row level security;

-- Policies
-- 1) Allow authenticated users to SELECT rows (so signed-in UI users can read)
create policy "allow_authenticated_select" on public.reference_library
  for select
  using (auth.role() = 'authenticated');

-- 2) Allow authenticated users to INSERT rows (so users can save references themselves if desired)
create policy "allow_authenticated_insert" on public.reference_library
  for insert
  with check (auth.role() = 'authenticated');

-- 3) Allow authenticated users to UPDATE their own project rows (optional)
create policy "allow_authenticated_update_own_project" on public.reference_library
  for update
  using (auth.role() = 'authenticated' AND project_id = current_setting('request.jwt.claims.project_id', true))
  with check (auth.role() = 'authenticated' AND project_id = current_setting('request.jwt.claims.project_id', true));

-- NOTE:
-- - The service_role key bypasses RLS entirely, so server-side inserts via the service role will always succeed.
-- - The UPDATE policy above uses a JWT claim 'project_id' as an example; adjust according to your auth/user schema.
--   If you don't set request.jwt.claims.project_id, the UPDATE policy may be overly restrictive; remove or adapt if needed.
-- - If you want to allow anonymous (public) read, change the select policy accordingly (not recommended).