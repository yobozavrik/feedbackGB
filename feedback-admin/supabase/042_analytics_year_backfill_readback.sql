-- SELECT ONLY after a STAGING application. Expected rows/settings documented inline.
select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='feedbackgb' and c.relname in ('analytics_source_policies','analytics_spot_observations',
  'v_analytics_year_sales_coverage','v_analytics_year_sales_health') order by c.relname;
--2 tables RLS=true;2 views security_invoker=true.
select * from feedbackgb.analytics_source_policies;
-- poster_sales,2026-01-01,Europe/Kyiv,enabled=false,lookback7.
select * from feedbackgb.v_analytics_year_sales_health;
-- date_from2026-01-01;expected=number of closed days since baseline×CURRENT registry stores.
select count(*) observations from feedbackgb.analytics_spot_observations;
--0 immediately after migration; no invented historical validity.
select p.oid::regprocedure,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='feedbackgb' and p.proname in ('seed_analytics_year_sales_jobs','claim_analytics_year_sales_job');
--2 functions,SECURITY DEFINER,search_path feedbackgb,pg_temp.
select 'relation' object_type,c.oid::regclass::text object_name,coalesce(r.rolname,'PUBLIC') grantee,a.privilege_type
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
left join pg_roles r on r.oid=a.grantee
where n.nspname='feedbackgb' and c.relname in ('analytics_source_policies','analytics_spot_observations',
  'v_analytics_year_sales_coverage','v_analytics_year_sales_health')
union all
select 'function',p.oid::regprocedure::text,coalesce(r.rolname,'PUBLIC'),a.privilege_type
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
left join pg_roles r on r.oid=a.grantee
where n.nspname='feedbackgb' and p.proname in ('seed_analytics_year_sales_jobs','claim_analytics_year_sales_job')
order by 1,2,3,4;
-- service_role SELECT only on4relations,EXECUTE on2RPCs; no PUBLIC/anon/authenticated.
-- Legacy definitions must still contain their120-day gates, not be replaced by042.
select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='feedbackgb' and p.proname in ('seed_foodcost_sales_backfill_jobs','claim_foodcost_sales_backfill_job');
-- Runtime STAGING tests in the implementation log remain mandatory; these SELECTs do not test races.
