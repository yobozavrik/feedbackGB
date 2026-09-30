-- Production-only receipt cron coordination. This migration does not start the cron.
-- It prevents concurrent Poster downloads for the same account/day and records a
-- small operational journal without storing receipt or customer payloads.
begin;

create table feedbackgb.poster_receipt_cron_days (
  account_id text not null check (account_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  business_date date not null check (business_date >= date '2026-01-01'),
  status text not null check (status in ('running', 'retryable_failed', 'verified')),
  owner_token uuid not null,
  attempt_no integer not null default 1 check (attempt_no between 1 and 1000000),
  lease_expires_at timestamptz not null,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  run_id uuid references feedbackgb.poster_receipt_import_runs(id),
  receipt_count bigint check (receipt_count >= 0),
  line_count bigint check (line_count >= 0),
  client_count bigint check (client_count >= 0),
  error_code text check (error_code ~ '^receipt_[a-z_]{1,72}$'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (account_id, business_date),
  check (
    (status = 'running' and finished_at is null and run_id is null)
    or
    (status = 'retryable_failed' and finished_at is not null and run_id is null
      and error_code is not null)
    or
    (status = 'verified' and finished_at is not null and run_id is not null
      and receipt_count is not null and line_count is not null and client_count is not null
      and error_code is null)
  )
);

create index poster_receipt_cron_days_status_lease_idx
  on feedbackgb.poster_receipt_cron_days(status, lease_expires_at);

alter table feedbackgb.poster_receipt_cron_days enable row level security;
revoke all on table feedbackgb.poster_receipt_cron_days
  from public, anon, authenticated, service_role;

create function feedbackgb.claim_poster_receipt_cron_day(
  p_account_id text,
  p_day date,
  p_owner_token uuid,
  p_lease_seconds integer default 360
) returns jsonb
language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_attempt integer;
  v_existing_run uuid;
  v_run_count integer;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
    or p_day is null or p_day < date '2026-01-01'
    or p_day >= (clock_timestamp() at time zone 'Europe/Kyiv')::date
    or p_owner_token is null
    or p_lease_seconds not between 60 and 600 then
    raise exception 'receipt_cron_claim_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('poster-receipt-cron:' || p_account_id || ':' || p_day::text, 0)
  );

  select count(*) into v_run_count
  from feedbackgb.poster_receipt_import_runs
  where account_id = p_account_id and date_from = p_day and date_to = p_day
    and status = 'accepted';

  if v_run_count > 1 then
    raise exception 'receipt_cron_run_ambiguous';
  end if;

  if v_run_count = 1 then
    select id into strict v_existing_run
    from feedbackgb.poster_receipt_import_runs
    where account_id = p_account_id and date_from = p_day and date_to = p_day
      and status = 'accepted';
    return jsonb_build_object(
      'status', 'already_verified', 'day', p_day, 'run_id', v_existing_run
    );
  end if;

  insert into feedbackgb.poster_receipt_cron_days(
    account_id, business_date, status, owner_token, attempt_no,
    lease_expires_at, started_at, finished_at, run_id,
    receipt_count, line_count, client_count, error_code, updated_at
  ) values (
    p_account_id, p_day, 'running', p_owner_token, 1,
    clock_timestamp() + make_interval(secs => p_lease_seconds),
    clock_timestamp(), null, null, null, null, null, null, clock_timestamp()
  )
  on conflict (account_id, business_date) do update set
    status = 'running',
    owner_token = excluded.owner_token,
    attempt_no = feedbackgb.poster_receipt_cron_days.attempt_no + 1,
    lease_expires_at = excluded.lease_expires_at,
    started_at = excluded.started_at,
    finished_at = null,
    run_id = null,
    receipt_count = null,
    line_count = null,
    client_count = null,
    error_code = null,
    updated_at = clock_timestamp()
  where feedbackgb.poster_receipt_cron_days.status <> 'running'
     or feedbackgb.poster_receipt_cron_days.lease_expires_at <= clock_timestamp()
  returning attempt_no into v_attempt;

  if v_attempt is null then
    return jsonb_build_object('status', 'in_progress', 'day', p_day);
  end if;

  return jsonb_build_object(
    'status', 'claimed', 'day', p_day, 'attempt_no', v_attempt,
    'lease_seconds', p_lease_seconds
  );
end;
$$;

create function feedbackgb.complete_poster_receipt_cron_day(
  p_account_id text,
  p_day date,
  p_owner_token uuid,
  p_run_id uuid,
  p_receipt_count bigint,
  p_line_count bigint,
  p_client_count bigint
) returns boolean
language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_updated integer;
  v_run_count integer;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
    or p_day is null or p_owner_token is null or p_run_id is null
    or p_receipt_count is null or p_receipt_count < 0
    or p_line_count is null or p_line_count < 0
    or p_client_count is null or p_client_count < 0 then
    raise exception 'receipt_cron_complete_invalid';
  end if;

  select count(*) into v_run_count
  from feedbackgb.poster_receipt_import_runs
  where account_id = p_account_id and date_from = p_day and date_to = p_day
    and status = 'accepted';

  if v_run_count <> 1 or not exists (
    select 1 from feedbackgb.poster_receipt_import_runs
    where id = p_run_id and account_id = p_account_id
      and date_from = p_day and date_to = p_day and status = 'accepted'
      and source_count = p_receipt_count
  ) then
    raise exception 'receipt_cron_run_invalid';
  end if;

  update feedbackgb.poster_receipt_cron_days set
    status = 'verified',
    finished_at = clock_timestamp(),
    run_id = p_run_id,
    receipt_count = p_receipt_count,
    line_count = p_line_count,
    client_count = p_client_count,
    error_code = null,
    lease_expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where account_id = p_account_id and business_date = p_day
    and status = 'running' and owner_token = p_owner_token;
  get diagnostics v_updated = row_count;

  if v_updated = 1 then return true; end if;

  return exists (
    select 1 from feedbackgb.poster_receipt_cron_days
    where account_id = p_account_id and business_date = p_day
      and status = 'verified' and run_id = p_run_id
      and receipt_count = p_receipt_count and line_count = p_line_count
      and client_count = p_client_count
  );
end;
$$;

create function feedbackgb.fail_poster_receipt_cron_day(
  p_account_id text,
  p_day date,
  p_owner_token uuid,
  p_error_code text
) returns boolean
language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_.:-]{1,128}$'
    or p_day is null or p_owner_token is null
    or p_error_code is null or p_error_code !~ '^receipt_[a-z_]{1,72}$' then
    raise exception 'receipt_cron_fail_invalid';
  end if;

  update feedbackgb.poster_receipt_cron_days set
    status = 'retryable_failed',
    finished_at = clock_timestamp(),
    run_id = null,
    receipt_count = null,
    line_count = null,
    client_count = null,
    error_code = p_error_code,
    lease_expires_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where account_id = p_account_id and business_date = p_day
    and status = 'running' and owner_token = p_owner_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function feedbackgb.claim_poster_receipt_cron_day(text, date, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function feedbackgb.complete_poster_receipt_cron_day(text, date, uuid, uuid, bigint, bigint, bigint)
  from public, anon, authenticated, service_role;
revoke all on function feedbackgb.fail_poster_receipt_cron_day(text, date, uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function feedbackgb.claim_poster_receipt_cron_day(text, date, uuid, integer)
  to service_role;
grant execute on function feedbackgb.complete_poster_receipt_cron_day(text, date, uuid, uuid, bigint, bigint, bigint)
  to service_role;
grant execute on function feedbackgb.fail_poster_receipt_cron_day(text, date, uuid, text)
  to service_role;

commit;
