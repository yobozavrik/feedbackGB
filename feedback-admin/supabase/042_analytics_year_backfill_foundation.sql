-- DRAFT / STAGING FIRST. Additive first part of shared year-history foundation.
-- No current cron/legacy RPC/view changes, no historical validity inference.
-- Year ingestion is disabled until staging readback + concurrency acceptance.
begin;
set local lock_timeout = '5s';

do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'analytics_year_requires_pg15';
  end if;
  if to_regclass('feedbackgb.foodcost_sales_backfill_jobs') is null
    or to_regclass('feedbackgb.foodcost_sales_backfill_attempts') is null
    or to_regclass('feedbackgb.foodcost_sales_backfill_events') is null
    or to_regclass('feedbackgb.v_stores') is null
    or to_regclass('feedbackgb.foodcost_sales_runs') is null then
    raise exception 'analytics_year_requires_040_041';
  end if;
  if has_table_privilege('service_role','feedbackgb.foodcost_sales_backfill_attempts','INSERT')
    or has_table_privilege('service_role','feedbackgb.foodcost_sales_backfill_events','INSERT') then
    raise exception 'analytics_year_requires_041_acl';
  end if;
end $$;

create table feedbackgb.analytics_source_policies (
  source text primary key check (source='poster_sales'),
  history_start date not null check (history_start=date '2026-01-01'),
  timezone text not null check (timezone='Europe/Kyiv'),
  enabled boolean not null default false,
  refresh_lookback_days integer not null check (refresh_lookback_days between 1 and 90),
  updated_at timestamptz not null default clock_timestamp()
);
-- Configuration, NOT a historical fact. Refresh workflow will be added separately.
insert into feedbackgb.analytics_source_policies(source,history_start,timezone,enabled,refresh_lookback_days)
values ('poster_sales',date '2026-01-01','Europe/Kyiv',false,7);

create table feedbackgb.analytics_spot_observations (
  spot_id bigint not null check (spot_id>0),
  observed_at timestamptz not null,
  registry_name text not null,
  evidence_source text not null check (evidence_source='worker_verified_current_roster'),
  historical_roster_verified boolean not null default false check (historical_roster_verified=false),
  primary key (spot_id,observed_at)
);
-- No FK to an active-only registry: deleting a current store must not delete evidence.
alter table feedbackgb.analytics_source_policies enable row level security;
alter table feedbackgb.analytics_spot_observations enable row level security;
-- Remove inherited/default privileges too; service_role has no direct policy mutations.
revoke all on feedbackgb.analytics_source_policies,feedbackgb.analytics_spot_observations
from public,anon,authenticated,service_role;
grant select on feedbackgb.analytics_source_policies,feedbackgb.analytics_spot_observations to service_role;

create function feedbackgb.seed_analytics_year_sales_jobs(p_spot_ids bigint[],p_checked_at timestamptz)
returns integer language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_today date; v_start date; v_count integer;
begin
  select history_start into v_start from feedbackgb.analytics_source_policies
  where source='poster_sales' and enabled for share;
  if not found then raise exception 'analytics_year_disabled'; end if;
  v_today:=(v_now at time zone 'Europe/Kyiv')::date;
  if v_start>=v_today or p_checked_at is null or p_checked_at<v_now-interval '5 minutes'
    or p_checked_at>v_now+interval '5 minutes'
    or p_spot_ids is null or cardinality(p_spot_ids)<1 or cardinality(p_spot_ids)>100
    or array_position(p_spot_ids,null) is not null
    or exists(select 1 from unnest(p_spot_ids) s(id) where id<=0)
    or cardinality(p_spot_ids)<>(select count(distinct id) from unnest(p_spot_ids) s(id))
    or cardinality(p_spot_ids)<>(select count(*) from feedbackgb.v_stores)
    or exists(select 1 from feedbackgb.v_stores s where not(s.id=any(p_spot_ids))) then
    raise exception 'invalid_analytics_year_seed';
  end if;
  -- Backend must first compare Poster access.getSpots with the registry.
  -- observed_at is a current observation, NEVER valid_from=history_start.
  insert into feedbackgb.analytics_spot_observations
    (spot_id,observed_at,registry_name,evidence_source,historical_roster_verified)
  select s.id,least(p_checked_at,v_now),s.name,'worker_verified_current_roster',false
  from feedbackgb.v_stores s where s.id=any(p_spot_ids)
  on conflict (spot_id,observed_at) do nothing;
  insert into feedbackgb.foodcost_sales_backfill_jobs (business_date,spot_id,roster_checked_at)
  select d::date,s.id,least(p_checked_at,v_now)
  from generate_series(v_start::timestamp,(v_today-1)::timestamp,interval '1 day') d
  cross join unnest(p_spot_ids) s(id)
  where not exists(select 1 from feedbackgb.foodcost_sales_runs r
    where r.business_date=d::date and r.spot_id=s.id and r.status='completed')
  on conflict (business_date,spot_id) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

create function feedbackgb.claim_analytics_year_sales_job(p_owner_token uuid,p_spot_ids bigint[])
returns table(business_date date,spot_id bigint,attempt_no integer,owner_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_now timestamptz:=clock_timestamp(); v_today date; v_start date;
  v_job feedbackgb.foodcost_sales_backfill_jobs%rowtype; v_reaped integer:=0;
begin
  select history_start into v_start from feedbackgb.analytics_source_policies
  where source='poster_sales' and enabled for share;
  if not found then raise exception 'analytics_year_disabled'; end if;
  v_today:=(v_now at time zone 'Europe/Kyiv')::date;
  if p_owner_token is null or p_spot_ids is null or cardinality(p_spot_ids)<1 or cardinality(p_spot_ids)>100
    or array_position(p_spot_ids,null) is not null
    or exists(select 1 from unnest(p_spot_ids) s(id) where id<=0)
    or cardinality(p_spot_ids)<>(select count(distinct id) from unnest(p_spot_ids) s(id))
    or cardinality(p_spot_ids)<>(select count(*) from feedbackgb.v_stores)
    or exists(select 1 from feedbackgb.v_stores s where not(s.id=any(p_spot_ids))) then
    raise exception 'invalid_analytics_year_claim';
  end if;
  loop
    select j.* into v_job from feedbackgb.foodcost_sales_backfill_jobs j
    where j.business_date>=v_start and j.business_date<v_today and j.spot_id=any(p_spot_ids)
      and ((j.status in ('pending','retryable_failed') and j.next_attempt_at<=v_now)
        or (j.status='running' and j.lease_expires_at<=v_now))
    order by j.business_date desc,j.spot_id for update skip locked limit 1;
    if not found then return; end if;
    if v_job.status='running' then
      update feedbackgb.foodcost_sales_backfill_attempts a
      set outcome='lease_expired',finished_at=v_now,error_code='backfill_lease_expired'
      where a.business_date=v_job.business_date and a.spot_id=v_job.spot_id
        and a.attempt_no=v_job.attempt_count and a.owner_token=v_job.owner_token and a.outcome='running';
    end if;
    if v_job.attempt_count>=8 then
      update feedbackgb.foodcost_sales_backfill_jobs j set status='failed',owner_token=null,
        lease_expires_at=null,last_error_code='backfill_lease_expired',updated_at=v_now
      where j.business_date=v_job.business_date and j.spot_id=v_job.spot_id;
      v_reaped:=v_reaped+1;
      if v_reaped>=128 then return; end if;
      continue;
    end if;
    update feedbackgb.foodcost_sales_backfill_jobs j set status='running',attempt_count=j.attempt_count+1,
      owner_token=p_owner_token,lease_expires_at=v_now+interval '15 minutes',last_error_code=null,updated_at=v_now
    where j.business_date=v_job.business_date and j.spot_id=v_job.spot_id;
    insert into feedbackgb.foodcost_sales_backfill_attempts(business_date,spot_id,attempt_no,owner_token,outcome)
    values(v_job.business_date,v_job.spot_id,v_job.attempt_count+1,p_owner_token,'running');
    return query select v_job.business_date,v_job.spot_id,v_job.attempt_count+1,p_owner_token,v_now+interval '15 minutes';
    return;
  end loop;
end $$;

create view feedbackgb.v_analytics_year_sales_coverage with (security_invoker=true) as
with scope as (select history_start,(statement_timestamp() at time zone 'Europe/Kyiv')::date today
  from feedbackgb.analytics_source_policies where source='poster_sales'),
expected as (select d::date business_date,s.id spot_id from scope c
  cross join lateral generate_series(c.history_start::timestamp,(c.today-1)::timestamp,interval '1 day') d
  cross join feedbackgb.v_stores s),
completed as (select distinct r.business_date,r.spot_id from feedbackgb.foodcost_sales_runs r cross join scope c
  where r.status='completed' and r.completed_at<=statement_timestamp()
    and r.business_date>=c.history_start and r.business_date<c.today)
select e.business_date,count(*) expected_spots,count(c.spot_id) completed_spots,
  count(*)-count(c.spot_id) missing_spots,false historical_roster_verified
from expected e left join completed c using(business_date,spot_id) group by e.business_date;

create view feedbackgb.v_analytics_year_sales_health with (security_invoker=true) as
with scope as (select history_start,enabled,(statement_timestamp() at time zone 'Europe/Kyiv')::date today
  from feedbackgb.analytics_source_policies where source='poster_sales'),
coverage as (select coalesce(sum(expected_spots),0) expected_cells,coalesce(sum(completed_spots),0) completed_cells,
  coalesce(sum(missing_spots),0) missing_cells from feedbackgb.v_analytics_year_sales_coverage),
queue as (select count(*) filter(where j.status='pending') pending_jobs,
  count(*) filter(where j.status='running') running_jobs,
  count(*) filter(where j.status='retryable_failed') retryable_jobs,count(*) filter(where j.status='failed') failed_jobs
  from scope c left join feedbackgb.foodcost_sales_backfill_jobs j
    on j.business_date>=c.history_start and j.business_date<c.today
    and j.spot_id in(select id from feedbackgb.v_stores))
select s.history_start date_from,s.today-1 date_to,s.enabled year_ingestion_enabled,
  (select count(*) from feedbackgb.v_stores) spot_count,c.expected_cells,c.completed_cells,c.missing_cells,
  q.pending_jobs,q.running_jobs,q.retryable_jobs,q.failed_jobs,false historical_roster_verified
from scope s cross join coverage c cross join queue q;

revoke all on feedbackgb.v_analytics_year_sales_coverage,feedbackgb.v_analytics_year_sales_health
from public,anon,authenticated,service_role;
grant select on feedbackgb.v_analytics_year_sales_coverage,feedbackgb.v_analytics_year_sales_health to service_role;
revoke all on function feedbackgb.seed_analytics_year_sales_jobs(bigint[],timestamptz) from public,anon,authenticated,service_role;
revoke all on function feedbackgb.claim_analytics_year_sales_job(uuid,bigint[]) from public,anon,authenticated,service_role;
grant execute on function feedbackgb.seed_analytics_year_sales_jobs(bigint[],timestamptz) to service_role;
grant execute on function feedbackgb.claim_analytics_year_sales_job(uuid,bigint[]) to service_role;
notify pgrst, 'reload schema';
commit;
