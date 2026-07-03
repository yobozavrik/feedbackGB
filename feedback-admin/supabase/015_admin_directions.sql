-- 015_admin_directions.sql
-- Admin "directions" (напрямки): which admin is responsible for which
-- feedback category, optionally scoped to a single store. Backs
-- auto-assignment of feedbackgb.feedback.assigned_to at creation time.
--
-- Design notes (see feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md):
--   * category references the EXISTING feedbackgb.categories(id) — no new
--     taxonomy table. The 9 rows there already mirror
--     shared/lib/categories.ts.
--   * No `priority` column. A partial unique index enforces exactly one
--     active admin per (category, store-scope), so resolution is
--     deterministic by construction instead of by a runtime tie-break.
--   * store_id NULL means "all stores" for that category.
--   * Does NOT touch feedbackgb.feedback — assignment still goes into the
--     existing `assigned_to` column (007_feedback_lifecycle.sql), so the
--     existing index / feedback_feed join / audit trigger keep working
--     unchanged.

set search_path = feedbackgb, public;

-- 1. Table ----------------------------------------------------------------
create table if not exists feedbackgb.admin_directions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references feedbackgb.users(id) on delete cascade,
  category    text not null references feedbackgb.categories(id),
  store_id    integer references categories.spots(spot_id), -- null = всі магазини
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Indexes ----------------------------------------------------------------

-- Fast "show this admin's directions" lookups (admin card in Users UI).
create index if not exists admin_directions_admin_idx
  on feedbackgb.admin_directions (admin_id)
  where is_active;

-- Exactly one active admin per (category, store-scope). coalesce(-1) is a
-- safe sentinel because categories.spots.spot_id is a positive serial PK
-- (verified: min/max spot_id > 0 in the live table).
create unique index if not exists admin_directions_scope_uidx
  on feedbackgb.admin_directions (category, coalesce(store_id, -1))
  where is_active;

-- 3. updated_at trigger ------------------------------------------------------
-- Reuses the existing feedbackgb.set_updated_at() function (schema.sql).
drop trigger if exists admin_directions_set_updated_at on feedbackgb.admin_directions;
create trigger admin_directions_set_updated_at
  before update on feedbackgb.admin_directions
  for each row execute function feedbackgb.set_updated_at();

-- 4. RLS ----------------------------------------------------------------
-- Same posture as feedback / users / audit_log: enable RLS, no policies
-- for anon/authenticated. service_role bypasses RLS regardless, and the
-- app always reaches Postgres as service_role (see schema.sql section 9).
alter table feedbackgb.admin_directions enable row level security;

-- 5. Grants ----------------------------------------------------------------
-- App server (service_role) needs full CRUD: create/edit rules, and
-- soft-delete via is_active = false (update).
grant select, insert, update, delete on feedbackgb.admin_directions to service_role;
