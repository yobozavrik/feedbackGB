select jsonb_build_object(
 'rpc_exists',to_regprocedure('feedbackgb.import_poster_receipt_bundle(jsonb)') is not null,
 'service_execute',has_function_privilege('service_role',to_regprocedure('feedbackgb.import_poster_receipt_bundle(jsonb)'),'EXECUTE'),
 'anon_execute_denied',not has_function_privilege('anon',to_regprocedure('feedbackgb.import_poster_receipt_bundle(jsonb)'),'EXECUTE'),
 'authenticated_execute_denied',not has_function_privilege('authenticated',to_regprocedure('feedbackgb.import_poster_receipt_bundle(jsonb)'),'EXECUTE'),
 'ingestion_enabled',(select enabled from feedbackgb.poster_receipt_ingest_policy where singleton),
 'policy_rls',(select relrowsecurity from pg_class where oid='feedbackgb.poster_receipt_ingest_policy'::regclass),
 'service_direct_insert_denied',not has_table_privilege('service_role','feedbackgb.poster_receipt_import_runs','INSERT'),
 'run_immutability_trigger',exists(select 1 from pg_trigger where tgrelid='feedbackgb.poster_receipt_import_runs'::regclass
    and tgname='poster_receipt_accepted_run_immutable' and not tgisinternal),
 'manifest_column',exists(select 1 from information_schema.columns where table_schema='feedbackgb'
    and table_name='poster_receipt_import_runs' and column_name='bundle_sha256')
) as receipt_atomic_import_readback;
