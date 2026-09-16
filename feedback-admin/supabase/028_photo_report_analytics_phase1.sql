-- 028_photo_report_analytics_phase1.sql
-- Phase 1 only: compatible data foundation for Photo Report analytics.
-- Apply to staging first. Do not enable UI flags from this migration.
-- Rollback is documented at the end of this file. Do not run it after the
-- seller app starts writing the new attribution/time fields.

set search_path = feedbackgb, public;

-- This migration uses UNIQUE NULLS NOT DISTINCT, introduced in PostgreSQL 15.
-- Fail before any DDL on an older staging database; use the documented two
-- partial indexes variant instead of attempting a partial migration.
do $$
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception '028 requires PostgreSQL 15+ (found %)', version();
  end if;
  if to_regnamespace('extensions') is null then
    raise exception '028 requires the Supabase extensions schema';
  end if;
end;
$$;

create extension if not exists btree_gist with schema extensions;

-- PostgreSQL has no built-in range over time without time zone.
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'feedbackgb' and t.typname = 'timerange'
  ) then
    execute 'create type feedbackgb.timerange as range (subtype = time without time zone)';
  end if;
end;
$$;

create table if not exists feedbackgb.photo_report_requirements (
  id bigserial primary key,
  -- NULL is the network default; a store-specific rule overrides defaults for its day.
  store_id integer references categories.spots(spot_id),
  weekday_iso smallint not null check (weekday_iso between 1 and 7),
  slot_no smallint not null check (slot_no > 0),
  slot_label text not null check (length(trim(slot_label)) between 1 and 80),
  window_start time not null,
  due_time time not null,
  late_grace_end time not null,
  is_required boolean not null default true,
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  -- Windows are [window_start, due_time); late grace is [due_time, late_grace_end).
  -- Cross-midnight windows are deliberately unsupported.
  check (window_start < due_time and due_time <= late_grace_end)
);

-- A single constraint blocks overlapping versions and overlapping slot/grace
-- windows for the same store/default and ISO weekday.
alter table feedbackgb.photo_report_requirements
  drop constraint if exists photo_report_requirements_no_overlap;
alter table feedbackgb.photo_report_requirements
  add constraint photo_report_requirements_no_overlap
  exclude using gist (
    (coalesce(store_id, 0)) with =,
    weekday_iso with =,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') with &&,
    feedbackgb.timerange(window_start, late_grace_end, '[)') with &&
  );

drop trigger if exists photo_report_requirements_set_updated_at on feedbackgb.photo_report_requirements;
create trigger photo_report_requirements_set_updated_at
  before update on feedbackgb.photo_report_requirements
  for each row execute function feedbackgb.set_updated_at();

create table if not exists feedbackgb.photo_report_exceptions (
  id bigserial primary key,
  -- NULL means the whole network; a store row means that store only.
  store_id integer references categories.spots(spot_id),
  local_date date not null,
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_by uuid references feedbackgb.users(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (store_id, local_date)
);

alter table feedbackgb.photo_report_requirements enable row level security;
alter table feedbackgb.photo_report_exceptions enable row level security;

-- Start nullable: deployed seller apps can keep inserting during the rollout.
-- The API phase will write these fields explicitly; old clients receive defaults.
alter table feedbackgb.feedback
  add column if not exists effective_at timestamptz,
  add column if not exists effective_at_source text,
  add column if not exists client_time_rejected_reason text,
  add column if not exists attribution_source text,
  add column if not exists attendance_id bigint;

-- Adding the nullable column first preserves NULL on historical rows. The
-- default then applies only to rows inserted after this statement.
alter table feedbackgb.feedback
  alter column effective_at set default now();

alter table feedbackgb.feedback
  drop constraint if exists feedback_effective_at_source_check,
  drop constraint if exists feedback_attribution_source_check;
alter table feedbackgb.feedback
  add constraint feedback_effective_at_source_check
    check (effective_at_source is null or effective_at_source in ('client', 'server')),
  add constraint feedback_attribution_source_check
    check (attribution_source is null or attribution_source in ('attendance', 'home_store', 'admin'));

-- Historical client_created_at is not trusted because old payloads had no offline flag.
-- Run this UPDATE in bounded batches from the staging/production runbook.
-- update feedbackgb.feedback
-- set effective_at = created_at, effective_at_source = 'server'
-- where id in (
--   select id from feedbackgb.feedback
--   where effective_at is null
--   order by created_at
--   limit 10000
-- );

-- Do not recreate feedback_feed in Phase 1. The deployed view has columns
-- beyond source migration 014 (including facility_id), and CREATE OR REPLACE
-- VIEW may append new columns only after its actual final column. Phase 3 will
-- use an explicit read-only pg_get_viewdef()/information_schema snapshot and a
-- dedicated migration that preserves the live column contract exactly.

revoke all on table feedbackgb.photo_report_requirements from anon, authenticated;
revoke all on table feedbackgb.photo_report_exceptions from anon, authenticated;
grant select, insert, update, delete on table feedbackgb.photo_report_requirements to service_role;
grant select, insert, update, delete on table feedbackgb.photo_report_exceptions to service_role;
grant usage, select on sequence feedbackgb.photo_report_requirements_id_seq to service_role;
grant usage, select on sequence feedbackgb.photo_report_exceptions_id_seq to service_role;

-- Rollback (only before a deployed app writes effective_at/attribution):
-- 1. alter table feedbackgb.feedback
--      drop constraint if exists feedback_effective_at_source_check,
--      drop constraint if exists feedback_attribution_source_check,
--      drop column if exists attendance_id,
--      drop column if exists attribution_source,
--      drop column if exists client_time_rejected_reason,
--      drop column if exists effective_at_source,
--      drop column if exists effective_at;
-- 2. drop table if exists feedbackgb.photo_report_exceptions;
--    drop table if exists feedbackgb.photo_report_requirements;
--    drop type if exists feedbackgb.timerange;
