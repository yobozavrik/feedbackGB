-- 038_foodcost_sales_sync_leases.sql
-- Forward-only concurrency guard for the versioned Poster sales sync.
-- Apply in staging and read back before any scheduler is enabled.
-- Objects are only in feedbackgb; no public objects or grants.

begin;

create table feedbackgb.foodcost_sales_sync_leases (
  business_date date not null,
  spot_id bigint not null check (spot_id > 0),
  owner_token uuid not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default clock_timestamp(),
  primary key (business_date, spot_id)
);

alter table feedbackgb.foodcost_sales_sync_leases enable row level security;
revoke all on table feedbackgb.foodcost_sales_sync_leases from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.foodcost_sales_sync_leases to service_role;

create table feedbackgb.foodcost_sales_batch_lease (
  id integer primary key default 1 check (id = 1),
  owner_token uuid not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default clock_timestamp()
);

alter table feedbackgb.foodcost_sales_batch_lease enable row level security;
revoke all on table feedbackgb.foodcost_sales_batch_lease from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.foodcost_sales_batch_lease to service_role;

create function feedbackgb.acquire_foodcost_sales_batch_lease(
  p_owner_token uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_acquired boolean;
begin
  if p_owner_token is null or p_ttl_seconds is null
    or p_ttl_seconds < 60 or p_ttl_seconds > 900 then
    raise exception 'invalid_foodcost_batch_lease_scope';
  end if;
  insert into feedbackgb.foodcost_sales_batch_lease as lease
    (id, owner_token, expires_at)
  values (1, p_owner_token, clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do update
    set owner_token = excluded.owner_token,
        expires_at = excluded.expires_at,
        acquired_at = clock_timestamp()
    where lease.expires_at <= clock_timestamp()
      or lease.owner_token = excluded.owner_token
  returning true into v_acquired;
  return coalesce(v_acquired, false);
end;
$$;

create function feedbackgb.release_foodcost_sales_batch_lease(p_owner_token uuid)
returns void
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
begin
  delete from feedbackgb.foodcost_sales_batch_lease
  where id = 1 and owner_token = p_owner_token;
end;
$$;

create function feedbackgb.acquire_foodcost_sales_sync_lease(
  p_business_date date,
  p_spot_id bigint,
  p_owner_token uuid,
  p_ttl_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_acquired boolean;
begin
  if p_business_date is null or p_spot_id is null or p_spot_id <= 0
    or p_owner_token is null or p_ttl_seconds is null
    or p_ttl_seconds < 60 or p_ttl_seconds > 900 then
    raise exception 'invalid_foodcost_lease_scope';
  end if;

  insert into feedbackgb.foodcost_sales_sync_leases as lease
    (business_date, spot_id, owner_token, expires_at)
  values (p_business_date, p_spot_id, p_owner_token,
    clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (business_date, spot_id) do update
    set owner_token = excluded.owner_token,
        expires_at = excluded.expires_at,
        acquired_at = clock_timestamp()
    where lease.expires_at <= clock_timestamp()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

create function feedbackgb.release_foodcost_sales_sync_lease(
  p_business_date date,
  p_spot_id bigint,
  p_owner_token uuid
)
returns void
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
begin
  delete from feedbackgb.foodcost_sales_sync_leases
  where business_date = p_business_date and spot_id = p_spot_id
    and owner_token = p_owner_token;
end;
$$;

create function feedbackgb.complete_foodcost_sales_sync_run(
  p_run_id uuid,
  p_owner_token uuid,
  p_source_row_count integer,
  p_payed_sum_minor bigint,
  p_product_profit_minor bigint,
  p_product_profit_netto_minor bigint,
  p_source_fetched_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_run feedbackgb.foodcost_sales_runs%rowtype;
  v_lease feedbackgb.foodcost_sales_sync_leases%rowtype;
  v_count bigint;
  v_paid numeric;
  v_profit numeric;
  v_netto numeric;
  v_first_row integer;
  v_last_row integer;
begin
  if p_run_id is null or p_owner_token is null or p_source_row_count is null
    or p_source_row_count < 0 or p_payed_sum_minor is null
    or p_product_profit_minor is null or p_source_fetched_at is null then
    raise exception 'invalid_foodcost_completion';
  end if;

  select * into v_run from feedbackgb.foodcost_sales_runs
  where id = p_run_id and status = 'running' for update;
  if not found then raise exception 'foodcost_run_not_running'; end if;

  select * into v_lease from feedbackgb.foodcost_sales_sync_leases
  where business_date = v_run.business_date and spot_id = v_run.spot_id for update;
  if not found or v_lease.owner_token <> p_owner_token
    or v_lease.expires_at <= clock_timestamp() then
    raise exception 'foodcost_lease_lost';
  end if;

  select count(*), coalesce(sum(payed_sum_minor), 0),
    coalesce(sum(product_profit_minor), 0),
    case when count(*) filter (where product_profit_netto_minor is null) = 0
      then coalesce(sum(product_profit_netto_minor), 0) else null end,
    min(source_row_no), max(source_row_no)
  into v_count, v_paid, v_profit, v_netto, v_first_row, v_last_row
  from feedbackgb.foodcost_sales_facts where run_id = p_run_id;

  if v_count <> p_source_row_count or v_paid <> p_payed_sum_minor
    or v_profit <> p_product_profit_minor
    or v_netto is distinct from p_product_profit_netto_minor
    or (v_count > 0 and (v_first_row <> 0 or v_last_row <> v_count - 1)) then
    raise exception 'foodcost_fact_totals_mismatch';
  end if;

  update feedbackgb.foodcost_sales_runs
  set status = 'completed', source_row_count = p_source_row_count,
      payed_sum_minor = p_payed_sum_minor,
      product_profit_minor = p_product_profit_minor,
      product_profit_netto_minor = p_product_profit_netto_minor,
      source_fetched_at = p_source_fetched_at,
      completed_at = clock_timestamp()
  where id = p_run_id and status = 'running';

  delete from feedbackgb.foodcost_sales_sync_leases
  where business_date = v_run.business_date and spot_id = v_run.spot_id
    and owner_token = p_owner_token;
  return p_run_id;
end;
$$;

revoke all on function feedbackgb.acquire_foodcost_sales_sync_lease(date, bigint, uuid, integer)
  from public, anon, authenticated;
revoke all on function feedbackgb.acquire_foodcost_sales_batch_lease(uuid, integer)
  from public, anon, authenticated;
revoke all on function feedbackgb.release_foodcost_sales_batch_lease(uuid)
  from public, anon, authenticated;
revoke all on function feedbackgb.release_foodcost_sales_sync_lease(date, bigint, uuid)
  from public, anon, authenticated;
revoke all on function feedbackgb.complete_foodcost_sales_sync_run(uuid, uuid, integer, bigint, bigint, bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function feedbackgb.acquire_foodcost_sales_sync_lease(date, bigint, uuid, integer)
  to service_role;
grant execute on function feedbackgb.acquire_foodcost_sales_batch_lease(uuid, integer)
  to service_role;
grant execute on function feedbackgb.release_foodcost_sales_batch_lease(uuid)
  to service_role;
grant execute on function feedbackgb.release_foodcost_sales_sync_lease(date, bigint, uuid)
  to service_role;
grant execute on function feedbackgb.complete_foodcost_sales_sync_run(uuid, uuid, integer, bigint, bigint, bigint, timestamptz)
  to service_role;

commit;
