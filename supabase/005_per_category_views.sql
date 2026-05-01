-- 005_per_category_views.sql
-- Per-category analytical views.
--
-- All feedback rows live in a single `feedbackgb.feedback` table; the
-- `category` column distinguishes each section. To make per-category
-- analysis convenient in Supabase Studio (and in any external BI tool),
-- this migration adds one read-only view per category.
--
-- Each view selects from the existing `feedback_feed` view (which already
-- joins category metadata, store, user and product) and exposes a compact
-- column set suitable for skimming and exporting. The application code,
-- daily Telegram report and Drive backup all keep using the underlying
-- table — these views are purely additive.

set search_path = feedbackgb, public;

-- 1. Reusable column subset.
--
-- We project only the fields that make sense in an analytical/export
-- context: created_at, store, who reported, what the row is about (product
-- + quantity for v1 categories OR fields jsonb for legacy categories),
-- the photo reference and the auto-generated summary.

create or replace view feedbackgb.v_feedback_missing_item as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    product_name,
    quantity,
    product_unit,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'missing_item';

comment on view feedbackgb.v_feedback_missing_item is
  '🛒 Не вистачає товару (тільки рядки з category=missing_item)';

create or replace view feedbackgb.v_feedback_overstock as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    product_name,
    quantity,
    product_unit,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'overstock';

comment on view feedbackgb.v_feedback_overstock is
  '📈 Багато товару (тільки рядки з category=overstock)';

create or replace view feedbackgb.v_feedback_defect as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    product_name,
    quantity,
    product_unit,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'defect';

comment on view feedbackgb.v_feedback_defect is
  '💔 Брак (тільки рядки з category=defect)';

create or replace view feedbackgb.v_feedback_supply_problem as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'supply_problem';

comment on view feedbackgb.v_feedback_supply_problem is
  '📦 Проблема з постачанням (тільки рядки з category=supply_problem)';

create or replace view feedbackgb.v_feedback_store_idea as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'store_idea';

comment on view feedbackgb.v_feedback_store_idea is
  '💡 Ідея для магазину (тільки рядки з category=store_idea)';

create or replace view feedbackgb.v_feedback_spotted_elsewhere as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'spotted_elsewhere';

comment on view feedbackgb.v_feedback_spotted_elsewhere is
  '👀 Побачила деінде (тільки рядки з category=spotted_elsewhere)';

create or replace view feedbackgb.v_feedback_tech_issue as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'tech_issue';

comment on view feedbackgb.v_feedback_tech_issue is
  '🛠 Технічний збій (тільки рядки з category=tech_issue)';

create or replace view feedbackgb.v_feedback_customer_voice as
  select
    id,
    created_at,
    store_name,
    user_full_name,
    fields,
    photo_url,
    summary,
    status
  from feedbackgb.feedback_feed
  where category = 'customer_voice';

comment on view feedbackgb.v_feedback_customer_voice is
  '🎤 Голос покупця/продавчині (тільки рядки з category=customer_voice)';

-- 2. Permissions.
-- service_role has BYPASSRLS, so the views inherit access via the underlying
-- table. We grant SELECT explicitly so it shows up in Supabase Studio and
-- so future direct PostgREST users can read.

grant select on feedbackgb.v_feedback_missing_item        to service_role;
grant select on feedbackgb.v_feedback_overstock           to service_role;
grant select on feedbackgb.v_feedback_defect              to service_role;
grant select on feedbackgb.v_feedback_supply_problem      to service_role;
grant select on feedbackgb.v_feedback_store_idea          to service_role;
grant select on feedbackgb.v_feedback_spotted_elsewhere   to service_role;
grant select on feedbackgb.v_feedback_tech_issue          to service_role;
grant select on feedbackgb.v_feedback_customer_voice      to service_role;
