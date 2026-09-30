-- Manual STAGING rollback only before activation/use. Stop all year workers first.
-- Refuses loss of observations; never deletes queue/audit/facts/old policies elsewhere.
begin;
set local lock_timeout = '5s';
lock table feedbackgb.analytics_source_policies in access exclusive mode;
lock table feedbackgb.analytics_spot_observations in access exclusive mode;
do $$ begin
  if exists(select 1 from feedbackgb.analytics_source_policies where enabled)
    or exists(select 1 from feedbackgb.analytics_spot_observations) then
    raise exception 'analytics_year_rollback_refused_after_activation_or_observation';
  end if;
end $$;
drop view feedbackgb.v_analytics_year_sales_health;
drop view feedbackgb.v_analytics_year_sales_coverage;
drop function feedbackgb.claim_analytics_year_sales_job(uuid,bigint[]);
drop function feedbackgb.seed_analytics_year_sales_jobs(bigint[],timestamptz);
drop table feedbackgb.analytics_spot_observations;
drop table feedbackgb.analytics_source_policies;
notify pgrst, 'reload schema';
commit;
