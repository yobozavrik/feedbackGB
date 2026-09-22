-- 034_store_schedule_photo_report_control.sql
--
-- Immutable operational link between a submitted photo report and a planned
-- seller shift. It is an evidence of a PIN-authenticated report, NOT a time
-- clock and must not be used as a payroll attendance fact.

begin;

create table if not exists feedbackgb.store_work_shift_photo_reports (
  feedback_id uuid primary key references feedbackgb.feedback(id) on delete restrict,
  shift_id uuid references feedbackgb.store_work_shifts(id) on delete restrict,
  seller_id uuid not null references feedbackgb.users(id) on delete restrict,
  report_store_id integer not null references categories.spots(spot_id) on delete restrict,
  submitted_at timestamptz not null,
  local_date date not null,
  match_status text not null check (match_status in ('matched_scheduled_shift', 'no_scheduled_shift')),
  created_at timestamptz not null default now(),
  check ((match_status = 'matched_scheduled_shift') = (shift_id is not null))
);

create index if not exists store_work_shift_photo_reports_shift_submitted_idx
  on feedbackgb.store_work_shift_photo_reports (shift_id, submitted_at)
  where shift_id is not null;
create index if not exists store_work_shift_photo_reports_seller_store_date_idx
  on feedbackgb.store_work_shift_photo_reports (seller_id, report_store_id, local_date desc);
create index if not exists store_work_shift_photo_reports_unmatched_idx
  on feedbackgb.store_work_shift_photo_reports (local_date desc, report_store_id)
  where match_status = 'no_scheduled_shift';

create or replace function feedbackgb.capture_store_work_shift_photo_report()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, categories, pg_catalog
as $$
declare
  v_shift_id uuid;
begin
  if new.category <> 'photo_report' or new.user_id is null or new.store_id is null then
    return new;
  end if;

  select s.id into v_shift_id
  from feedbackgb.store_work_shifts s
  where s.employee_id = new.user_id
    and s.store_id = new.store_id
    and s.status = 'scheduled'
    and tstzrange(s.starts_at, s.ends_at, '[)') @> new.created_at
  limit 1;

  insert into feedbackgb.store_work_shift_photo_reports (
    feedback_id, shift_id, seller_id, report_store_id, submitted_at, local_date, match_status
  ) values (
    new.id, v_shift_id, new.user_id, new.store_id, new.created_at,
    timezone('Europe/Kyiv', new.created_at)::date,
    case when v_shift_id is null then 'no_scheduled_shift' else 'matched_scheduled_shift' end
  ) on conflict (feedback_id) do nothing;

  return new;
end;
$$;

drop trigger if exists feedback_capture_store_work_shift_photo_report on feedbackgb.feedback;
create trigger feedback_capture_store_work_shift_photo_report
  after insert on feedbackgb.feedback
  for each row execute function feedbackgb.capture_store_work_shift_photo_report();

create or replace view feedbackgb.v_store_schedule_shift_photo_report_control as
select
  s.period_id,
  p.period_start,
  p.period_end,
  p.status as period_status,
  s.id as shift_id,
  s.employee_id,
  u.full_name as employee_full_name,
  s.store_id,
  stores.name as store_name,
  s.starts_at,
  s.ends_at,
  s.is_replacement,
  count(r.feedback_id)::integer as matched_photo_report_count,
  min(r.submitted_at) as first_matched_photo_report_at,
  max(r.submitted_at) as last_matched_photo_report_at,
  (count(r.feedback_id) > 0) as has_matched_photo_report
from feedbackgb.store_work_shifts s
join feedbackgb.work_schedule_periods p on p.id = s.period_id
join feedbackgb.users u on u.id = s.employee_id
join feedbackgb.v_stores stores on stores.id = s.store_id
left join feedbackgb.store_work_shift_photo_reports r on r.shift_id = s.id
where s.status = 'scheduled'
group by p.id, p.period_start, p.period_end, p.status, s.id, s.employee_id,
  u.full_name, s.store_id, stores.name, s.starts_at, s.ends_at, s.is_replacement;

create or replace view feedbackgb.v_store_schedule_unmatched_photo_reports as
select
  r.feedback_id,
  r.seller_id,
  u.full_name as seller_full_name,
  r.report_store_id,
  stores.name as store_name,
  r.submitted_at,
  r.local_date
from feedbackgb.store_work_shift_photo_reports r
join feedbackgb.users u on u.id = r.seller_id
join feedbackgb.v_stores stores on stores.id = r.report_store_id
where r.match_status = 'no_scheduled_shift';

alter table feedbackgb.store_work_shift_photo_reports enable row level security;
revoke all on table feedbackgb.store_work_shift_photo_reports from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_shift_photo_report_control from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_unmatched_photo_reports from public, anon, authenticated;
grant select on table feedbackgb.store_work_shift_photo_reports to service_role;
grant select on table feedbackgb.v_store_schedule_shift_photo_report_control to service_role;
grant select on table feedbackgb.v_store_schedule_unmatched_photo_reports to service_role;
revoke all on function feedbackgb.capture_store_work_shift_photo_report() from public, anon, authenticated;
grant execute on function feedbackgb.capture_store_work_shift_photo_report() to service_role;

comment on table feedbackgb.store_work_shift_photo_reports is
  'Immutable link made at photo report submission. It proves a PIN-authenticated report, not attendance or payroll time.';
comment on view feedbackgb.v_store_schedule_shift_photo_report_control is
  'Planned scheduled shifts with count of photo reports submitted during that same planned interval.';

commit;

-- Readback after applying:
-- select c.relname, c.relrowsecurity
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'feedbackgb'
--   and c.relname = 'store_work_shift_photo_reports';
--
-- select * from feedbackgb.v_store_schedule_shift_photo_report_control
-- where period_start = date '2026-09-01'
-- order by starts_at;
--
-- select * from feedbackgb.v_store_schedule_unmatched_photo_reports
-- order by submitted_at desc;
