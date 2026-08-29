-- Migration: Create reference_library table
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

create table if not exists public.reference_library (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
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

create index if not exists idx_reference_library_project on public.reference_library(project_id);
create index if not exists idx_reference_library_doi on public.reference_library(doi);
create index if not exists idx_reference_library_created_at on public.reference_library(created_at);

-- Deny direct Data API access until owner-based policies are installed by migration 004.
alter table public.reference_library enable row level security;
revoke all on public.reference_library from anon;
