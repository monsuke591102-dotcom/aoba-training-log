-- Reviewed cutover candidate. Run as one batch after the legacy stop and writer drain.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL row_security = off;
LOCK TABLE public.training_log_snapshots IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  role_name text;
BEGIN
  IF (SELECT count(*) FROM public.training_log_snapshots) <> 1 THEN
    RAISE EXCEPTION 'Snapshot count changed; reconcile the approved baseline';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF has_function_privilege(role_name, 'public.training_log_update_snapshot(bigint,jsonb)', 'EXECUTE')
       OR has_any_column_privilege(role_name, 'public.training_log_snapshots', 'INSERT, UPDATE')
       OR has_table_privilege(role_name, 'public.training_log_snapshots', 'DELETE, TRUNCATE') THEN
      RAISE EXCEPTION 'Legacy effective write permission remains for role %', role_name;
    END IF;
  END LOOP;
END
$preflight$;

-- BEGIN canonical migration bodies
-- Apply only after the compatible client and a tested rollback are ready.

create schema training_log_private;
revoke all on schema training_log_private from public, anon, authenticated;

create function training_log_private.text_fields(entry jsonb, fields text[], nonempty boolean default false)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select not exists (
    select 1 from unnest(fields) as field
    where jsonb_typeof(entry->field) is distinct from 'string'
      or (nonempty and btrim(entry->>field, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') = '')
  );
$$;

create function training_log_private.valid_date(value jsonb, with_time boolean default false)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
declare
  text_value text := value #>> '{}';
begin
  if jsonb_typeof(value) is distinct from 'string' then return false; end if;
  if with_time then
    if text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$' then
      return false;
    end if;
    -- ISO timestamps support year 0000 (1 BC) in JavaScript.
    if left(text_value, 4) = '0000' then text_value := '2000' || substr(text_value, 5); end if;
  elsif text_value !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then
    return false;
  end if;
  perform left(text_value, 10)::date;
  return true;
exception when datetime_field_overflow or invalid_datetime_format then
  return false;
end;
$$;

create function training_log_private.quantity(value jsonb, unit text)
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(value) = 'number' then
    (value::numeric)::double precision > 0 and (value::numeric)::double precision <= 9007199254740991
      and (unit = '分' or trunc((value::numeric)::double precision) = (value::numeric)::double precision)
    else false end;
$$;

create function training_log_private.validate_snapshot(payload jsonb)
returns void language plpgsql set search_path = pg_catalog as $$
declare
  required text[] := array['menus','records','plans','skippedMenus','rests','goals','reflections'];
  optional text[] := array['deletedMenus','matches','routineVersions','routineCompletions','routineAdditions'];
  categories text[] := array['打撃','守備','走塁','体づくり','その他'];
  units text[] := array['回','分','秒','セット','球','本'];
  kinds text[] := array['自主練','チーム練習','試合'];
  menu_ids jsonb := '{}'::jsonb;
  routine_ids jsonb := '{}'::jsonb;
  seen jsonb;
  section text;
  entry jsonb;
  item jsonb;
  ids jsonb;
  identity text;
  valid boolean;
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload->'schemaVersion' is distinct from '3'::jsonb then
    raise exception using errcode = '23514', message = 'Invalid snapshot envelope or version';
  end if;
  foreach section in array required || optional loop
    if section = any(required) and jsonb_typeof(payload->section) is distinct from 'array' then
      raise exception using errcode = '23514', message = 'Invalid snapshot envelope';
    end if;
    if section = any(optional) and payload ? section and jsonb_typeof(payload->section) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'Invalid optional snapshot collection';
    end if;
  end loop;

  foreach section in array array['menus','deletedMenus','records','matches','plans','skippedMenus','rests','goals',
    'reflections','routineVersions','routineCompletions','routineAdditions'] loop
    seen := '{}'::jsonb;
    for entry in select value from jsonb_array_elements(payload->section) loop
      if jsonb_typeof(entry) is distinct from 'object' then
        raise exception using errcode = '22023', message = 'Invalid snapshot row in ' || section;
      end if;
      identity := case
        when section in ('plans','rests') then entry->>'date'
        when section = 'skippedMenus' then jsonb_build_array(entry->'date', entry->'menuId')::text
        when section = 'reflections' then jsonb_build_array(entry->'date', entry->'period')::text
        when section in ('routineCompletions','routineAdditions') then jsonb_build_array(entry->'date', entry->'itemId')::text
        else entry->>'id'
      end;
      case section
        when 'menus','deletedMenus' then
          valid := training_log_private.text_fields(entry, array['id','name'], true)
            and entry->>'category' = any(categories) and entry->>'unit' = any(units)
            and jsonb_typeof(entry->'enabled') = 'boolean' and not (menu_ids ? identity)
            and (section = 'menus' or training_log_private.valid_date(entry->'deletedOn'));
          if valid then menu_ids := menu_ids || jsonb_build_object(identity, true); end if;
        when 'records' then
          valid := training_log_private.text_fields(entry, array['id','menuName'], true)
            and training_log_private.text_fields(entry, array['note'])
            and training_log_private.valid_date(entry->'date')
            and training_log_private.valid_date(entry->'createdAt', true)
            and training_log_private.valid_date(entry->'updatedAt', true)
            and (menu_ids ? (entry->>'menuId')) and jsonb_typeof(entry->'menuId') = 'string'
            and entry->>'kind' = any(kinds) and entry->>'category' = any(categories) and entry->>'unit' = any(units)
            and training_log_private.quantity(entry->'amount', entry->>'unit')
            and (not (entry ? 'entrySource') or entry->'entrySource' = '"quick"'::jsonb)
            and (not (entry ? 'durationMinutes') or training_log_private.quantity(entry->'durationMinutes', '分'))
            and (not (entry ? 'rating') or entry->'rating' in ('1','2','3','4','5'));
        when 'matches' then
          valid := training_log_private.text_fields(entry, array['id'], true)
            and training_log_private.text_fields(entry, array['good','improve'])
            and training_log_private.valid_date(entry->'date')
            and training_log_private.valid_date(entry->'createdAt', true)
            and training_log_private.valid_date(entry->'updatedAt', true)
            and (not (entry ? 'recordId') or training_log_private.text_fields(entry, array['recordId'], true));
        when 'plans' then
          valid := training_log_private.valid_date(entry->'date') and (entry->>'kind' = '休養日' or
            (entry->>'kind' = any(kinds) and jsonb_typeof(entry->'menuIds') = 'array'));
          if valid and entry->>'kind' <> '休養日' then
            valid := not exists (select 1 from jsonb_array_elements(entry->'menuIds') as id
              where jsonb_typeof(id) <> 'string' or not (menu_ids ? (id #>> '{}')))
              and not exists (select 1 from jsonb_array_elements(entry->'menuIds') as id group by id having count(*) > 1);
          end if;
        when 'skippedMenus' then
          valid := training_log_private.valid_date(entry->'date') and (menu_ids ? (entry->>'menuId'))
            and training_log_private.text_fields(entry, array['menuId','menuName'], true)
            and training_log_private.text_fields(entry, array['note'])
            and training_log_private.valid_date(entry->'createdAt', true)
            and training_log_private.valid_date(entry->'updatedAt', true)
            and entry->>'reason' in ('天候不良','場所・設備の都合','体調・疲労を考慮','予定変更','その他');
        when 'rests' then
          valid := training_log_private.valid_date(entry->'date') and training_log_private.valid_date(entry->'createdAt', true);
        when 'goals' then
          valid := training_log_private.text_fields(entry, array['id'], true)
            and training_log_private.valid_date(entry->'effectiveFrom')
            and training_log_private.valid_date(entry->'changedAt', true) and case entry->>'kind'
              when 'weekly' then entry->'days' in ('null','1','2','3','4','5','6','7')
              when 'skill' then training_log_private.text_fields(entry, array['text'])
              when 'menu' then true when 'daily-menu' then true else false end;
          if valid and entry->>'kind' in ('menu','daily-menu') then
            valid := training_log_private.text_fields(entry, array['menuId','menuName'], true)
              and (menu_ids ? (entry->>'menuId')) and entry->>'unit' = any(units)
              and (entry->'amount' = 'null' or training_log_private.quantity(entry->'amount', entry->>'unit'));
          end if;
        when 'reflections' then
          valid := training_log_private.valid_date(entry->'date')
            and training_log_private.text_fields(entry, array['success','challenge','next'])
            and training_log_private.valid_date(entry->'updatedAt', true)
            and (not (entry ? 'createdAt') or training_log_private.valid_date(entry->'createdAt', true));
          if valid then
            valid := entry->>'period' = 'day' or (entry->>'period' = 'week' and extract(isodow from (entry->>'date')::date) = 1);
          end if;
        when 'routineVersions' then
          valid := training_log_private.text_fields(entry, array['id'], true)
            and training_log_private.valid_date(entry->'startsOn') and jsonb_typeof(entry->'items') = 'array'
            and (not (entry ? 'sourceKey') or training_log_private.text_fields(entry, array['sourceKey'], true));
          if valid then
            ids := '{}'::jsonb;
            for item in select value from jsonb_array_elements(entry->'items') loop
              valid := jsonb_typeof(item) = 'object' and training_log_private.text_fields(item, array['id','name'], true)
                and training_log_private.text_fields(item, array['note','condition']) and not (ids ? (item->>'id'))
                and item->>'schedule' in ('daily','conditional','weekdays') and jsonb_typeof(item->'weekdays') = 'array'
                and (not (item ? 'group') or training_log_private.text_fields(item, array['group'], true))
                and (not (item ? 'mode') or item->>'mode' in ('check','quantity'))
                and (not (item ? 'recordUnit') or item->>'recordUnit' = any(units))
                and (not (item ? 'menuId') or (jsonb_typeof(item->'menuId') = 'string' and menu_ids ? (item->>'menuId')))
                and (not (item ? 'target') or (item ? 'menuId' and jsonb_typeof(item->'target') = 'object'
                  and item->'target'->>'unit' = any(units) and training_log_private.quantity(item->'target'->'amount', item->'target'->>'unit')));
              if valid then
                valid := ((item->>'schedule' = 'weekdays') = (jsonb_array_length(item->'weekdays') > 0))
                  and not exists (select 1 from jsonb_array_elements(item->'weekdays') as day where day not in ('0','1','2','3','4','5','6'))
                  and not exists (select 1 from jsonb_array_elements(item->'weekdays') as day group by day having count(*) > 1);
              end if;
              if valid is not true then exit; end if;
              ids := ids || jsonb_build_object(item->>'id', true);
              routine_ids := routine_ids || jsonb_build_object(item->>'id', true);
            end loop;
            if valid then
              valid := not exists (select 1 from jsonb_array_elements(entry->'items') as row
                where row ? 'menuId' group by row->>'menuId' having count(*) > 1);
            end if;
          end if;
        else
          valid := training_log_private.valid_date(entry->'date')
            and jsonb_typeof(entry->'itemId') = 'string' and (routine_ids ? (entry->>'itemId'));
      end case;
      if valid is not true or identity is null or seen ? identity then
        raise exception using errcode = '22023', message = 'Invalid or duplicate snapshot row in ' || section;
      end if;
      seen := seen || jsonb_build_object(identity, true);
    end loop;
  end loop;
  if exists (select 1 from jsonb_array_elements(payload->'matches') as row
    where row ? 'recordId' group by row->>'recordId' having count(*) > 1) or exists (
    select 1 from jsonb_array_elements(payload->'routineVersions') as row
    where row ? 'sourceKey' group by row->>'sourceKey' having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'Duplicate snapshot references';
  end if;
end;
$$;

revoke execute on all functions in schema training_log_private from public, anon, authenticated;

create function public.training_log_write_snapshot_v2(expected_revision bigint, new_data jsonb)
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

revoke all on function public.training_log_write_snapshot_v2(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.training_log_write_snapshot_v2(bigint, jsonb) to authenticated;
revoke all on function public.training_log_update_snapshot(bigint, jsonb) from public, anon, authenticated;
revoke insert, update, delete, truncate on public.training_log_snapshots from public, anon, authenticated;
revoke insert (user_id, data, revision, updated_at), update (user_id, data, revision, updated_at)
  on public.training_log_snapshots from public, anon, authenticated;
drop policy training_log_insert_own on public.training_log_snapshots;

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

-- AOBA TRAINING LOG only. Reject local-only match details on every snapshot write path.

alter table public.training_log_snapshots
  add constraint training_log_no_local_match_details
  check (not jsonb_path_exists(data, '$.matches[*] ? (exists (@.details))'))
  not valid;

-- Existing rows are left untouched. New inserts and updates must satisfy the constraint.
-- END canonical migration bodies

DO $validate_existing$
BEGIN
  PERFORM training_log_private.validate_snapshot(data) FROM public.training_log_snapshots;
END
$validate_existing$;
ALTER TABLE public.training_log_snapshots
  VALIDATE CONSTRAINT training_log_no_local_match_details;

COMMIT;
