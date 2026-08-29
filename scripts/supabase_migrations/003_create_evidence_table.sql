-- Migration: Create evidence table for storing structured extraction per reference
-- Run this once in Supabase SQL editor (or via psql) as a Supabase admin.

create table if not exists public.reference_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.projects(project_id) on delete cascade,
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

alter table public.reference_evidence enable row level security;

drop policy if exists "reference_evidence_owner_all" on public.reference_evidence;
revoke all on public.reference_evidence from anon;
grant select, insert, update, delete on public.reference_evidence to authenticated;

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
