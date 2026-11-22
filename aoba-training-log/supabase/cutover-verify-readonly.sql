BEGIN READ ONLY;
SET LOCAL row_security = off;

SELECT to_regprocedure('public.training_log_write_snapshot_v2(bigint,jsonb)') IS NOT NULL AS v2_exists,
       to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS has_cli_history;

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result, pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       EXISTS (SELECT FROM unnest(p.proconfig) AS cfg WHERE cfg = 'search_path=pg_catalog') AS fixed_search_path,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       EXISTS (
           SELECT FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute
FROM pg_proc AS p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('training_log_update_snapshot', 'training_log_write_snapshot_v2')
ORDER BY p.proname, arguments;

SELECT r.role_name,
       has_table_privilege(r.role_name, c.oid, 'SELECT') AS can_select,
       has_any_column_privilege(r.role_name, c.oid, 'INSERT') AS can_insert,
       has_any_column_privilege(r.role_name, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(r.role_name, c.oid, 'DELETE, TRUNCATE') AS can_delete_or_truncate,
       c.relrowsecurity AS rls_enabled
FROM pg_class AS c
CROSS JOIN (VALUES ('authenticated'), ('anon')) AS r(role_name)
WHERE c.oid = 'public.training_log_snapshots'::regclass;

SELECT policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'training_log_snapshots'
ORDER BY policyname;

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.training_log_snapshots'::regclass
ORDER BY conname;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.training_log_snapshots'::regclass AND NOT tgisinternal
ORDER BY tgname;

SELECT count(*) AS snapshot_count,
       count(*) FILTER (
           WHERE jsonb_path_exists(data, '$.matches[*] ? (exists (@.details))')
       ) AS rows_with_match_details,
       min(revision) AS min_revision, max(revision) AS max_revision,
       min(updated_at) AS oldest_updated_at, max(updated_at) AS latest_updated_at,
       md5(COALESCE(string_agg(md5(data::text), ',' ORDER BY user_id), '')) AS payload_fingerprint
FROM public.training_log_snapshots;

COMMIT;
