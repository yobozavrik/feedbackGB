-- 031_store_work_schedules.sql
--
-- Store employee schedules. This migration is forward-only. Apply to staging
-- first and run every readback query at the end before production approval.
--
-- Scope: plan of seller shifts for stores only. It does NOT calculate payroll,
-- does NOT treat photo reports as attendance, and does NOT import Google Sheets.

begin;

create extension if not exists btree_gist with schema extensions;

create table if not exists feedbackgb.work_schedule_periods (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'store' check (scope = 'store'),
  period_start date not null,
  period_end date not null,
  timezone text not null default 'Europe/Kyiv' check (timezone = 'Europe/Kyiv'),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'locked', 'archived')),
  published_at timestamptz,
  published_by uuid references feedbackgb.users(id) on delete restrict,
  locked_at timestamptz,
  locked_by uuid references feedbackgb.users(id) on delete restrict,
  lock_reason text,
  row_version integer not null default 1 check (row_version >= 1),
  created_by uuid not null references feedbackgb.users(id) on delete restrict,
  updated_by uuid not null references feedbackgb.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_start = date_trunc('month', period_start)::date),
  check (period_end = (period_start + interval '1 month - 1 day')::date),
  check (
    (status in ('published', 'locked', 'archived')) = (published_at is not null and published_by is not null)
  ),
  check (
    (status in ('locked', 'archived')) = (locked_at is not null and locked_by is not null and lock_reason is not null)
  ),
  check (lock_reason is null or length(trim(lock_reason)) between 3 and 500)
);

create unique index if not exists work_schedule_periods_one_scope_month_idx
  on feedbackgb.work_schedule_periods (scope, period_start);

create table if not exists feedbackgb.store_work_shifts (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references feedbackgb.work_schedule_periods(id) on delete restrict,
  employee_id uuid not null references feedbackgb.users(id) on delete restrict,
  store_id integer not null references categories.spots(spot_id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes smallint not null default 0 check (break_minutes between 0 and 480),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  is_replacement boolean not null default false,
  replacement_permission_id uuid references feedbackgb.seller_store_permissions(id) on delete restrict,
  change_reason text,
  row_version integer not null default 1 check (row_version >= 1),
  created_by uuid not null references feedbackgb.users(id) on delete restrict,
  updated_by uuid not null references feedbackgb.users(id) on delete restrict,
  cancelled_by uuid references feedbackgb.users(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (break_minutes < extract(epoch from (ends_at - starts_at)) / 60),
  check (
    (is_replacement = false and replacement_permission_id is null)
    or (is_replacement = true and replacement_permission_id is not null)
  ),
  check (
    (status = 'scheduled' and cancelled_at is null and cancelled_by is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null and change_reason is not null)
  ),
  check (change_reason is null or length(trim(change_reason)) between 3 and 500)
);

alter table feedbackgb.store_work_shifts
  add constraint store_work_shifts_employee_time_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled');

create index if not exists store_work_shifts_period_store_starts_idx
  on feedbackgb.store_work_shifts (period_id, store_id, starts_at);

create index if not exists store_work_shifts_employee_starts_idx
  on feedbackgb.store_work_shifts (employee_id, starts_at);

create index if not exists store_work_shifts_active_store_starts_idx
  on feedbackgb.store_work_shifts (store_id, starts_at)
  where status = 'scheduled';

create table if not exists feedbackgb.store_work_shift_events (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references feedbackgb.store_work_shifts(id) on delete restrict,
  event_type text not null check (event_type in ('created', 'updated', 'cancelled')),
  actor_user_id uuid references feedbackgb.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  before_state jsonb,
  after_state jsonb,
  reason text,
  request_id uuid,
  check (reason is null or length(trim(reason)) between 3 and 500)
);

create index if not exists store_work_shift_events_shift_occurred_idx
  on feedbackgb.store_work_shift_events (shift_id, occurred_at desc);

create table if not exists feedbackgb.work_schedule_import_runs (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references feedbackgb.work_schedule_periods(id) on delete restrict,
  source_kind text not null check (source_kind in ('google_sheets', 'manual_file')),
  source_document_id text not null check (length(trim(source_document_id)) between 1 and 200),
  source_sheet_name text not null check (length(trim(source_sheet_name)) between 1 and 200),
  source_revision text,
  source_hash text not null check (length(trim(source_hash)) between 16 and 128),
  status text not null default 'started'
    check (status in ('started', 'validated', 'applied', 'failed', 'rolled_back')),
  rows_seen integer not null default 0 check (rows_seen >= 0),
  rows_created integer not null default 0 check (rows_created >= 0),
  rows_skipped integer not null default 0 check (rows_skipped >= 0),
  rows_failed integer not null default 0 check (rows_failed >= 0),
  failure_summary text,
  started_by uuid not null references feedbackgb.users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  request_id uuid,
  check (failure_summary is null or length(trim(failure_summary)) between 1 and 2000)
);

create unique index if not exists work_schedule_import_runs_period_hash_idx
  on feedbackgb.work_schedule_import_runs (period_id, source_hash);

create index if not exists work_schedule_import_runs_period_started_idx
  on feedbackgb.work_schedule_import_runs (period_id, started_at desc);

create table if not exists feedbackgb.work_schedule_import_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references feedbackgb.work_schedule_import_runs(id) on delete restrict,
  source_row_key text not null check (length(trim(source_row_key)) between 1 and 200),
  raw_payload jsonb not null,
  resolved_employee_id uuid references feedbackgb.users(id) on delete set null,
  resolved_store_id integer references categories.spots(spot_id) on delete set null,
  created_shift_id uuid references feedbackgb.store_work_shifts(id) on delete set null,
  result text not null check (result in ('ready', 'created', 'skipped', 'failed')),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  unique (run_id, source_row_key),
  check (
    (result = 'created' and created_shift_id is not null)
    or (result <> 'created' and created_shift_id is null)
  )
);

create index if not exists work_schedule_import_rows_run_result_idx
  on feedbackgb.work_schedule_import_rows (run_id, result);

create or replace function feedbackgb.set_work_schedule_updated_at()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
begin
  new.updated_at = now();
  new.row_version = old.row_version + 1;
  return new;
end;
$$;

create or replace function feedbackgb.validate_store_work_shift()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, categories, pg_catalog
as $$
declare
  v_period feedbackgb.work_schedule_periods;
  v_employee feedbackgb.users;
  v_permission feedbackgb.seller_store_permissions;
  v_local_start date;
  v_local_end date;
  v_assignment_changed boolean;
begin
  select * into v_period
  from feedbackgb.work_schedule_periods
  where id = new.period_id;

  if not found then
    raise exception 'work schedule period % does not exist', new.period_id;
  end if;

  if v_period.scope <> 'store' then
    raise exception 'store_work_shifts requires a store scope period';
  end if;

  if v_period.status in ('locked', 'archived') then
    raise exception 'work schedule period % is locked', new.period_id;
  end if;

  v_local_start := (new.starts_at at time zone v_period.timezone)::date;
  v_local_end := ((new.ends_at - interval '1 microsecond') at time zone v_period.timezone)::date;
  if v_local_start < v_period.period_start or v_local_end > v_period.period_end then
    raise exception 'shift must fall inside its schedule period in %', v_period.timezone;
  end if;

  select * into v_employee
  from feedbackgb.users
  where id = new.employee_id;

  if not found or not v_employee.is_active or v_employee.role <> 'seller' then
    raise exception 'store work shift employee must be an active seller';
  end if;

  v_assignment_changed := tg_op = 'INSERT'
    or new.employee_id is distinct from old.employee_id
    or new.store_id is distinct from old.store_id
    or new.is_replacement is distinct from old.is_replacement
    or new.replacement_permission_id is distinct from old.replacement_permission_id;

  if new.is_replacement then
    if v_assignment_changed then
      select * into v_permission
      from feedbackgb.seller_store_permissions
      where id = new.replacement_permission_id
        and seller_id = new.employee_id
        and store_id = new.store_id
        and revoked_at is null;

      if not found then
        raise exception 'active replacement-store permission is required';
      end if;
    end if;
  elsif v_employee.store_id is distinct from new.store_id then
    raise exception 'regular shift must use the employee home store';
  end if;

  if tg_op = 'UPDATE' and old.status = 'scheduled' and new.status = 'cancelled' and new.change_reason is null then
    raise exception 'cancelling a shift requires a reason';
  end if;

  return new;
end;
$$;

create or replace function feedbackgb.append_store_work_shift_event()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
declare
begin
  if tg_op = 'INSERT' then
    insert into feedbackgb.store_work_shift_events (
      shift_id, event_type, actor_user_id, before_state, after_state, reason, request_id
    ) values (
      new.id, 'created', new.created_by, null, to_jsonb(new), new.change_reason, null
    );
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    insert into feedbackgb.store_work_shift_events (
      shift_id, event_type, actor_user_id, before_state, after_state, reason, request_id
    ) values (
      new.id, 'cancelled', new.cancelled_by, to_jsonb(old), to_jsonb(new), new.change_reason, null
    );
  else
    insert into feedbackgb.store_work_shift_events (
      shift_id, event_type, actor_user_id, before_state, after_state, reason, request_id
    ) values (
      new.id, 'updated', new.updated_by, to_jsonb(old), to_jsonb(new), new.change_reason, null
    );
  end if;

  return new;
end;
$$;

create or replace function feedbackgb.prevent_store_work_shift_event_change()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
begin
  raise exception 'store_work_shift_events are append-only';
end;
$$;

drop trigger if exists work_schedule_periods_set_updated_at on feedbackgb.work_schedule_periods;
create trigger work_schedule_periods_set_updated_at
  before update on feedbackgb.work_schedule_periods
  for each row execute function feedbackgb.set_work_schedule_updated_at();

drop trigger if exists store_work_shifts_validate on feedbackgb.store_work_shifts;
create trigger store_work_shifts_validate
  before insert or update on feedbackgb.store_work_shifts
  for each row execute function feedbackgb.validate_store_work_shift();

drop trigger if exists store_work_shifts_set_updated_at on feedbackgb.store_work_shifts;
create trigger store_work_shifts_set_updated_at
  before update on feedbackgb.store_work_shifts
  for each row execute function feedbackgb.set_work_schedule_updated_at();

drop trigger if exists store_work_shifts_append_event on feedbackgb.store_work_shifts;
create trigger store_work_shifts_append_event
  after insert or update on feedbackgb.store_work_shifts
  for each row execute function feedbackgb.append_store_work_shift_event();

drop trigger if exists store_work_shift_events_append_only on feedbackgb.store_work_shift_events;
create trigger store_work_shift_events_append_only
  before update or delete on feedbackgb.store_work_shift_events
  for each row execute function feedbackgb.prevent_store_work_shift_event_change();

create or replace view feedbackgb.v_store_schedule_calendar as
select
  p.id as period_id,
  p.period_start,
  p.period_end,
  p.timezone,
  p.status as period_status,
  (s.starts_at at time zone p.timezone)::date as local_date,
  s.id as shift_id,
  s.store_id,
  stores.name as store_name,
  s.employee_id,
  u.full_name as employee_full_name,
  u.display_label as employee_display_label,
  u.role as employee_role,
  u.store_id as employee_home_store_id,
  s.starts_at,
  s.ends_at,
  s.break_minutes,
  greatest(0, floor(extract(epoch from (s.ends_at - s.starts_at)) / 60)::integer - s.break_minutes) as planned_minutes,
  s.status as shift_status,
  s.is_replacement,
  s.replacement_permission_id,
  s.change_reason,
  s.row_version,
  s.created_at,
  s.updated_at
from feedbackgb.store_work_shifts s
join feedbackgb.work_schedule_periods p on p.id = s.period_id
join feedbackgb.users u on u.id = s.employee_id
join feedbackgb.v_stores stores on stores.id = s.store_id;

create or replace view feedbackgb.v_store_schedule_employee_month as
select
  period_id,
  period_start,
  period_end,
  period_status,
  employee_id,
  employee_full_name,
  employee_display_label,
  employee_home_store_id,
  count(*) filter (where shift_status = 'scheduled') as scheduled_shift_count,
  count(*) filter (where shift_status = 'cancelled') as cancelled_shift_count,
  count(*) filter (where shift_status = 'scheduled' and is_replacement) as replacement_shift_count,
  coalesce(sum(planned_minutes) filter (where shift_status = 'scheduled'), 0)::integer as planned_minutes
from feedbackgb.v_store_schedule_calendar
group by period_id, period_start, period_end, period_status,
  employee_id, employee_full_name, employee_display_label, employee_home_store_id;

create or replace view feedbackgb.v_store_schedule_issues as
select
  s.id as shift_id,
  s.period_id,
  'inactive_or_wrong_role_employee'::text as issue_code,
  'Shift employee is not an active seller'::text as issue_message,
  s.employee_id,
  s.store_id,
  s.starts_at,
  s.ends_at
from feedbackgb.store_work_shifts s
join feedbackgb.users u on u.id = s.employee_id
where s.status = 'scheduled'
  and (u.is_active = false or u.role <> 'seller')
union all
select
  s.id,
  s.period_id,
  'replacement_permission_not_active'::text,
  'Replacement shift permission is no longer active'::text,
  s.employee_id,
  s.store_id,
  s.starts_at,
  s.ends_at
from feedbackgb.store_work_shifts s
left join feedbackgb.seller_store_permissions p on p.id = s.replacement_permission_id
where s.status = 'scheduled'
  and s.is_replacement = true
  and (p.id is null or p.revoked_at is not null or p.seller_id <> s.employee_id or p.store_id <> s.store_id);

create or replace view feedbackgb.v_store_schedule_payroll_source as
select
  s.id as shift_id,
  s.period_id,
  s.employee_id,
  s.store_id,
  s.starts_at,
  s.ends_at,
  null::integer as actual_minutes,
  false as payroll_ready,
  'Actual attendance is not implemented. Planned shifts must not be used for payroll.'::text as status_reason
from feedbackgb.store_work_shifts s
where false;

alter table feedbackgb.work_schedule_periods enable row level security;
alter table feedbackgb.store_work_shifts enable row level security;
alter table feedbackgb.store_work_shift_events enable row level security;
alter table feedbackgb.work_schedule_import_runs enable row level security;
alter table feedbackgb.work_schedule_import_rows enable row level security;

revoke all on table feedbackgb.work_schedule_periods from public, anon, authenticated;
revoke all on table feedbackgb.store_work_shifts from public, anon, authenticated;
revoke all on table feedbackgb.store_work_shift_events from public, anon, authenticated;
revoke all on table feedbackgb.work_schedule_import_runs from public, anon, authenticated;
revoke all on table feedbackgb.work_schedule_import_rows from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_calendar from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_employee_month from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_issues from public, anon, authenticated;
revoke all on table feedbackgb.v_store_schedule_payroll_source from public, anon, authenticated;

grant select, insert, update, delete on table feedbackgb.work_schedule_periods to service_role;
grant select, insert, update, delete on table feedbackgb.store_work_shifts to service_role;
grant select, insert on table feedbackgb.store_work_shift_events to service_role;
grant select, insert, update, delete on table feedbackgb.work_schedule_import_runs to service_role;
grant select, insert, update, delete on table feedbackgb.work_schedule_import_rows to service_role;
grant select on table feedbackgb.v_store_schedule_calendar to service_role;
grant select on table feedbackgb.v_store_schedule_employee_month to service_role;
grant select on table feedbackgb.v_store_schedule_issues to service_role;
grant select on table feedbackgb.v_store_schedule_payroll_source to service_role;

revoke all on function feedbackgb.set_work_schedule_updated_at() from public, anon, authenticated;
revoke all on function feedbackgb.validate_store_work_shift() from public, anon, authenticated;
revoke all on function feedbackgb.append_store_work_shift_event() from public, anon, authenticated;
revoke all on function feedbackgb.prevent_store_work_shift_event_change() from public, anon, authenticated;
grant execute on function feedbackgb.set_work_schedule_updated_at() to service_role;
grant execute on function feedbackgb.validate_store_work_shift() to service_role;
grant execute on function feedbackgb.append_store_work_shift_event() to service_role;
grant execute on function feedbackgb.prevent_store_work_shift_event_change() to service_role;

comment on table feedbackgb.work_schedule_periods is
  'Monthly store schedule periods. A locked period must not be modified and may later supply payroll only after actual attendance exists.';
comment on table feedbackgb.store_work_shifts is
  'Planned seller shift at a store. It is not proof of attendance and must not be used as payroll fact.';
comment on column feedbackgb.store_work_shifts.replacement_permission_id is
  'Permission checked when a replacement shift is assigned. Later permission revocation does not rewrite historical shifts.';
comment on table feedbackgb.store_work_shift_events is
  'Append-only history of store work-shift changes.';

commit;

-- Required staging readback after applying:
--
-- select c.relname, c.relrowsecurity
-- from pg_class c
-- join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'feedbackgb'
--   and c.relname in (
--     'work_schedule_periods', 'store_work_shifts', 'store_work_shift_events',
--     'work_schedule_import_runs', 'work_schedule_import_rows'
--   )
-- order by c.relname;
--
-- select conname, contype, convalidated
-- from pg_constraint
-- where conrelid in (
--   'feedbackgb.work_schedule_periods'::regclass,
--   'feedbackgb.store_work_shifts'::regclass,
--   'feedbackgb.store_work_shift_events'::regclass
-- )
-- order by conname;
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'feedbackgb'
--   and tablename in ('work_schedule_periods', 'store_work_shifts', 'store_work_shift_events')
-- order by tablename, indexname;
