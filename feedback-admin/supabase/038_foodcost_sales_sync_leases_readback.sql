-- Run after 038 in STAGING. Read-only structural and ACL checks.
-- Do not infer runtime concurrency correctness from these metadata checks.

select jsonb_build_object(
  'leases_table', to_regclass('feedbackgb.foodcost_sales_sync_leases') is not null,
  'leases_rls', coalesce((select relrowsecurity from pg_class
    where oid = to_regclass('feedbackgb.foodcost_sales_sync_leases')), false),
  'batch_lease_table', to_regclass('feedbackgb.foodcost_sales_batch_lease') is not null,
  'batch_lease_rls', coalesce((select relrowsecurity from pg_class
    where oid = to_regclass('feedbackgb.foodcost_sales_batch_lease')), false),
  'batch_acquire_function', to_regprocedure(
    'feedbackgb.acquire_foodcost_sales_batch_lease(uuid,integer)') is not null,
  'batch_release_function', to_regprocedure(
    'feedbackgb.release_foodcost_sales_batch_lease(uuid)') is not null,
  'acquire_function', to_regprocedure(
    'feedbackgb.acquire_foodcost_sales_sync_lease(date,bigint,uuid,integer)') is not null,
  'release_function', to_regprocedure(
    'feedbackgb.release_foodcost_sales_sync_lease(date,bigint,uuid)') is not null,
  'complete_function', to_regprocedure(
    'feedbackgb.complete_foodcost_sales_sync_run(uuid,uuid,integer,bigint,bigint,bigint,timestamptz)') is not null,
  'anon_lease_select', has_table_privilege('anon',
    'feedbackgb.foodcost_sales_sync_leases', 'select'),
  'authenticated_lease_select', has_table_privilege('authenticated',
    'feedbackgb.foodcost_sales_sync_leases', 'select'),
  'anon_batch_select', has_table_privilege('anon',
    'feedbackgb.foodcost_sales_batch_lease', 'select'),
  'authenticated_batch_select', has_table_privilege('authenticated',
    'feedbackgb.foodcost_sales_batch_lease', 'select'),
  'service_batch_select', has_table_privilege('service_role',
    'feedbackgb.foodcost_sales_batch_lease', 'select'),
  'service_lease_select', has_table_privilege('service_role',
    'feedbackgb.foodcost_sales_sync_leases', 'select'),
  'anon_acquire_execute', has_function_privilege('anon',
    'feedbackgb.acquire_foodcost_sales_sync_lease(date,bigint,uuid,integer)', 'execute'),
  'authenticated_acquire_execute', has_function_privilege('authenticated',
    'feedbackgb.acquire_foodcost_sales_sync_lease(date,bigint,uuid,integer)', 'execute'),
  'service_acquire_execute', has_function_privilege('service_role',
    'feedbackgb.acquire_foodcost_sales_sync_lease(date,bigint,uuid,integer)', 'execute'),
  'anon_batch_acquire_execute', has_function_privilege('anon',
    'feedbackgb.acquire_foodcost_sales_batch_lease(uuid,integer)', 'execute'),
  'authenticated_batch_acquire_execute', has_function_privilege('authenticated',
    'feedbackgb.acquire_foodcost_sales_batch_lease(uuid,integer)', 'execute'),
  'service_batch_acquire_execute', has_function_privilege('service_role',
    'feedbackgb.acquire_foodcost_sales_batch_lease(uuid,integer)', 'execute')
) as foodcost_lease_readback;

select business_date, spot_id, expires_at, acquired_at
from feedbackgb.foodcost_sales_sync_leases
order by expires_at desc limit 20;

select id, expires_at, acquired_at
from feedbackgb.foodcost_sales_batch_lease;
