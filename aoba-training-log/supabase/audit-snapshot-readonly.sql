-- Approved read-only role only. Verify full-row visibility before using aggregate results.
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS has_cli_history,
       current_setting('transaction_read_only') = 'on' AS transaction_read_only,
       row_security_active('public.training_log_snapshots') AS rls_applies_to_session;

SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       ARRAY(SELECT option FROM unnest(p.proconfig) AS settings(option)
             WHERE option LIKE 'search_path=%') AS search_path,
       md5(pg_get_functiondef(p.oid)) AS definition_fingerprint,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       EXISTS (
           SELECT FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
       ) AS public_execute
FROM pg_proc AS p
JOIN pg_namespace AS ns ON ns.oid = p.pronamespace
WHERE ns.nspname = 'public'
  AND p.proname IN ('training_log_update_snapshot', 'training_log_write_snapshot_v2')
ORDER BY p.proname, arguments;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select,
       has_any_column_privilege('authenticated', c.oid, 'INSERT') AS authenticated_insert,
       has_any_column_privilege('authenticated', c.oid, 'UPDATE') AS authenticated_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS authenticated_delete,
       has_any_column_privilege('anon', c.oid, 'INSERT') AS anon_insert,
       has_any_column_privilege('anon', c.oid, 'UPDATE') AS anon_update,
       has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete
FROM pg_class AS c
WHERE c.oid = 'public.training_log_snapshots'::regclass;

SELECT policyname, cmd, roles, permissive
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'training_log_snapshots'
ORDER BY policyname;

SELECT conname, convalidated,
       md5(pg_get_constraintdef(oid)) AS definition_fingerprint
FROM pg_constraint
WHERE conrelid = 'public.training_log_snapshots'::regclass
ORDER BY conname;

SELECT COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE inspected.has_details) AS rows_with_match_details,
       COUNT(*) FILTER (
           WHERE jsonb_typeof(s.data) IS DISTINCT FROM 'object'
              OR (s.data ? 'matches' AND jsonb_typeof(s.data -> 'matches') IS DISTINCT FROM 'array')
              OR inspected.has_non_object
       ) AS rows_with_uninspectable_match_format
FROM public.training_log_snapshots AS s
CROSS JOIN LATERAL (
    SELECT COUNT(*) FILTER (
               WHERE jsonb_typeof(m.value) = 'object' AND m.value ? 'details'
           ) > 0 AS has_details,
           COUNT(*) FILTER (
               WHERE jsonb_typeof(m.value) IS DISTINCT FROM 'object'
           ) > 0 AS has_non_object
    FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.data -> 'matches') = 'array'
             THEN s.data -> 'matches' ELSE '[]'::jsonb END
    ) AS m(value)
) AS inspected;
