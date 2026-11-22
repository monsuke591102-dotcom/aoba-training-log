-- Reviewed cutover candidate. Run separately from cutover-install-v2.sql.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE EXECUTE ON FUNCTION public.training_log_update_snapshot(bigint, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.training_log_snapshots
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (user_id, data, revision, updated_at), UPDATE (user_id, data, revision, updated_at)
  ON public.training_log_snapshots FROM PUBLIC, anon, authenticated;

DO $stop$
DECLARE
  role_name text;
BEGIN
  IF to_regprocedure('public.training_log_write_snapshot_v2(bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected v2 function; reconcile the current deployment first';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF has_function_privilege(role_name, 'public.training_log_update_snapshot(bigint,jsonb)', 'EXECUTE')
       OR has_any_column_privilege(role_name, 'public.training_log_snapshots', 'INSERT, UPDATE')
       OR has_table_privilege(role_name, 'public.training_log_snapshots', 'DELETE, TRUNCATE') THEN
      RAISE EXCEPTION 'Legacy effective write permission remains for role %', role_name;
    END IF;
  END LOOP;
END
$stop$;

COMMIT;
