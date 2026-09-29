-- Empty-foundation rollback ONLY. Refuses rollback once any source/history exists.
begin;
lock table feedbackgb.poster_receipt_import_runs,feedbackgb.poster_receipt_source_payloads,
 feedbackgb.poster_client_snapshots,feedbackgb.poster_receipt_identities,feedbackgb.poster_receipt_versions,
 feedbackgb.poster_receipt_line_versions,feedbackgb.poster_receipt_field_registry in access exclusive mode;
do $$
begin
  if exists(select 1 from feedbackgb.poster_receipt_import_runs)
    or exists(select 1 from feedbackgb.poster_receipt_source_payloads)
    or exists(select 1 from feedbackgb.poster_client_snapshots)
    or exists(select 1 from feedbackgb.poster_receipt_identities)
    or exists(select 1 from feedbackgb.poster_receipt_versions)
    or exists(select 1 from feedbackgb.poster_receipt_line_versions)
    or exists(select 1 from feedbackgb.poster_receipt_field_registry)
  then raise exception 'receipt_rollback_refused_nonempty'; end if;
end $$;
drop table feedbackgb.poster_receipt_line_versions;
drop table feedbackgb.poster_receipt_versions;
drop table feedbackgb.poster_receipt_identities;
drop table feedbackgb.poster_client_snapshots;
drop table feedbackgb.poster_receipt_source_payloads;
drop table feedbackgb.poster_receipt_import_runs;
drop table feedbackgb.poster_receipt_field_registry;
drop function feedbackgb.reject_poster_receipt_archive_mutation();
commit;
