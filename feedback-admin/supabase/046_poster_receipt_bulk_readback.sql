-- Read-only, no raw source/client values.
select jsonb_build_object(
  'bulk_receipt_insert',position('select populated.*' in pg_get_functiondef('feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure))>0,
  'lateral_receipt_projection',position('cross join lateral jsonb_populate_record(null::feedbackgb.poster_receipt_versions' in pg_get_functiondef('feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure))>0,
  'lateral_line_projection',position('cross join lateral jsonb_populate_record(null::feedbackgb.poster_receipt_line_versions' in pg_get_functiondef('feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure))>0,
  'raw_supported',position('raw-utf8-v1' in pg_get_functiondef('feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure))>0,
  'security_definer',(select prosecdef from pg_proc where oid='feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure),
  'service_execute',has_function_privilege('service_role','feedbackgb.import_poster_receipt_bundle(jsonb)','execute'),
  'anon_execute_denied',not has_function_privilege('anon','feedbackgb.import_poster_receipt_bundle(jsonb)','execute'),
  'authenticated_execute_denied',not has_function_privilege('authenticated','feedbackgb.import_poster_receipt_bundle(jsonb)','execute'),
  'payload_rls',(select relrowsecurity from pg_class where oid='feedbackgb.poster_receipt_source_payloads'::regclass),
  'service_direct_select_denied',not has_table_privilege('service_role','feedbackgb.poster_receipt_source_payloads','select'),
  'ingestion_enabled',(select enabled from feedbackgb.poster_receipt_ingest_policy where singleton),
  'accepted_runs',(select count(*) from feedbackgb.poster_receipt_import_runs where status='accepted')
) as receipt_bulk_readback;
