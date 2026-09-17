-- 030_seller_replacement_stores.sql
--
-- Allows a seller to submit a photo report for their home store or for a
-- separately granted replacement store. This migration intentionally does not
-- modify existing feedback rows: historical reports have no replacement-store
-- context and remain legacy records.
--
-- Apply to staging first. Do not apply to Production until the seller app and
-- admin app changes that use this contract have passed staging acceptance.

begin;

create table if not exists feedbackgb.seller_store_permissions (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references feedbackgb.users(id) on delete restrict,
  store_id integer not null references categories.spots(spot_id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references feedbackgb.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references feedbackgb.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (revoked_at is null or revoked_at >= granted_at),
  check (note is null or length(trim(note)) between 1 and 500)
);

comment on table feedbackgb.seller_store_permissions is
  'Audited replacement-store permissions for sellers. A permission is not a verified work-shift record.';

comment on column feedbackgb.seller_store_permissions.seller_id is
  'Seller who may submit a photo report for store_id while the permission is active.';

create unique index if not exists seller_store_permissions_one_active_idx
  on feedbackgb.seller_store_permissions (seller_id, store_id)
  where revoked_at is null;

create index if not exists seller_store_permissions_active_seller_store_idx
  on feedbackgb.seller_store_permissions (seller_id, store_id)
  where revoked_at is null;

create or replace function feedbackgb.validate_seller_store_permission()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, public
as $$
declare
  v_role text;
begin
  select role into v_role
    from feedbackgb.users
   where id = new.seller_id;

  if v_role is distinct from 'seller' then
    raise exception 'seller_store_permissions.seller_id must reference a seller';
  end if;

  return new;
end;
$$;

revoke all on function feedbackgb.validate_seller_store_permission() from public, anon, authenticated;
grant execute on function feedbackgb.validate_seller_store_permission() to service_role;

drop trigger if exists seller_store_permissions_validate_seller on feedbackgb.seller_store_permissions;
create trigger seller_store_permissions_validate_seller
  before insert or update of seller_id on feedbackgb.seller_store_permissions
  for each row execute function feedbackgb.validate_seller_store_permission();

drop trigger if exists seller_store_permissions_set_updated_at on feedbackgb.seller_store_permissions;
create trigger seller_store_permissions_set_updated_at
  before update on feedbackgb.seller_store_permissions
  for each row execute function feedbackgb.set_updated_at();

create table if not exists feedbackgb.photo_report_attribution (
  feedback_id uuid primary key references feedbackgb.feedback(id) on delete restrict,
  seller_id uuid not null references feedbackgb.users(id) on delete restrict,
  report_store_id integer not null references categories.spots(spot_id) on delete restrict,
  home_store_id integer references categories.spots(spot_id) on delete set null,
  permission_id uuid references feedbackgb.seller_store_permissions(id) on delete set null,
  source text not null check (source in ('home_store', 'replacement_permission', 'admin')),
  created_at timestamptz not null default now(),
  check (
    (source = 'replacement_permission' and permission_id is not null)
    or (source in ('home_store', 'admin') and permission_id is null)
  )
);

comment on table feedbackgb.photo_report_attribution is
  'Immutable submission-time attribution for photo reports. Legacy reports are intentionally absent.';

create index if not exists photo_report_attribution_store_created_idx
  on feedbackgb.photo_report_attribution (report_store_id, created_at desc);

create index if not exists photo_report_attribution_seller_created_idx
  on feedbackgb.photo_report_attribution (seller_id, created_at desc);

create or replace function feedbackgb.capture_photo_report_attribution()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, public
as $$
declare
  v_role text;
  v_home_store_id integer;
  v_permission_id uuid;
begin
  if new.category <> 'photo_report' then
    return new;
  end if;

  -- A photo report without an authenticated author or a factual store cannot
  -- be attributed safely. Reject it rather than create a misleading record.
  if new.user_id is null or new.store_id is null then
    raise exception 'photo_report requires user_id and store_id';
  end if;

  select role, store_id
    into v_role, v_home_store_id
    from feedbackgb.users
   where id = new.user_id;

  if v_role is null then
    raise exception 'photo_report user % does not exist', new.user_id;
  end if;

  if v_role <> 'seller' then
    insert into feedbackgb.photo_report_attribution (
      feedback_id, seller_id, report_store_id, home_store_id, permission_id, source
    ) values (
      new.id, new.user_id, new.store_id, null, null, 'admin'
    );
    return new;
  end if;

  if v_home_store_id = new.store_id then
    insert into feedbackgb.photo_report_attribution (
      feedback_id, seller_id, report_store_id, home_store_id, permission_id, source
    ) values (
      new.id, new.user_id, new.store_id, v_home_store_id, null, 'home_store'
    );
    return new;
  end if;

  select id into v_permission_id
    from feedbackgb.seller_store_permissions
   where seller_id = new.user_id
     and store_id = new.store_id
     and revoked_at is null
   order by granted_at desc
   limit 1;

  if v_permission_id is null then
    raise exception 'seller % has no active replacement permission for store %', new.user_id, new.store_id;
  end if;

  insert into feedbackgb.photo_report_attribution (
    feedback_id, seller_id, report_store_id, home_store_id, permission_id, source
  ) values (
    new.id, new.user_id, new.store_id, v_home_store_id, v_permission_id, 'replacement_permission'
  );

  return new;
end;
$$;

revoke all on function feedbackgb.capture_photo_report_attribution() from public, anon, authenticated;
grant execute on function feedbackgb.capture_photo_report_attribution() to service_role;

drop trigger if exists feedback_capture_photo_report_attribution on feedbackgb.feedback;
create trigger feedback_capture_photo_report_attribution
  after insert on feedbackgb.feedback
  for each row execute function feedbackgb.capture_photo_report_attribution();

alter table feedbackgb.seller_store_permissions enable row level security;
alter table feedbackgb.photo_report_attribution enable row level security;

revoke all on table feedbackgb.seller_store_permissions from public, anon, authenticated;
revoke all on table feedbackgb.photo_report_attribution from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.seller_store_permissions to service_role;
grant select, insert, update, delete on table feedbackgb.photo_report_attribution to service_role;

commit;

-- Staging readback after applying:
-- select c.relname, c.relrowsecurity
-- from pg_class c join pg_namespace n on n.oid = c.relnamespace
-- where n.nspname = 'feedbackgb'
--   and c.relname in ('seller_store_permissions', 'photo_report_attribution');
--
-- select indexname, indexdef
-- from pg_indexes
-- where schemaname = 'feedbackgb'
--   and tablename = 'seller_store_permissions';
--
-- Rollback is permitted only while both new tables are empty and no deployed
-- application depends on them. Drop the trigger/functions, then the tables.
