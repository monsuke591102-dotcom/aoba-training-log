-- AOBA TRAINING LOG only. Reject local-only match details on every snapshot write path.
begin;

alter table public.training_log_snapshots
  add constraint training_log_no_local_match_details
  check (not jsonb_path_exists(data, '$.matches[*] ? (exists (@.details))'))
  not valid;

-- Existing rows are left untouched. New inserts and updates must satisfy the constraint.
commit;
