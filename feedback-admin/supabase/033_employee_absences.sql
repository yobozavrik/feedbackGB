-- 033_employee_absences.sql
-- Approved/planned staff absences for store sellers. This is separate from
-- feedback HR requests: a request is not an absence until an admin records it.

begin;

create extension if not exists btree_gist with schema extensions;

create table if not exists feedbackgb.employee_absences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references feedbackgb.users(id) on delete restrict,
  store_id integer references categories.spots(spot_id) on delete restrict,
  absence_type text not null check (absence_type in ('vacation', 'sick_leave', 'day_off')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  note text,
  cancel_reason text,
  row_version integer not null default 1 check (row_version >= 1),
  created_by uuid not null references feedbackgb.users(id) on delete restrict,
  updated_by uuid not null references feedbackgb.users(id) on delete restrict,
  cancelled_by uuid references feedbackgb.users(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on <= ends_on),
  check (note is null or length(trim(note)) between 3 and 500),
  check ((status = 'active' and cancelled_by is null and cancelled_at is null and cancel_reason is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null and cancel_reason is not null)),
  check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 500)
);

alter table feedbackgb.employee_absences
  add constraint employee_absences_no_active_overlap
  exclude using gist (
    employee_id with =,
    daterange(starts_on, ends_on, '[]') with &&
  ) where (status = 'active');

create index if not exists employee_absences_period_idx
  on feedbackgb.employee_absences (starts_on, ends_on) where status = 'active';

create or replace function feedbackgb.validate_employee_absence()
returns trigger language plpgsql security definer
set search_path = feedbackgb, pg_catalog
as $$
declare v_user feedbackgb.users;
begin
  select * into v_user from feedbackgb.users where id = new.employee_id;
  if not found or v_user.role <> 'seller' then
    raise exception 'absence employee must be a seller';
  end if;
  if tg_op = 'INSERT' and new.store_id is null then new.store_id := v_user.store_id; end if;
  return new;
end;
$$;

create or replace function feedbackgb.set_employee_absence_updated_at()
returns trigger language plpgsql security definer
set search_path = feedbackgb, pg_catalog
as $$
begin new.updated_at := now(); new.row_version := old.row_version + 1; return new; end;
$$;

drop trigger if exists employee_absences_validate on feedbackgb.employee_absences;
create trigger employee_absences_validate before insert or update of employee_id on feedbackgb.employee_absences
for each row execute function feedbackgb.validate_employee_absence();
drop trigger if exists employee_absences_updated_at on feedbackgb.employee_absences;
create trigger employee_absences_updated_at before update on feedbackgb.employee_absences
for each row execute function feedbackgb.set_employee_absence_updated_at();

create or replace view feedbackgb.v_employee_absences as
select a.id, a.employee_id, u.full_name as employee_full_name, u.display_label as employee_display_label,
  a.store_id, s.name as store_name, a.absence_type, a.starts_on, a.ends_on, a.status, a.note,
  a.cancel_reason, a.row_version, a.created_at, a.updated_at
from feedbackgb.employee_absences a
join feedbackgb.users u on u.id = a.employee_id
left join feedbackgb.v_stores s on s.id = a.store_id;

alter table feedbackgb.employee_absences enable row level security;
revoke all on table feedbackgb.employee_absences from public, anon, authenticated;
revoke all on table feedbackgb.v_employee_absences from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.employee_absences to service_role;
grant select on table feedbackgb.v_employee_absences to service_role;
revoke all on function feedbackgb.validate_employee_absence() from public, anon, authenticated;
revoke all on function feedbackgb.set_employee_absence_updated_at() from public, anon, authenticated;
grant execute on function feedbackgb.validate_employee_absence() to service_role;
grant execute on function feedbackgb.set_employee_absence_updated_at() to service_role;

comment on table feedbackgb.employee_absences is 'Administrator-recorded absence. It is not a payroll calculation or an HR request.';
commit;
