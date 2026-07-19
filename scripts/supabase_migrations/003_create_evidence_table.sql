-- Migration: Create evidence table for storing structured extraction per reference
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.

create table if not exists public.reference_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  reference_id text not null,
  summary text,
  methods text,
  results text,
  limitations text,
  keywords jsonb,
  citation_sentence text,
  model_used text,
  created_at timestamptz default now()
);

create index if not exists idx_reference_evidence_project on public.reference_evidence(project_id);
create index if not exists idx_reference_evidence_reference on public.reference_evidence(reference_id);
create index if not exists idx_reference_evidence_created_at on public.reference_evidence(created_at);