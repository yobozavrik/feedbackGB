select jsonb_build_object(
  'reader_exists', to_regprocedure('feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)') is not null,
  'helper_exists', to_regprocedure('feedbackgb._store_analytics_latest_facts(date,date,bigint[],timestamptz)') is not null,
  'service_execute', has_function_privilege('service_role',
    'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)', 'execute'),
  'anon_execute_denied', not has_function_privilege('anon',
    'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)', 'execute'),
  'authenticated_execute_denied', not has_function_privilege('authenticated',
    'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)', 'execute'),
  'helper_service_execute_denied', not has_function_privilege('service_role',
    'feedbackgb._store_analytics_latest_facts(date,date,bigint[],timestamptz)', 'execute')
) as store_category_product_readback;

-- Runtime sample after applying 052. This is read-only and must return either
-- complete metrics or an explicit incomplete coverage state.
select feedbackgb.read_store_category_product_analytics(
  current_date - 7, current_date - 1, null,
  current_date - 14, current_date - 8, clock_timestamp(),
  null, false, null, null, '', 'revenue', 'desc', 25, 0
) as store_category_product_sample;
