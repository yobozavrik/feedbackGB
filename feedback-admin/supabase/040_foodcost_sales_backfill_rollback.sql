-- Manual rollback only. First disable/remove the nightly sales cron and confirm it cannot run.
-- This script intentionally refuses rollback if any queue, attempt, or event history exists.
-- Never remove or alter the pre-existing 037/038 foodcost objects or sales history.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('feedbackgb.foodcost_sales_backfill_jobs') is null then
    raise exception 'backfill_queue_missing_nothing_to_rollback';
  end if;
  -- Block any in-flight worker/claim before checking the empty-queue invariant.
  lock table feedbackgb.foodcost_sales_backfill_jobs in access exclusive mode;
  lock table feedbackgb.foodcost_sales_backfill_attempts in access exclusive mode;
  lock table feedbackgb.foodcost_sales_backfill_events in access exclusive mode;
  if exists(select 1 from feedbackgb.foodcost_sales_backfill_jobs)
    or exists(select 1 from feedbackgb.foodcost_sales_backfill_attempts)
    or exists(select 1 from feedbackgb.foodcost_sales_backfill_events) then
    raise exception 'backfill_rollback_refused_queue_or_history_not_empty';
  end if;
end $$;

drop view feedbackgb.v_foodcost_sales_backfill_health;
drop view feedbackgb.v_foodcost_sales_backfill_coverage;
drop function feedbackgb.seed_foodcost_sales_backfill_jobs(bigint[],timestamptz);
drop function feedbackgb.claim_foodcost_sales_backfill_job(uuid,bigint[]);
drop function feedbackgb.complete_foodcost_sales_backfill_job(date,bigint,uuid,uuid,text);
drop function feedbackgb.fail_foodcost_sales_backfill_job(date,bigint,uuid,text);
drop trigger foodcost_sales_backfill_job_event on feedbackgb.foodcost_sales_backfill_jobs;
drop function feedbackgb.log_foodcost_sales_backfill_event();
drop table feedbackgb.foodcost_sales_backfill_events;
drop table feedbackgb.foodcost_sales_backfill_attempts;
drop table feedbackgb.foodcost_sales_backfill_jobs;

notify pgrst, 'reload schema';
commit;
