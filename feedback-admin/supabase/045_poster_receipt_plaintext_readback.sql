-- Read-only. No personal data, raw bodies or credentials returned.
select jsonb_build_object(
  'raw_body_column',exists(select 1 from information_schema.columns where table_schema='feedbackgb' and table_name='poster_receipt_source_payloads' and column_name='raw_body' and data_type='text'),
  'source_sha256_column',exists(select 1 from information_schema.columns where table_schema='feedbackgb' and table_name='poster_receipt_source_payloads' and column_name='source_sha256'),
  'storage_shape_validated',exists(select 1 from pg_constraint where conrelid='feedbackgb.poster_receipt_source_payloads'::regclass and conname='poster_receipt_source_payloads_storage_shape_check' and convalidated),
  'payload_rls',(select relrowsecurity from pg_class where oid='feedbackgb.poster_receipt_source_payloads'::regclass),
  'payload_immutable',exists(select 1 from pg_trigger where tgrelid='feedbackgb.poster_receipt_source_payloads'::regclass and tgname='poster_receipt_payload_immutable' and tgenabled<>'D'),
  'anon_select_denied',not has_table_privilege('anon','feedbackgb.poster_receipt_source_payloads','select'),
  'authenticated_select_denied',not has_table_privilege('authenticated','feedbackgb.poster_receipt_source_payloads','select'),
  'service_direct_select_denied',not has_table_privilege('service_role','feedbackgb.poster_receipt_source_payloads','select'),
  'service_direct_insert_denied',not has_table_privilege('service_role','feedbackgb.poster_receipt_source_payloads','insert'),
  'service_rpc_execute',has_function_privilege('service_role','feedbackgb.import_poster_receipt_bundle(jsonb)','execute'),
  'raw_rpc_present',position('raw-utf8-v1' in pg_get_functiondef('feedbackgb.import_poster_receipt_bundle(jsonb)'::regprocedure))>0,
  'ingestion_enabled',(select enabled from feedbackgb.poster_receipt_ingest_policy where singleton),
  'accepted_runs',(select count(*) from feedbackgb.poster_receipt_import_runs where status='accepted')
) as receipt_plaintext_readback;
