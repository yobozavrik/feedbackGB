-- Supply employees and access model.
--
-- This migration is intentionally NOT applied to live Supabase by the repo.
-- A super_admin applies it manually in the Supabase SQL Editor (service_role).
-- PIN is never stored in this model: feedbackgb.users.pin_hash +
-- feedbackgb.set_user_pin(uuid, text) remains the only credential store.
--
-- Re-runnable: an earlier draft of these tables may already exist (created by
-- hand during development) in a different shape. The guarded reset block below
-- rebuilds them cleanly, but ONLY while they are empty — if any Supply table
-- holds rows it aborts instead of destroying data.

set search_path = feedbackgb, public, pg_catalog;

-- Guarded reset -----------------------------------------------------------
do $$
declare
  n bigint;
  total bigint := 0;
begin
  if to_regclass('feedbackgb.facilities') is not null then
    execute 'select count(*) from feedbackgb.facilities' into n; total := total + n;
  end if;
  if to_regclass('feedbackgb.user_app_access') is not null then
    execute 'select count(*) from feedbackgb.user_app_access' into n; total := total + n;
  end if;
  if to_regclass('feedbackgb.user_facility_memberships') is not null then
    execute 'select count(*) from feedbackgb.user_facility_memberships' into n; total := total + n;
  end if;
  if to_regclass('feedbackgb.supply_employee_profiles') is not null then
    execute 'select count(*) from feedbackgb.supply_employee_profiles' into n; total := total + n;
  end if;

  if total > 0 then
    raise exception
      'Supply tables hold % row(s); refusing to rebuild. Migrate the delta by hand.', total;
  end if;

  execute 'drop view  if exists feedbackgb.v_supply_employees';
  execute 'alter table if exists feedbackgb.feedback drop column if exists facility_id';
  execute 'drop table if exists feedbackgb.user_facility_memberships cascade';
  execute 'drop table if exists feedbackgb.user_app_access cascade';
  execute 'drop table if exists feedbackgb.supply_employee_profiles cascade';
  execute 'drop table if exists feedbackgb.facilities cascade';
end $$;

alter table feedbackgb.users drop constraint if exists users_role_check;
alter table feedbackgb.users add constraint users_role_check
  check (role in ('seller', 'supply_worker', 'admin', 'super_admin'));

create table feedbackgb.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  kind text not null check (kind in ('production', 'warehouse')),
  crm_system text null,
  crm_location_id text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crm_system, crm_location_id)
);

alter table feedbackgb.facilities
  add column if not exists crm_warehouse_id integer;

alter table feedbackgb.feedback
  add column if not exists facility_id uuid
    references feedbackgb.facilities(id) on delete restrict;

create index feedback_facility_idx
  on feedbackgb.feedback (facility_id, created_at desc)
  where facility_id is not null;

comment on column feedbackgb.facilities.crm_location_id is
  'household_chemicals.shops.id; never a warehouse or Poster spot ID.';
comment on column feedbackgb.facilities.crm_warehouse_id is
  'household_chemicals.warehouses.id; reporting and future transfer flows.';

create table feedbackgb.user_app_access (
  user_id uuid not null references feedbackgb.users(id) on delete cascade,
  app_key text not null check (app_key in ('seller_app', 'supply_app')),
  is_active boolean not null default true,
  granted_by uuid null references feedbackgb.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  primary key (user_id, app_key),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create table feedbackgb.user_facility_memberships (
  user_id uuid not null references feedbackgb.users(id) on delete cascade,
  facility_id uuid not null references feedbackgb.facilities(id) on delete restrict,
  role text not null check (role in (
    'supply_worker', 'supply_manager', 'receiver', 'quality_controller'
  )),
  is_active boolean not null default true,
  granted_by uuid null references feedbackgb.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  primary key (user_id, facility_id),
  check ((is_active and revoked_at is null) or (not is_active and revoked_at is not null))
);

create index user_app_access_supply_active_idx
  on feedbackgb.user_app_access (user_id) where app_key = 'supply_app' and is_active;
create index user_facility_memberships_active_idx
  on feedbackgb.user_facility_memberships (user_id, facility_id) where is_active;

create or replace view feedbackgb.v_supply_employees as
select
  u.id,
  coalesce(u.display_label, u.full_name) as display_label,
  u.role as global_role,
  u.is_active as is_active,
  u.pin_hash is not null as has_pin,
  exists (
    select 1 from feedbackgb.user_app_access a
    where a.user_id = u.id and a.app_key = 'supply_app' and a.is_active
  ) as has_supply_access
from feedbackgb.users u
where u.role = 'supply_worker';

alter table feedbackgb.facilities enable row level security;
alter table feedbackgb.facilities force row level security;
alter table feedbackgb.user_app_access enable row level security;
alter table feedbackgb.user_app_access force row level security;
alter table feedbackgb.user_facility_memberships enable row level security;
alter table feedbackgb.user_facility_memberships force row level security;

-- These tables are accessed only by server-side code through service_role.
-- There are intentionally no anon/authenticated RLS policies. A future browser
-- access requirement must introduce explicit policies in a new migration.

revoke all on feedbackgb.facilities, feedbackgb.user_app_access,
  feedbackgb.user_facility_memberships,
  feedbackgb.v_supply_employees from anon, authenticated;

grant select, insert, update, delete on feedbackgb.facilities,
  feedbackgb.user_app_access,
  feedbackgb.user_facility_memberships to service_role;
grant select on feedbackgb.v_supply_employees to service_role;

create or replace function feedbackgb.touch_updated_at()
returns trigger
language plpgsql
set search_path = feedbackgb, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger facilities_touch_updated_at
before update on feedbackgb.facilities
for each row execute function feedbackgb.touch_updated_at();

comment on view feedbackgb.v_supply_employees is
  'Safe admin projection: exposes has_pin, never pin_hash or raw PIN. Operational role lives in user_facility_memberships.';

create or replace function feedbackgb.verify_pin_for_app(p_pin text, p_app_key text)
returns jsonb
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
as $$
declare
  candidate feedbackgb.users;
  matched feedbackgb.users;
  matched_facility_id uuid;
  matched_facility_name text;
  match_count integer := 0;
begin
  if p_pin is null or p_pin !~ '^\d{6}$' then
    return null;
  end if;

  if p_app_key not in ('seller_app', 'supply_app') then
    return null;
  end if;

  for candidate in
    select u.*
    from feedbackgb.users u
    where u.is_active
      and u.pin_hash is not null
      and (u.locked_until is null or u.locked_until <= now())
      and exists (
        select 1
        from feedbackgb.user_app_access access
        where access.user_id = u.id
          and access.app_key = p_app_key
          and access.is_active
      )
      and (
        u.role <> 'supply_worker'
        or exists (
          select 1
          from feedbackgb.user_facility_memberships membership
          where membership.user_id = u.id
            and membership.is_active
        )
      )
  loop
    if candidate.pin_hash = crypt(p_pin, candidate.pin_hash) then
      match_count := match_count + 1;
      matched := candidate;
      if match_count > 1 then
        return null;
      end if;
    end if;
  end loop;

  if match_count = 0 then
    return null;
  end if;

  select membership.facility_id, facility.name
    into matched_facility_id, matched_facility_name
  from feedbackgb.user_facility_memberships membership
  join feedbackgb.facilities facility on facility.id = membership.facility_id
  where membership.user_id = matched.id
    and membership.is_active
    and facility.is_active
  order by membership.granted_at, membership.facility_id
  limit 1;

  update feedbackgb.users
     set last_login = now(),
         failed_attempts = 0,
         locked_until = null
   where id = matched.id;

  return jsonb_build_object(
    'id', matched.id,
    'full_name', matched.full_name,
    'display_label', matched.display_label,
    'role', matched.role,
    'facility_id', matched_facility_id,
    'facility_name', matched_facility_name
  );
end;
$$;

revoke all on function feedbackgb.verify_pin_for_app(text, text) from public, anon, authenticated;
grant execute on function feedbackgb.verify_pin_for_app(text, text) to service_role;
