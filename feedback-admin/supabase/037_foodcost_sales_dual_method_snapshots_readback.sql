-- Read-only checks AFTER applying 037 on staging. Expected: both tables exist,
-- RLS=true, service_role SELECT=true, anon/authenticated SELECT=false,
-- public_objects=0. Before first sync, both row counts are 0.

select jsonb_build_object(
  'runs_table', to_regclass('feedbackgb.foodcost_sales_runs'),
  'facts_table', to_regclass('feedbackgb.foodcost_sales_facts'),
  'runs_rls', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'feedbackgb' and c.relname = 'foodcost_sales_runs'),
  'facts_rls', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'feedbackgb' and c.relname = 'foodcost_sales_facts'),
  'runs_service_select', has_table_privilege('service_role', 'feedbackgb.foodcost_sales_runs', 'select'),
  'facts_service_select', has_table_privilege('service_role', 'feedbackgb.foodcost_sales_facts', 'select'),
  'runs_anon_select', has_table_privilege('anon', 'feedbackgb.foodcost_sales_runs', 'select'),
  'facts_anon_select', has_table_privilege('anon', 'feedbackgb.foodcost_sales_facts', 'select'),
  'runs_authenticated_select', has_table_privilege('authenticated', 'feedbackgb.foodcost_sales_runs', 'select'),
  'facts_authenticated_select', has_table_privilege('authenticated', 'feedbackgb.foodcost_sales_facts', 'select'),
  'public_objects', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('foodcost_sales_runs', 'foodcost_sales_facts')),
  'runs_rows', (select count(*) from feedbackgb.foodcost_sales_runs),
  'facts_rows', (select count(*) from feedbackgb.foodcost_sales_facts)
) as foodcost_037_readback;
