-- 032_store_schedule_month_grid.sql
--
-- Read model for the store-oriented schedule grid statistics. This migration
-- does not alter planned shifts or infer actual attendance.

begin;

create or replace view feedbackgb.v_store_schedule_store_month as
select
  period_id,
  period_start,
  period_end,
  period_status,
  store_id,
  store_name,
  count(*) filter (where shift_status = 'scheduled')::integer as scheduled_shift_count,
  count(*) filter (where shift_status = 'cancelled')::integer as cancelled_shift_count,
  count(*) filter (where shift_status = 'scheduled' and is_replacement)::integer as replacement_shift_count,
  count(distinct employee_id) filter (where shift_status = 'scheduled')::integer as scheduled_employee_count,
  coalesce(sum(planned_minutes) filter (where shift_status = 'scheduled'), 0)::integer as planned_minutes
from feedbackgb.v_store_schedule_calendar
group by period_id, period_start, period_end, period_status, store_id, store_name;

revoke all on table feedbackgb.v_store_schedule_store_month from public, anon, authenticated;
grant select on table feedbackgb.v_store_schedule_store_month to service_role;

comment on view feedbackgb.v_store_schedule_store_month is
  'Monthly planned-shift aggregate by store. It excludes cancelled shifts from planned hours and is not an attendance or payroll fact.';

commit;

-- Rollback before dependants exist:
-- drop view if exists feedbackgb.v_store_schedule_store_month;

-- Required readback after applying:
-- select grantee, privilege_type
-- from information_schema.role_table_grants
-- where table_schema = 'feedbackgb'
--   and table_name = 'v_store_schedule_store_month'
-- order by grantee, privilege_type;
--
-- select period_start, store_id, scheduled_shift_count, cancelled_shift_count,
--        replacement_shift_count, scheduled_employee_count, planned_minutes
-- from feedbackgb.v_store_schedule_store_month
-- where period_start = date '2026-09-01'
-- order by store_id;
