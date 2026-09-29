-- Persistent, missing-only Poster sales queue. Forward-only; objects stay in feedbackgb.
begin;

do $$
begin
  if to_regclass('feedbackgb.foodcost_sales_runs') is null
    or to_regclass('feedbackgb.foodcost_sales_facts') is null
    or to_regclass('feedbackgb.foodcost_sales_sync_leases') is null
    or to_regprocedure('feedbackgb.acquire_foodcost_sales_sync_lease(date,bigint,uuid,integer)') is null
    or to_regprocedure('feedbackgb.release_foodcost_sales_sync_lease(date,bigint,uuid)') is null
    or to_regprocedure('feedbackgb.complete_foodcost_sales_sync_run(uuid,uuid,integer,bigint,bigint,bigint,timestamptz)') is null then
    raise exception 'foodcost_backfill_requires_037_038';
  end if;
end $$;

create table feedbackgb.foodcost_sales_backfill_jobs (
  business_date date not null,
  spot_id bigint not null check (spot_id > 0),
  status text not null default 'pending' check (status in ('pending','running','retryable_failed','completed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default clock_timestamp(),
  owner_token uuid,
  lease_expires_at timestamptz,
  completed_run_id uuid references feedbackgb.foodcost_sales_runs(id) on delete restrict,
  roster_checked_at timestamptz not null,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (business_date, spot_id),
  check ((status='running' and owner_token is not null and lease_expires_at is not null and completed_run_id is null)
    or (status='completed' and owner_token is null and lease_expires_at is null and completed_run_id is not null)
    or (status in ('pending','retryable_failed','failed') and owner_token is null and lease_expires_at is null and completed_run_id is null))
);
create index foodcost_sales_backfill_claim_idx on feedbackgb.foodcost_sales_backfill_jobs
  (business_date desc, spot_id, next_attempt_at) where status in ('pending','retryable_failed');
create index foodcost_sales_backfill_expired_idx on feedbackgb.foodcost_sales_backfill_jobs
  (lease_expires_at) where status='running';

create table feedbackgb.foodcost_sales_backfill_attempts (
  business_date date not null, spot_id bigint not null, attempt_no integer not null check (attempt_no > 0),
  owner_token uuid not null, started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  outcome text not null check (outcome in ('running','completed','already_completed','retryable_failed','failed','lease_expired')),
  run_id uuid references feedbackgb.foodcost_sales_runs(id) on delete restrict, error_code text,
  primary key (business_date, spot_id, attempt_no),
  foreign key (business_date, spot_id) references feedbackgb.foodcost_sales_backfill_jobs(business_date, spot_id) on delete restrict,
  check ((outcome='running' and finished_at is null) or (outcome<>'running' and finished_at is not null))
);
create table feedbackgb.foodcost_sales_backfill_events (
  id bigint generated always as identity primary key,
  business_date date not null, spot_id bigint not null, event_type text not null, status text not null,
  attempt_count integer not null, owner_token uuid, error_code text,
  run_id uuid references feedbackgb.foodcost_sales_runs(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (business_date, spot_id) references feedbackgb.foodcost_sales_backfill_jobs(business_date, spot_id) on delete restrict
);
create index foodcost_sales_backfill_events_job_idx
  on feedbackgb.foodcost_sales_backfill_events (business_date, spot_id, created_at desc);

alter table feedbackgb.foodcost_sales_backfill_jobs enable row level security;
alter table feedbackgb.foodcost_sales_backfill_attempts enable row level security;
alter table feedbackgb.foodcost_sales_backfill_events enable row level security;
revoke all on table feedbackgb.foodcost_sales_backfill_jobs from public, anon, authenticated;
revoke all on table feedbackgb.foodcost_sales_backfill_attempts from public, anon, authenticated;
revoke all on table feedbackgb.foodcost_sales_backfill_events from public, anon, authenticated;
grant select, insert, update, delete on feedbackgb.foodcost_sales_backfill_jobs to service_role;
grant select on feedbackgb.foodcost_sales_backfill_attempts, feedbackgb.foodcost_sales_backfill_events to service_role;
revoke all on sequence feedbackgb.foodcost_sales_backfill_events_id_seq from public, anon, authenticated;

create function feedbackgb.log_foodcost_sales_backfill_event() returns trigger
language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_type text;
begin
  if tg_op='INSERT' then v_type := 'seeded';
  elsif old.status is distinct from new.status then v_type := new.status;
  elsif old.owner_token is distinct from new.owner_token then v_type := 'claimed';
  elsif old.attempt_count is distinct from new.attempt_count then v_type := 'attempt_count_changed';
  else return new; end if;
  insert into feedbackgb.foodcost_sales_backfill_events
    (business_date,spot_id,event_type,status,attempt_count,owner_token,error_code,run_id)
  values (new.business_date,new.spot_id,v_type,new.status,new.attempt_count,new.owner_token,new.last_error_code,new.completed_run_id);
  return new;
end $$;
create trigger foodcost_sales_backfill_job_event after insert or update
on feedbackgb.foodcost_sales_backfill_jobs for each row
execute function feedbackgb.log_foodcost_sales_backfill_event();

create function feedbackgb.seed_foodcost_sales_backfill_jobs(p_spot_ids bigint[], p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_db_now timestamptz := clock_timestamp();
  v_today date; v_inserted integer;
begin
  v_today := (v_db_now at time zone 'Europe/Kyiv')::date;
  if p_spot_ids is null or cardinality(p_spot_ids) < 1 or cardinality(p_spot_ids) > 100
    or p_now is null or p_now > v_db_now + interval '5 minutes'
    or (p_now at time zone 'Europe/Kyiv')::date <> v_today
    or array_position(p_spot_ids,null) is not null
    or exists(select 1 from unnest(p_spot_ids) s(id) where id <= 0)
    or cardinality(p_spot_ids) <> (select count(distinct id) from unnest(p_spot_ids) s(id))
    or cardinality(p_spot_ids) <> (select count(*) from feedbackgb.v_stores)
    or exists(select 1 from feedbackgb.v_stores s where not (s.id = any(p_spot_ids))) then
    raise exception 'invalid_foodcost_backfill_seed';
  end if;
  insert into feedbackgb.foodcost_sales_backfill_jobs (business_date,spot_id,roster_checked_at)
  select d::date,s.id,least(p_now,v_db_now)
  from generate_series((v_today-120)::timestamp,(v_today-1)::timestamp,interval '1 day') d
  cross join unnest(p_spot_ids) s(id)
  where not exists (select 1 from feedbackgb.foodcost_sales_runs r
    where r.business_date=d::date and r.spot_id=s.id and r.status='completed')
  on conflict (business_date,spot_id) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end $$;

create function feedbackgb.claim_foodcost_sales_backfill_job(p_owner_token uuid,p_spot_ids bigint[])
returns table(business_date date,spot_id bigint,attempt_no integer,owner_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_today date := (clock_timestamp() at time zone 'Europe/Kyiv')::date;
  v_now timestamptz := clock_timestamp(); v_job feedbackgb.foodcost_sales_backfill_jobs%rowtype;
  v_reaped integer := 0;
begin
  if p_owner_token is null or p_spot_ids is null or cardinality(p_spot_ids)<1 or cardinality(p_spot_ids)>100
    or array_position(p_spot_ids,null) is not null or exists(select 1 from unnest(p_spot_ids) s(id) where id<=0)
    or cardinality(p_spot_ids)<>(select count(distinct id) from unnest(p_spot_ids) s(id))
    or cardinality(p_spot_ids)<>(select count(*) from feedbackgb.v_stores)
    or exists(select 1 from feedbackgb.v_stores s where not (s.id=any(p_spot_ids))) then
    raise exception 'invalid_foodcost_backfill_claim';
  end if;
  loop
    select j.* into v_job from feedbackgb.foodcost_sales_backfill_jobs j
    where j.business_date>=v_today-120 and j.business_date<v_today and j.spot_id=any(p_spot_ids)
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

create function feedbackgb.complete_foodcost_sales_backfill_job(
  p_business_date date,p_spot_id bigint,p_owner_token uuid,p_run_id uuid,p_outcome text default 'completed')
returns boolean language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_job feedbackgb.foodcost_sales_backfill_jobs%rowtype; v_now timestamptz;
begin
  if p_business_date is null or p_spot_id is null or p_spot_id <= 0 or p_owner_token is null or p_run_id is null
    or p_outcome is null or p_outcome not in ('completed','already_completed') then
    raise exception 'invalid_backfill_completion';
  end if;
  select * into v_job from feedbackgb.foodcost_sales_backfill_jobs j
    where j.business_date=p_business_date and j.spot_id=p_spot_id for update;
  v_now:=clock_timestamp();
  if not found or v_job.status<>'running' or v_job.owner_token is distinct from p_owner_token or v_job.lease_expires_at<=v_now
    then raise exception 'backfill_lease_lost'; end if;
  if not exists(select 1 from feedbackgb.foodcost_sales_runs r where r.id=p_run_id
    and r.business_date=p_business_date and r.spot_id=p_spot_id and r.status='completed')
    then raise exception 'backfill_run_not_completed'; end if;
  update feedbackgb.foodcost_sales_backfill_jobs j set status='completed',completed_run_id=p_run_id,
    owner_token=null,lease_expires_at=null,last_error_code=null,updated_at=v_now
  where j.business_date=p_business_date and j.spot_id=p_spot_id and j.owner_token=p_owner_token and j.lease_expires_at>v_now;
  if not found then raise exception 'backfill_lease_lost'; end if;
  update feedbackgb.foodcost_sales_backfill_attempts set outcome=p_outcome,finished_at=v_now,run_id=p_run_id
  where business_date=p_business_date and spot_id=p_spot_id and attempt_no=v_job.attempt_count
    and owner_token=p_owner_token and outcome='running';
  return true;
end $$;

create function feedbackgb.fail_foodcost_sales_backfill_job(p_business_date date,p_spot_id bigint,p_owner_token uuid,p_error_code text)
returns text language plpgsql security definer set search_path = feedbackgb, pg_temp as $$
declare v_job feedbackgb.foodcost_sales_backfill_jobs%rowtype; v_now timestamptz;
  v_code text; v_status text; v_delay integer;
begin
  if p_business_date is null or p_spot_id is null or p_spot_id <= 0 or p_owner_token is null or p_error_code is null then
    raise exception 'invalid_backfill_failure';
  end if;
  v_code:=case when p_error_code in ('schema_missing','service_role_missing','poster_token_missing','supabase_missing',
    'poster_unavailable','poster_invalid_response','invalid_poster_spots','foodcost_roster_unavailable',
    'foodcost_roster_mismatch','unknown_poster_spot','sales_day_not_closed','foodcost_sync_in_progress',
    'supabase_abort_unsupported','foodcost_lease_lost','invalid_sales_sync_scope','invalid_foodcost_backfill_seed',
    'foodcost_fact_count_mismatch','foodcost_fact_order_mismatch','foodcost_fact_totals_mismatch',
    'foodcost_db_completion_mismatch','backfill_deadline','job_timeout','foodcost_sync_failed',
    'backfill_lease_expired') then p_error_code else 'backfill_unexpected_error' end;
  select * into v_job from feedbackgb.foodcost_sales_backfill_jobs j
    where j.business_date=p_business_date and j.spot_id=p_spot_id for update;
  v_now:=clock_timestamp();
  if not found or v_job.status<>'running' or v_job.owner_token is distinct from p_owner_token or v_job.lease_expires_at<=v_now
    then raise exception 'backfill_lease_lost'; end if;
  v_status:=case when v_job.attempt_count>=8 then 'failed' else 'retryable_failed' end;
  v_delay:=least(300*(2^least(v_job.attempt_count-1,6)),21600);
  update feedbackgb.foodcost_sales_backfill_jobs j set status=v_status,owner_token=null,lease_expires_at=null,
    next_attempt_at=v_now+make_interval(secs=>v_delay),last_error_code=v_code,updated_at=v_now
  where j.business_date=p_business_date and j.spot_id=p_spot_id and j.owner_token=p_owner_token and j.lease_expires_at>v_now;
  if not found then raise exception 'backfill_lease_lost'; end if;
  update feedbackgb.foodcost_sales_backfill_attempts set outcome=v_status,finished_at=v_now,error_code=v_code
  where business_date=p_business_date and spot_id=p_spot_id and attempt_no=v_job.attempt_count
    and owner_token=p_owner_token and outcome='running';
  return v_status;
end $$;

create view feedbackgb.v_foodcost_sales_backfill_coverage with (security_invoker=true) as
with scope as (select (now() at time zone 'Europe/Kyiv')::date today),
expected as (select d::date business_date,s.id spot_id from scope c
  cross join generate_series((c.today-120)::timestamp,(c.today-1)::timestamp,interval '1 day') d
  cross join feedbackgb.v_stores s),
latest as (select r.business_date,r.spot_id,r.id,row_number() over(partition by r.business_date,r.spot_id
  order by r.completed_at desc,r.id desc) rn from feedbackgb.foodcost_sales_runs r cross join scope c
  where r.status='completed' and r.business_date>=c.today-120 and r.business_date<c.today)
select e.business_date,count(*) expected_spots,count(l.id) completed_spots,count(*)-count(l.id) missing_spots,
  false historical_roster_verified from expected e left join latest l
  on l.business_date=e.business_date and l.spot_id=e.spot_id and l.rn=1 group by e.business_date;
create view feedbackgb.v_foodcost_sales_backfill_health with (security_invoker=true) as
with scope as (select (now() at time zone 'Europe/Kyiv')::date today),
coverage as (select sum(expected_spots) expected_cells,sum(completed_spots) completed_cells,sum(missing_spots) missing_cells
  from feedbackgb.v_foodcost_sales_backfill_coverage), queue as (
  select count(*) filter(where j.status='pending') pending_jobs,count(*) filter(where j.status='running') running_jobs,
    count(*) filter(where j.status='retryable_failed') retryable_jobs,count(*) filter(where j.status='failed') failed_jobs
  from scope s left join feedbackgb.foodcost_sales_backfill_jobs j
  on j.business_date>=s.today-120 and j.business_date<s.today and j.spot_id in(select id from feedbackgb.v_stores)
)
select s.today-120 as date_from,s.today-1 as date_to,
  (select count(*) from feedbackgb.v_stores) as spot_count,
  c.expected_cells,c.completed_cells,c.missing_cells,
  q.pending_jobs,q.running_jobs,q.retryable_jobs,q.failed_jobs,false as historical_roster_verified
from scope s cross join coverage c cross join queue q;

revoke all on function feedbackgb.log_foodcost_sales_backfill_event() from public,anon,authenticated,service_role;
revoke all on function feedbackgb.seed_foodcost_sales_backfill_jobs(bigint[],timestamptz) from public,anon,authenticated;
revoke all on function feedbackgb.claim_foodcost_sales_backfill_job(uuid,bigint[]) from public,anon,authenticated;
revoke all on function feedbackgb.complete_foodcost_sales_backfill_job(date,bigint,uuid,uuid,text) from public,anon,authenticated;
revoke all on function feedbackgb.fail_foodcost_sales_backfill_job(date,bigint,uuid,text) from public,anon,authenticated;
grant execute on function feedbackgb.seed_foodcost_sales_backfill_jobs(bigint[],timestamptz) to service_role;
grant execute on function feedbackgb.claim_foodcost_sales_backfill_job(uuid,bigint[]) to service_role;
grant execute on function feedbackgb.complete_foodcost_sales_backfill_job(date,bigint,uuid,uuid,text) to service_role;
grant execute on function feedbackgb.fail_foodcost_sales_backfill_job(date,bigint,uuid,text) to service_role;
revoke all on feedbackgb.v_foodcost_sales_backfill_coverage from public,anon,authenticated;
revoke all on feedbackgb.v_foodcost_sales_backfill_health from public,anon,authenticated;
grant select on feedbackgb.v_foodcost_sales_backfill_coverage,feedbackgb.v_foodcost_sales_backfill_health to service_role;

notify pgrst, 'reload schema';
commit;
