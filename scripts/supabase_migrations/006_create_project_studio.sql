-- KeluhKampus Project Studio persistence bundle (DEFERRED)
-- Do not run until the final migration window and backup checklist in MIGRATION_RUNBOOK.md are approved.
-- This migration mirrors the local versioned Studio model; the application may continue using localStorage
-- until a deliberate sync/reconciliation UX is shipped.

create extension if not exists "pgcrypto";

create table if not exists public.studio_projects (
  project_id text primary key references public.projects(project_id) on delete cascade,
  owner_id text not null,
  schema_version integer not null default 1 check (schema_version >= 1),
  name text not null,
  revision integer not null default 1 check (revision >= 1),
  imported_from_legacy boolean not null default false,
  intake jsonb not null default '{}'::jsonb,
  specification jsonb not null default '{}'::jsonb,
  format_profile jsonb not null default '{}'::jsonb,
  readiness jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.studio_sources (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.studio_projects(project_id) on delete cascade,
  owner_id text not null,
  kind text not null,
  authority text not null,
  title text not null,
  content text not null,
  file_name text,
  provenance text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(title) between 1 and 500),
  check (char_length(content) between 1 and 2000000),
  check (authority in ('binding', 'primary', 'supporting', 'example_only', 'unverified'))
);

create table if not exists public.studio_questions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.studio_projects(project_id) on delete cascade,
  owner_id text not null,
  question_key text not null,
  category text not null,
  question_class text not null,
  prompt text not null,
  why text not null default '',
  answer_hint text not null default '',
  status text not null default 'unanswered',
  answer text not null default '',
  waiver_reason text,
  priority integer not null default 1 check (priority >= 1),
  affected_artifact_ids jsonb not null default '[]'::jsonb,
  source_ids jsonb not null default '[]'::jsonb,
  origin text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, question_key),
  check (status in ('unanswered', 'answered', 'waived')),
  check (question_class in ('blocker', 'important', 'enrichment'))
);

create table if not exists public.studio_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.studio_projects(project_id) on delete cascade,
  owner_id text not null,
  decision_key text not null,
  category text not null,
  statement text not null,
  value text not null,
  rationale text not null default '',
  status text not null default 'draft',
  origin text not null default 'user',
  question_id uuid references public.studio_questions(id) on delete set null,
  source_ids jsonb not null default '[]'::jsonb,
  affected_artifact_ids jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version >= 1),
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('suggested', 'draft', 'confirmed', 'locked', 'superseded', 'rejected'))
);

create table if not exists public.studio_artifacts (
  project_id text not null references public.studio_projects(project_id) on delete cascade,
  artifact_id text not null,
  owner_id text not null,
  kind text not null,
  title text not null,
  description text not null default '',
  status text not null default 'not_started',
  dependency_ids jsonb not null default '[]'::jsonb,
  decision_ids jsonb not null default '[]'::jsonb,
  current_version integer not null default 0 check (current_version >= 0),
  approved_version integer,
  payload jsonb,
  validation_issues jsonb not null default '[]'::jsonb,
  locked_at timestamptz,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (project_id, artifact_id),
  check (status in ('not_started', 'draft', 'stale', 'ready', 'approved', 'locked'))
);

create table if not exists public.studio_project_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.studio_projects(project_id) on delete cascade,
  owner_id text not null,
  revision integer not null check (revision >= 1),
  reason text not null default '',
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (project_id, revision)
);

create index if not exists idx_studio_projects_owner on public.studio_projects(owner_id);
create index if not exists idx_studio_sources_project on public.studio_sources(project_id);
create index if not exists idx_studio_sources_authority on public.studio_sources(project_id, authority);
create index if not exists idx_studio_questions_project_status on public.studio_questions(project_id, status);
create index if not exists idx_studio_decisions_project_status on public.studio_decisions(project_id, status);
create index if not exists idx_studio_artifacts_project_status on public.studio_artifacts(project_id, status);
create index if not exists idx_studio_revisions_project on public.studio_project_revisions(project_id, revision desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['studio_projects', 'studio_sources', 'studio_questions', 'studio_decisions', 'studio_artifacts', 'studio_project_revisions'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
  end loop;
end $$;

drop policy if exists "studio_projects_owner_all" on public.studio_projects;
create policy "studio_projects_owner_all" on public.studio_projects
  for all to authenticated
  using (owner_id = auth.uid()::text)
  with check (owner_id = auth.uid()::text);

drop policy if exists "studio_sources_owner_all" on public.studio_sources;
create policy "studio_sources_owner_all" on public.studio_sources
  for all to authenticated
  using (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_sources.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_sources.project_id
        and p.owner_id = auth.uid()::text
    )
  );

drop policy if exists "studio_questions_owner_all" on public.studio_questions;
create policy "studio_questions_owner_all" on public.studio_questions
  for all to authenticated
  using (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_questions.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_questions.project_id
        and p.owner_id = auth.uid()::text
    )
  );

drop policy if exists "studio_decisions_owner_all" on public.studio_decisions;
create policy "studio_decisions_owner_all" on public.studio_decisions
  for all to authenticated
  using (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_decisions.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_decisions.project_id
        and p.owner_id = auth.uid()::text
    )
  );

drop policy if exists "studio_artifacts_owner_all" on public.studio_artifacts;
create policy "studio_artifacts_owner_all" on public.studio_artifacts
  for all to authenticated
  using (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_artifacts.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_artifacts.project_id
        and p.owner_id = auth.uid()::text
    )
  );

drop policy if exists "studio_revisions_owner_all" on public.studio_project_revisions;
create policy "studio_revisions_owner_all" on public.studio_project_revisions
  for all to authenticated
  using (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_project_revisions.project_id
        and p.owner_id = auth.uid()::text
    )
  )
  with check (
    owner_id = auth.uid()::text
    and exists (
      select 1 from public.studio_projects p
      where p.project_id = studio_project_revisions.project_id
        and p.owner_id = auth.uid()::text
    )
  );
