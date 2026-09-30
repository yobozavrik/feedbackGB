select jsonb_build_object(
  'function_exists', to_regprocedure(
    'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)'
  ) is not null,
  'legacy_max_uuid_removed', position(
    'max(r.id)' in pg_get_functiondef(to_regprocedure(
      'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)'
    ))
  ) = 0,
  'uuid_text_selector_count', (
    length(pg_get_functiondef(to_regprocedure(
      'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)'
    ))) - length(replace(pg_get_functiondef(to_regprocedure(
      'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)'
    )), 'min(r.id::text)::uuid', ''))
  ) / length('min(r.id::text)::uuid'),
  'service_execute', has_function_privilege('service_role',
    'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)', 'EXECUTE'),
  'anon_execute_denied', not has_function_privilege('anon',
    'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)', 'EXECUTE'),
  'authenticated_execute_denied', not has_function_privilege('authenticated',
    'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)', 'EXECUTE')
) as store_analytics_uuid_fix_readback;

select feedbackgb.read_store_analytics_overview(
  current_date - 7,
  current_date - 1,
  null,
  current_date - 14,
  current_date - 8,
  clock_timestamp()
) as store_analytics_overview_sample;
