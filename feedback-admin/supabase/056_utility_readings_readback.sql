-- Read-only gate after installing 056_utility_readings.sql in the intended project.
-- Expected: 6 tables, 4 functions, RLS on all tables, private bucket.
select table_name from information_schema.tables
where table_schema = 'feedbackgb' and table_name like 'utility_%' order by table_name;

select c.relname, c.relkind, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'feedbackgb' and c.relname like 'utility_%' order by c.relname;

select p.proname, pg_get_function_identity_arguments(p.oid) as args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'feedbackgb' and p.proname in
  ('ensure_current_utility_period','submit_utility_photos',
   'review_utility_submission','claim_utility_delivery_job') order by p.proname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'utility-reading-photos';

select 'periods' as item, count(*) as n from feedbackgb.utility_periods
union all select 'submissions', count(*) from feedbackgb.utility_submissions
union all select 'delivery_jobs', count(*) from feedbackgb.utility_delivery_jobs;

select period_start, period_end, due_at,
  (due_at at time zone 'Europe/Kyiv') as due_kyiv
from feedbackgb.utility_periods
where period_start = date_trunc('month', now() at time zone 'Europe/Kyiv')::date;
