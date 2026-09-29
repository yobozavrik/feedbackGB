-- Manual SQL Editor readback after applying 040. Do not treat this file as migration.
-- All statements are read-only. EXPLAIN ANALYZE at the end is runnable, but executes the SELECT.

-- 1) Objects, RLS, and indexes.
select n.nspname as schema_name, c.relname as object_name, c.relkind,
       c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='feedbackgb' and c.relname in (
  'foodcost_sales_backfill_jobs','foodcost_sales_backfill_attempts','foodcost_sales_backfill_events',
  'v_foodcost_sales_backfill_coverage','v_foodcost_sales_backfill_health'
) order by c.relname;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname='feedbackgb' and tablename like 'foodcost_sales_backfill_%'
order by tablename,indexname;

select pg_get_serial_sequence('feedbackgb.foodcost_sales_backfill_events','id') as events_identity_sequence;

-- 2) RPCs and trigger.
select p.oid::regprocedure as function_signature, p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='feedbackgb' and p.proname in (
 'seed_foodcost_sales_backfill_jobs','claim_foodcost_sales_backfill_job',
 'complete_foodcost_sales_backfill_job','fail_foodcost_sales_backfill_job',
 'log_foodcost_sales_backfill_event'
) order by p.proname;

select event_object_schema, event_object_table, trigger_name, action_timing,
       event_manipulation, action_statement
from information_schema.triggers
where event_object_schema='feedbackgb' and event_object_table='foodcost_sales_backfill_jobs';

-- 3) Effective ACLs for queue tables, RPCs, and views.
select 'table' as object_type, c.oid::regclass::text as object_name,
       coalesce(grantee.rolname,'PUBLIC') as grantee, privilege_type
from pg_class c join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
left join pg_roles grantee on grantee.oid=a.grantee
where n.nspname='feedbackgb' and c.relname in (
 'foodcost_sales_backfill_jobs','foodcost_sales_backfill_attempts','foodcost_sales_backfill_events',
 'v_foodcost_sales_backfill_coverage','v_foodcost_sales_backfill_health'
)
union all
select 'function', p.oid::regprocedure::text, coalesce(grantee.rolname,'PUBLIC'), privilege_type
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
left join pg_roles grantee on grantee.oid=a.grantee
where n.nspname='feedbackgb' and p.proname in (
 'seed_foodcost_sales_backfill_jobs','claim_foodcost_sales_backfill_job',
 'complete_foodcost_sales_backfill_job','fail_foodcost_sales_backfill_job'
 ,'log_foodcost_sales_backfill_event'
)
union all
select 'sequence', c.oid::regclass::text, coalesce(grantee.rolname,'PUBLIC'), privilege_type
from pg_class c
cross join lateral aclexplode(coalesce(c.relacl,acldefault('S',c.relowner))) a
left join pg_roles grantee on grantee.oid=a.grantee
where c.oid=pg_get_serial_sequence('feedbackgb.foodcost_sales_backfill_events','id')::regclass
order by 1,2,3,4;

-- 4) Current-roster coverage. This is current-roster projection, not historical roster proof.
with scope as (select (now() at time zone 'Europe/Kyiv')::date as today),
horizons(days) as (values (7),(14),(30),(60),(120)),
expected as (
  select h.days, d::date as business_date, s.id as spot_id
  from horizons h cross join scope x
  cross join lateral generate_series((x.today-h.days)::timestamp,(x.today-1)::timestamp,interval '1 day') d
  cross join feedbackgb.v_stores s
), completed as (
  select distinct r.business_date,r.spot_id from feedbackgb.foodcost_sales_runs r
  where r.status='completed'
)
select e.days,
       count(*) as expected_cells,
       count(c.spot_id) as completed_cells,
       count(*)-count(c.spot_id) as missing_cells,
       false as historical_roster_verified
from expected e left join completed c using (business_date,spot_id)
group by e.days order by e.days;

select * from feedbackgb.v_foodcost_sales_backfill_health;

-- 5) Completed-run metadata versus facts. Empty facts are compared as zero totals;
-- netto remains NULL when ANY actual source row has no netto value.
with fact_totals as (
  select r.id as run_id,r.business_date,r.spot_id,r.source_row_count,
         r.payed_sum_minor,r.product_profit_minor,r.product_profit_netto_minor,
         count(f.source_row_no) as fact_rows,
         coalesce(sum(f.payed_sum_minor),0) as facts_paid_minor,
         coalesce(sum(f.product_profit_minor),0) as facts_profit_minor,
         case when count(f.source_row_no) filter (where f.product_profit_netto_minor is null)>0
              then null else coalesce(sum(f.product_profit_netto_minor),0) end as facts_netto_minor
  from feedbackgb.foodcost_sales_runs r
  left join feedbackgb.foodcost_sales_facts f on f.run_id=r.id
  where r.status='completed'
  group by r.id
), mismatches as (
  select * from fact_totals
  where source_row_count is distinct from fact_rows
     or payed_sum_minor is distinct from facts_paid_minor
     or product_profit_minor is distinct from facts_profit_minor
     or product_profit_netto_minor is distinct from facts_netto_minor
)
select count(*) as completed_run_fact_mismatch_count from mismatches;

with fact_totals as (
  select r.id as run_id,r.business_date,r.spot_id,r.source_row_count,
         r.payed_sum_minor,r.product_profit_minor,r.product_profit_netto_minor,
         count(f.source_row_no) as fact_rows,
         coalesce(sum(f.payed_sum_minor),0) as facts_paid_minor,
         coalesce(sum(f.product_profit_minor),0) as facts_profit_minor,
         case when count(f.source_row_no) filter (where f.product_profit_netto_minor is null)>0
              then null else coalesce(sum(f.product_profit_netto_minor),0) end as facts_netto_minor
  from feedbackgb.foodcost_sales_runs r
  left join feedbackgb.foodcost_sales_facts f on f.run_id=r.id
  where r.status='completed'
  group by r.id
)
select * from fact_totals
where source_row_count is distinct from fact_rows
   or payed_sum_minor is distinct from facts_paid_minor
   or product_profit_minor is distinct from facts_profit_minor
   or product_profit_netto_minor is distinct from facts_netto_minor
order by business_date desc,spot_id;

-- 6) Runnable plan/sample runtime. This executes the SELECT; use only in SQL Editor when approved.
explain (analyze,buffers)
select d::date as business_date,s.id as spot_id
from generate_series(
       (((now() at time zone 'Europe/Kyiv')::date-120)::timestamp),
       (((now() at time zone 'Europe/Kyiv')::date-1)::timestamp), interval '1 day'
     ) d
cross join feedbackgb.v_stores s
where not exists (
  select 1 from feedbackgb.foodcost_sales_runs r
  where r.business_date=d::date and r.spot_id=s.id and r.status='completed'
);
