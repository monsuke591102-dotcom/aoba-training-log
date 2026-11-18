-- AOBA TRAINING LOG only. Apply to its own Supabase project.
begin;

create table public.training_log_snapshots (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint training_log_data_shape check ((
    jsonb_typeof(data) = 'object'
    and data->'schemaVersion' = '3'::jsonb
    and jsonb_typeof(data->'menus') = 'array'
    and jsonb_typeof(data->'records') = 'array'
    and jsonb_typeof(data->'plans') = 'array'
    and jsonb_typeof(data->'skippedMenus') = 'array'
    and jsonb_typeof(data->'rests') = 'array'
    and jsonb_typeof(data->'goals') = 'array'
    and jsonb_typeof(data->'reflections') = 'array'
  ) is true)
);

create function public.training_log_advance_revision()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.training_log_advance_revision() from public, anon, authenticated;
create trigger training_log_snapshot_revision
before update on public.training_log_snapshots
for each row execute function public.training_log_advance_revision();

alter table public.training_log_snapshots enable row level security;
revoke all on table public.training_log_snapshots from public, anon, authenticated;
grant select on table public.training_log_snapshots to authenticated;
grant insert (user_id, data) on table public.training_log_snapshots to authenticated;

create policy training_log_select_own on public.training_log_snapshots
for select to authenticated using (user_id = (select auth.uid()));

create policy training_log_insert_own on public.training_log_snapshots
for insert to authenticated with check (user_id = (select auth.uid()));

-- Protect this write path even when upgrading an installation with column-level UPDATE.
revoke update (data) on table public.training_log_snapshots from authenticated;

create or replace function public.training_log_update_snapshot(
  expected_revision bigint, new_data jsonb
)
returns table (status text, revision bigint)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := auth.uid();
  next_revision bigint;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if expected_revision is null or expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Expected revision must be positive';
  end if;

  -- The JWT-derived owner and revision are checked by the same UPDATE.
  -- The existing trigger advances the revision exactly once.
  update public.training_log_snapshots as snapshot
    set data = new_data
    where snapshot.user_id = caller_id and snapshot.revision = expected_revision
    returning snapshot.revision into next_revision;

  if found then
    return query select 'updated'::text, next_revision;
  else
    return query select 'conflict'::text, null::bigint;
  end if;
end;
$$;

revoke all on function public.training_log_update_snapshot(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.training_log_update_snapshot(bigint, jsonb) to authenticated;

commit;
