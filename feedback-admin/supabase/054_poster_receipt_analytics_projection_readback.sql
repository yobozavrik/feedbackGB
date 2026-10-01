select jsonb_build_object(
  'projection_tables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feedbackgb' and c.relname in ('poster_receipt_analytics_runs',
      'poster_receipt_analytics_facts','poster_receipt_line_analytics_facts')),
  'all_rls_enabled', not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feedbackgb' and c.relname in ('poster_receipt_analytics_runs',
      'poster_receipt_analytics_facts','poster_receipt_line_analytics_facts') and not c.relrowsecurity),
  'product_bridge', to_regclass('feedbackgb.v_poster_receipt_product_bridge') is not null,
  'project_rpc', to_regprocedure('feedbackgb.project_poster_receipt_analytics_day(date)') is not null,
  'audit_rpc', to_regprocedure('feedbackgb.audit_poster_receipt_analytics_day(date)') is not null,
  'capture_trigger', exists(select 1 from pg_trigger where tgname='poster_receipt_capture_analytics_projection' and not tgisinternal),
  'service_project_execute', has_function_privilege('service_role','feedbackgb.project_poster_receipt_analytics_day(date)','execute'),
  'anon_project_denied', not has_function_privilege('anon','feedbackgb.project_poster_receipt_analytics_day(date)','execute'),
  'authenticated_project_denied', not has_function_privilege('authenticated','feedbackgb.project_poster_receipt_analytics_day(date)','execute'),
  'service_direct_select_denied', not has_table_privilege('service_role','feedbackgb.poster_receipt_analytics_facts','select'),
  'raw_payload_still_denied', not has_table_privilege('service_role','feedbackgb.poster_receipt_source_payloads','select'),
  'projected_days', (select count(*) from feedbackgb.poster_receipt_analytics_runs)
) as receipt_analytics_projection_readback;
