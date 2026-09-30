-- STAGING ONLY, migration042 must already exist there. Run as database owner.
-- No production acceptance implied. ALL test writes below are rolled back.
-- Never run simultaneously with production workers; do not use the shared working DB as staging.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare v_ids bigint[]; v_seed integer; v_second integer; v_job record;
  v_token uuid:='00000000-0000-4000-8000-000000000042';
begin
  select array_agg(id::bigint order by id) into v_ids from feedbackgb.v_stores;
  if v_ids is null then raise exception 'staging_fixture_roster_required'; end if;
  update feedbackgb.analytics_source_policies set enabled=false,updated_at=clock_timestamp() where source='poster_sales';
  begin
    perform feedbackgb.seed_analytics_year_sales_jobs(v_ids,clock_timestamp());
    raise exception 'expected_disabled_not_raised';
  exception when raise_exception then
    if sqlerrm<>'analytics_year_disabled' then raise; end if;
  end;
  update feedbackgb.analytics_source_policies set enabled=true,updated_at=clock_timestamp() where source='poster_sales';
  begin
    perform feedbackgb.seed_analytics_year_sales_jobs(array[0]::bigint[],clock_timestamp());
    raise exception 'expected_invalid_seed_not_raised';
  exception when raise_exception then
    if sqlerrm<>'invalid_analytics_year_seed' then raise; end if;
  end;
  v_seed:=feedbackgb.seed_analytics_year_sales_jobs(v_ids,clock_timestamp());
  v_second:=feedbackgb.seed_analytics_year_sales_jobs(v_ids,clock_timestamp());
  if v_seed<0 or v_second<>0 then raise exception 'staging_seed_not_idempotent'; end if;
  if exists(select 1 from feedbackgb.analytics_spot_observations where historical_roster_verified) then
    raise exception 'staging_invented_historical_roster';
  end if;
  select * into v_job from feedbackgb.claim_analytics_year_sales_job(v_token,v_ids);
  if not found then raise exception 'staging_pending_job_fixture_required'; end if;
  if v_job.business_date<date '2026-01-01' or v_job.business_date>=(clock_timestamp() at time zone 'Europe/Kyiv')::date
    or v_job.owner_token<>v_token or v_job.attempt_no<1 or v_job.attempt_no>8 then
    raise exception 'staging_invalid_claim';
  end if;
  perform feedbackgb.fail_foodcost_sales_backfill_job(v_job.business_date,v_job.spot_id,v_token,'job_timeout');
  raise notice '042 smoke: disabled,invalid seed,idempotence,claim,legacy failure compatibility passed; seed=%',v_seed;
end $$;
rollback;
-- Additional mandatory two-session tests: simultaneous claims get distinct cells;
-- expired owner cannot complete; attempts/events immutable to service_role;
-- staging-only rollback042 succeeds before activation and refuses after observations.
-- EXPLAIN(ANALYZE,BUFFERS) must be run directly in staging, not inferred from text tests.
