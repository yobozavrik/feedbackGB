-- =============================================================================
-- 003 v1 priority flow — "Мало / Багато / Брак" product-first capture
-- =============================================================================
-- Adds the v1-priority shortcut: the three most-frequent situations
-- ("not enough", "overstocked", "defective") are captured with a structured
-- link to a product from the ERP catalog (categories.products), a quantity,
-- and an optional photo.
--
-- This migration:
--   1. Grants service_role references/select on categories.products and
--      categories.categories so feedbackgb can safely join/FK them.
--   2. Adds two new categories: overstock, defect (keeps the existing 6).
--   3. Adds `product_id`, `quantity` columns on feedbackgb.feedback.
--   4. Creates feedbackgb.v_products — a denormalised, search-friendly view
--      of the POS catalog (only non-hidden products).
--   5. Creates feedbackgb.v_popular_products — aggregates product usage over
--      the last 7 days per store, so sellers see their top items first.
--   6. Updates feedbackgb.feedback_feed view to surface product info to admins.
--
-- Apply in Supabase Studio → SQL Editor (as service_role). Safe to re-run.
-- =============================================================================

-- 1. Cross-schema grants so feedbackgb can see/FK the ERP catalog tables.
--    (We already grant references on categories.spots in schema.sql.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant usage on schema categories to service_role';
    execute 'grant select on categories.products to service_role';
    execute 'grant select on categories.categories to service_role';
    execute 'grant references on table categories.products to service_role';
  end if;
end $$;

-- 2. Add the two new v1-priority categories. Existing rows are untouched.
insert into feedbackgb.categories (id, emoji, title, short, sort_order) values
  ('overstock', '📈', 'Багато товару', 'Залежався або зайвий запас',      7),
  ('defect',    '💔', 'Брак товару',   'Пошкоджений, прострочений, битий', 8)
on conflict (id) do update set
  emoji      = excluded.emoji,
  title      = excluded.title,
  short      = excluded.short,
  sort_order = excluded.sort_order;

-- 3. Structured product + quantity on feedback rows.
--    NULL for legacy / non-product categories (ідея, тех-проблема, ...).
alter table feedbackgb.feedback
  add column if not exists product_id bigint
    references categories.products(id) on delete set null,
  add column if not exists quantity numeric;

create index if not exists feedback_product_idx
  on feedbackgb.feedback (product_id)
  where product_id is not null;

-- Helpful composite index for "popular product in this store" lookups.
create index if not exists feedback_product_store_time_idx
  on feedbackgb.feedback (store_id, product_id, created_at desc)
  where product_id is not null;

-- 4. Read-only view over the POS catalog (only visible/non-hidden items).
--    Exposes a superset of columns the picker needs; photo is the raw path
--    from the POS CDN — the API prefixes it with POSTER_CDN_BASE_URL.
create or replace view feedbackgb.v_products as
  select
    p.id,
    p.name,
    p.category_id                         as category_id,
    c.category_name,
    coalesce(c.sort_order, 9999)          as category_sort,
    p.unit,
    p.barcode,
    p.photo,
    p.cost
  from categories.products p
  left join categories.categories c on c.category_id = p.category_id
  where coalesce(c.category_hidden, 0) = 0;

comment on view feedbackgb.v_products is
  'Flat, non-hidden POS catalog for the feedback product picker.';

-- 5. Per-store product popularity over the last 7 days.
--    Drives the "Часто питають" chips at the top of the picker.
create or replace view feedbackgb.v_popular_products as
  select
    f.store_id,
    f.product_id,
    count(*)::int                         as uses_7d,
    max(f.created_at)                     as last_used_at
  from feedbackgb.feedback f
  where f.product_id is not null
    and f.created_at > now() - interval '7 days'
  group by f.store_id, f.product_id;

comment on view feedbackgb.v_popular_products is
  'Rolling 7-day product usage per store for the "Часто питають" chips.';

-- 6. service_role grants on the new views.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_products          to service_role';
    execute 'grant select on feedbackgb.v_popular_products  to service_role';
  end if;
end $$;

-- 7. Refresh feedback_feed so admin UI can see product info.
create or replace view feedbackgb.feedback_feed as
  select
    f.id,
    f.created_at,
    f.updated_at,
    f.category,
    c.emoji        as category_emoji,
    c.title        as category_title,
    f.store_id,
    coalesce(s.name, f.store_label)         as store_name,
    s.address                               as store_address,
    f.user_id,
    u.full_name    as user_full_name,
    u.role         as user_role,
    f.fields,
    f.product_id,
    p.name         as product_name,
    p.unit         as product_unit,
    f.quantity,
    f.photo_url,
    f.tg_user_id,
    f.tg_username,
    f.tg_display_name,
    f.tg_verified,
    f.summary,
    f.status,
    f.resolved_at,
    f.resolved_by
  from feedbackgb.feedback f
  left join feedbackgb.categories c on c.id = f.category
  left join categories.spots      s on s.spot_id = f.store_id
  left join feedbackgb.users      u on u.id = f.user_id
  left join categories.products   p on p.id = f.product_id;
