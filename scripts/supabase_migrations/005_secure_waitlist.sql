-- Public waitlist is insert-only. Anonymous users cannot enumerate email addresses.

alter table public.waitlist enable row level security;

drop policy if exists "waitlist_public_insert" on public.waitlist;
drop policy if exists "waitlist_public_select" on public.waitlist;

revoke all on public.waitlist from anon;
revoke all on public.waitlist from authenticated;
grant insert on public.waitlist to anon, authenticated;

create policy "waitlist_public_insert" on public.waitlist
  for insert to anon, authenticated
  with check (
    char_length(email) between 5 and 254
    and email = lower(email)
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );
