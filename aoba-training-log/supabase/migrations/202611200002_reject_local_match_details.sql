begin;

create or replace function public.training_log_write_snapshot_v2(expected_revision bigint, new_data jsonb)
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
  if expected_revision is not null and (expected_revision < 1 or expected_revision >= 9007199254740991) then
    raise exception using errcode = '22023', message = 'Expected revision must be positive';
  end if;
  perform training_log_private.validate_snapshot(new_data);

  -- The validator above guarantees that matches, when present, is an array of objects.
  -- Even JSON null is a present details field, which the client does not allow in cloud data.
  if exists (
    select 1
    from jsonb_array_elements(new_data->'matches') as match_row(value)
    where match_row.value ? 'details'
  ) then
    raise exception using errcode = '22023', message = 'Match details are local-only';
  end if;

  if expected_revision is null then
    insert into public.training_log_snapshots as snapshot (user_id, data)
    values (caller_id, new_data)
    on conflict (user_id) do nothing
    returning snapshot.revision into next_revision;
  else
    update public.training_log_snapshots as snapshot
      set data = new_data
      where snapshot.user_id = caller_id and snapshot.revision = expected_revision
      returning snapshot.revision into next_revision;
  end if;

  if found then
    return query select 'written'::text, next_revision;
  else
    return query select 'conflict'::text, null::bigint;
  end if;
end;
$$;

commit;
