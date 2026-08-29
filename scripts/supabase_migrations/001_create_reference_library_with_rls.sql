-- Migration: Create reference_library table (with Row Level Security)
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.
-- Recommended for production: enable RLS and allow only authenticated users (UI) while service_role
-- key (server) always bypasses RLS.

-- Enable pgcrypto for gen_random_uuid()
create extension if not exists "pgcrypto";

-- Create table
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

-- indexes
create index if not exists idx_reference_library_project on public.reference_library(project_id);
create index if not exists idx_reference_library_doi on public.reference_library(doi);
create index if not exists idx_reference_library_created_at on public.reference_library(created_at);

-- Enable Row Level Security
alter table public.reference_library enable row level security;

-- Keep the table deny-by-default until projects exists. Migration 004 installs
-- owner-based policies after all tenant tables have been created.
drop policy if exists "allow_authenticated_select" on public.reference_library;
drop policy if exists "allow_authenticated_insert" on public.reference_library;
drop policy if exists "allow_authenticated_update_own_project" on public.reference_library;

revoke all on public.reference_library from anon;
