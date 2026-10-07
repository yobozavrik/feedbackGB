-- Read-only checks after the owner applies 058_utility_initial_window.sql.
-- Run each SELECT separately if the SQL editor accepts only one result set.

select
  pg_get_functiondef('feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)'::regprocedure)
    like '%utility_initial_window_not_open%' as submit_rejects_early_first_photo,
  pg_get_functiondef('feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)'::regprocedure)
    like '%v_period.period_start + 27%' as opening_uses_day_28,
  has_function_privilege('service_role',
    'feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE') as service_role_can_submit,
  not has_function_privilege('authenticated',
    'feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE') as authenticated_cannot_submit,
  not has_function_privilege('anon',
    'feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)', 'EXECUTE') as anon_cannot_submit;

select period_start, period_end, due_at, status
from feedbackgb.utility_periods
order by period_start desc limit 12;

with sample_months(month_start) as (
  values (date '2027-02-01'), (date '2028-02-01'),
    (date '2026-04-01'), (date '2026-10-01')
)
select month_start,
  ((month_start + 27)::timestamp at time zone 'Europe/Kyiv') as opens_at_utc,
  (((month_start + 27)::timestamp at time zone 'Europe/Kyiv')
    at time zone 'Europe/Kyiv') as opens_at_kyiv,
  (month_start + interval '1 month - 1 day')::date as last_day
from sample_months order by month_start;
