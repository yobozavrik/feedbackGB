-- Forward-only fix for inherited/default service_role grants observed after 040.
-- No sales data, queue rows, formulas, schema defaults, or other objects are changed.
begin;

do $$
begin
  if to_regclass('feedbackgb.foodcost_sales_backfill_attempts') is null
    or to_regclass('feedbackgb.foodcost_sales_backfill_events') is null
    or to_regclass('feedbackgb.v_foodcost_sales_backfill_coverage') is null
    or to_regclass('feedbackgb.v_foodcost_sales_backfill_health') is null then
    raise exception 'foodcost_backfill_acl_requires_040';
  end if;
end $$;

-- GRANT SELECT alone does not remove CRUD granted by existing default privileges.
-- Journals are written by SECURITY DEFINER RPCs/trigger, never directly by the worker.
revoke all on table
  feedbackgb.foodcost_sales_backfill_attempts,
  feedbackgb.foodcost_sales_backfill_events,
  feedbackgb.v_foodcost_sales_backfill_coverage,
  feedbackgb.v_foodcost_sales_backfill_health
from public, anon, authenticated, service_role;

grant select on table
  feedbackgb.foodcost_sales_backfill_attempts,
  feedbackgb.foodcost_sales_backfill_events,
  feedbackgb.v_foodcost_sales_backfill_coverage,
  feedbackgb.v_foodcost_sales_backfill_health
to service_role;

notify pgrst, 'reload schema';
commit;
