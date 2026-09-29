-- Read-only. These results prove configuration, not correctness of runtime ingestion.
select jsonb_build_object(
 'table_count',count(*),
 'all_rls_enabled',count(*)=7 and bool_and(c.relrowsecurity),
 'anon_select_denied',count(*)=7 and bool_and(not has_table_privilege('anon',c.oid,'SELECT')),
 'authenticated_select_denied',count(*)=7 and bool_and(not has_table_privilege('authenticated',c.oid,'SELECT')),
 'service_insert_denied',count(*)=7 and bool_and(not has_table_privilege('service_role',c.oid,'INSERT')),
 'immutable_trigger_count',(select count(*) from pg_trigger t join pg_class r on r.oid=t.tgrelid
   join pg_namespace s on s.oid=r.relnamespace where s.nspname='feedbackgb' and not t.tgisinternal
   and t.tgname in ('poster_receipt_payload_immutable','poster_client_snapshot_immutable',
     'poster_receipt_version_immutable','poster_receipt_line_immutable'))
) as receipt_foundation_readback
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='feedbackgb' and c.relkind='r' and c.relname in
 ('poster_receipt_import_runs','poster_receipt_source_payloads','poster_client_snapshots',
  'poster_receipt_identities','poster_receipt_versions','poster_receipt_line_versions','poster_receipt_field_registry');

select c.relname,c.relrowsecurity,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
  has_table_privilege('service_role',c.oid,'INSERT') as service_insert
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='feedbackgb' and c.relkind='r' and c.relname in
 ('poster_receipt_import_runs','poster_receipt_source_payloads','poster_client_snapshots',
  'poster_receipt_identities','poster_receipt_versions','poster_receipt_line_versions','poster_receipt_field_registry')
order by c.relname;
select tablename,indexname,indexdef from pg_indexes where schemaname='feedbackgb'
and tablename in ('poster_receipt_import_runs','poster_receipt_source_payloads','poster_client_snapshots',
 'poster_receipt_identities','poster_receipt_versions','poster_receipt_line_versions') order by tablename,indexname;
select tgname,pg_get_triggerdef(oid) from pg_trigger where not tgisinternal
and tgname in ('poster_receipt_payload_immutable','poster_client_snapshot_immutable',
 'poster_receipt_version_immutable','poster_receipt_line_immutable');
