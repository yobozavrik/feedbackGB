-- =============================================================================
-- FeedbackGB — full backend schema (SECURITY-HARDENED)
-- =============================================================================
-- Apply once via Supabase Studio → SQL Editor (run the whole file as one
-- script) or via psql:
--   psql "$DATABASE_URL" -f supabase/schema.sql
--
-- Re-runnable: every statement uses IF NOT EXISTS / CREATE OR REPLACE.
--
-- All app objects live inside the `feedbackgb` schema. Magazines (stores)
-- come from the EXISTING ERP table `categories.spots` — we only reference it,
-- never duplicate.
--
-- IMPORTANT — one-time PostgREST config:
--   The self-hosted Supabase instance must expose the `feedbackgb` schema.
--   Add it to the comma-separated PGRST_DB_SCHEMAS env var (or `db-schemas`
--   in postgrest.conf) on the `rest` service, then restart it. Example:
--     PGRST_DB_SCHEMAS=public,storage,graphql_public,categories,...,feedbackgb
--   After restart, run `NOTIFY pgrst, 'reload schema';` (or just hit the
--   server) and the API picks up the new tables automatically.
--
-- SECURITY NOTE:
--   * No default privileges on functions for `anon` / `authenticated`.
--     Every SECURITY DEFINER function is explicitly revoked from public
--     and granted only to `service_role` (app reaches DB with service role).
--   * No seeded PINs. PINs are set out-of-band via
--     `feedbackgb.set_user_pin(uuid, text)` from SQL Editor (service_role).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid(), crypt()
create extension if not exists "pg_trgm";    -- trigram fuzzy search
create extension if not exists "vector";     -- pgvector (AI embeddings)

create schema if not exists feedbackgb;

-- Grants for Supabase roles (no-op if those roles don't exist).
-- IMPORTANT: we DO NOT grant execute on functions to anon/authenticated by
-- default. Application always reaches the DB with service_role — never from
-- the browser. Granting execute to anon would expose SECURITY DEFINER
-- functions (`verify_pin`, `set_user_pin`, …) to the public internet.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant usage on schema feedbackgb to service_role';
    execute 'alter default privileges in schema feedbackgb grant select, insert, update, delete on tables to service_role';
    execute 'alter default privileges in schema feedbackgb grant execute on functions to service_role';
    -- Make sure anon/authenticated never accidentally inherit access to
    -- feedbackgb objects (default-privileges defaults differ across PG
    -- versions and self-hosted Supabase images).
    execute 'alter default privileges in schema feedbackgb revoke select on tables from anon, authenticated';
    execute 'alter default privileges in schema feedbackgb revoke execute on functions from anon, authenticated';
    -- service_role may need to FK-reference categories.spots / products
    -- and read the ERP product catalog used by the v1 priority flow.
    execute 'grant usage    on schema categories              to service_role';
    execute 'grant references on table categories.spots       to service_role';
    execute 'grant references on table categories.products    to service_role';
    execute 'grant select   on categories.products            to service_role';
    execute 'grant select   on categories.categories          to service_role';
  end if;
end $$;

-- service_role must bypass row-level security so the API can read/write
-- regardless of RLS policies. Managed Supabase sets this by default; some
-- self-hosted images create the role without BYPASSRLS, which surfaces as
-- 403 from PostgREST on insert.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    begin
      execute 'alter role service_role bypassrls';
    exception when insufficient_privilege then
      raise notice 'cannot ALTER ROLE service_role BYPASSRLS — run as supabase_admin or postgres';
    end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Stores: VIEW over the ERP source `categories.spots`
--    (active spots only; preserves spot_id so FK works without duplication)
-- -----------------------------------------------------------------------------
create or replace view feedbackgb.v_stores as
  select
    s.spot_id   as id,
    s.name      as name,
    s.address   as address,
    s.lat,
    s.lng,
    not s.is_deleted as is_active
  from categories.spots s
  where s.is_deleted = false;

-- Only service_role reads v_stores (the API proxies it via /api/stores).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_stores to service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Reference: categories (mirrors src/lib/categories.ts so analytics can
--    join human-readable names server-side without parsing client config)
-- -----------------------------------------------------------------------------
create table if not exists feedbackgb.categories (
  id          text primary key,
  emoji       text not null,
  title       text not null,
  short       text not null,
  sort_order  smallint not null default 0
);

insert into feedbackgb.categories (id, emoji, title, short, sort_order) values
  ('missing_item',       '🛒', 'Не вистачає товару',          'Чого не вистачило сьогодні',                1),
  ('overstock',          '📈', 'Багато товару',               'Залежався або зайвий запас',                2),
  ('defect',             '💔', 'Брак товару',                 'Пошкоджений, прострочений, битий',          3),
  ('supply_problem',     '📦', 'Проблема з постачанням',     'Привезли не те / зіпсоване / запізно',      4),
  ('store_idea',         '💡', 'Ідея для магазину',           'Що покращити в моєму магазині',             5),
  ('spotted_elsewhere',  '👀', 'Підгледіла в іншому місці',   'Класна ідея ззовні — фото + опис',          6),
  ('tech_issue',         '🔧', 'Технічна проблема',           'Обладнання, ремонт, чистота',               7),
  ('customer_voice',     '🗣', 'Голос клієнта',               'Що часто питають / на що скаржаться',       8)
on conflict (id) do update set
  emoji = excluded.emoji,
  title = excluded.title,
  short = excluded.short,
  sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 4. Users (PIN auth)
--    pin_hash uses bcrypt via pgcrypto.crypt(). PIN never stored in plaintext.
--    PIN length: 6-8 digits. Login is user_id + pin (no linear scan, no
--    PIN-collision ambiguity).
-- -----------------------------------------------------------------------------
create table if not exists feedbackgb.users (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  pin_hash    text,                                               -- bcrypt, null until admin sets it
  store_id    integer references categories.spots(spot_id),
  role        text not null default 'seller'
              check (role in ('seller', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  last_login  timestamptz,
  failed_attempts int not null default 0,
  locked_until    timestamptz
);

create index if not exists users_active_idx on feedbackgb.users (is_active);
create index if not exists users_role_idx   on feedbackgb.users (role);

-- Helper returning the minimal user list for the login picker. The API
-- reaches this with service_role and then exposes only (id, full_name, store_id, role).
create or replace view feedbackgb.v_login_users as
  select id, full_name, role, store_id
  from feedbackgb.users
  where is_active
  order by full_name asc;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_login_users to service_role';
  end if;
end $$;

-- verify_pin(uuid, text) — verifies the PIN for a specific user.
-- Returns the user row when the PIN matches, NULL otherwise.
-- Enforces 4–8 digit format (4/5 allowed only for legacy rows during migration;
-- the API enforces 6+ going forward).
create or replace function feedbackgb.verify_pin(p_user_id uuid, p_pin text)
returns feedbackgb.users
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
declare
  u feedbackgb.users;
begin
  if p_user_id is null or p_pin is null or p_pin !~ '^\d{4,8}$' then
    return null;
  end if;

  select * into u from feedbackgb.users
   where id = p_user_id and is_active;
  if not found or u.pin_hash is null then
    return null;
  end if;

  -- Respect the account lockout window set by the API on repeated failures.
  if u.locked_until is not null and u.locked_until > now() then
    return null;
  end if;

  if u.pin_hash = crypt(p_pin, u.pin_hash) then
    update feedbackgb.users
       set last_login = now(),
           failed_attempts = 0,
           locked_until = null
     where id = u.id
    returning * into u;
    return u;
  else
    update feedbackgb.users
       set failed_attempts = failed_attempts + 1,
           locked_until = case
             when failed_attempts + 1 >= 10 then now() + interval '1 hour'
             else locked_until
           end
     where id = u.id;
    return null;
  end if;
end $$;

-- Helper to create / reset a user PIN. SECURITY DEFINER; only service_role
-- can EXECUTE it (grants below). Enforces a 6-digit minimum.
create or replace function feedbackgb.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
begin
  if p_pin !~ '^\d{6,8}$' then
    raise exception 'PIN must be 6-8 digits';
  end if;
  update feedbackgb.users
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         failed_attempts = 0,
         locked_until = null
   where id = p_user_id;
end $$;

-- Lock down every SECURITY DEFINER function we just (re)created. Revoke from
-- PUBLIC / anon / authenticated, grant only to service_role. The API uses
-- service_role; the browser must never invoke these via PostgREST.
revoke all on function feedbackgb.verify_pin(uuid, text) from public;
revoke all on function feedbackgb.set_user_pin(uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function feedbackgb.verify_pin(uuid, text) from anon, authenticated';
    execute 'revoke all on function feedbackgb.set_user_pin(uuid, text) from anon, authenticated';
    execute 'grant execute on function feedbackgb.verify_pin(uuid, text) to service_role';
    execute 'grant execute on function feedbackgb.set_user_pin(uuid, text) to service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Main: feedback
-- -----------------------------------------------------------------------------
create table if not exists feedbackgb.feedback (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  category        text not null references feedbackgb.categories(id),
  store_id        integer references categories.spots(spot_id),
  -- raw store name fallback when store_id is NULL (legacy / "Інший")
  store_label     text,

  -- author (PIN-authenticated user; nullable for legacy/anonymous)
  user_id         uuid references feedbackgb.users(id),

  -- v1 priority flow: structured product link + amount
  -- (missing_item / overstock / defect). NULL for non-product categories.
  product_id      bigint references categories.products(id) on delete set null,
  quantity        numeric,
  -- Structured consumables basket. NULL for all other feedback categories.
  cart_items      jsonb,

  -- structured per-category answers (extras beyond product + quantity)
  fields          jsonb not null default '{}'::jsonb,

  -- public URL or data: URL fallback
  photo_url       text,

  -- telegram identity (optional, for when bot is wired up)
  tg_user_id      bigint,
  tg_username     text,
  tg_display_name text,
  tg_verified     boolean not null default false,

  -- human/AI-readable single-line description for fast scanning
  summary         text not null,

  -- AI: 1536-dim embedding (e.g. OpenAI text-embedding-3-small)
  embedding       vector(1536),

  -- moderation / triage state for management
  status          text not null default 'new'
    check (status in ('new', 'in_progress', 'resolved', 'rejected')),
  resolved_at     timestamptz,
  resolved_by     uuid references feedbackgb.users(id),
  assigned_to     uuid references feedbackgb.users(id),
  client_submission_id uuid,
  client_created_at timestamptz
);

create unique index if not exists feedback_client_submission_id_uniq
  on feedbackgb.feedback (client_submission_id)
  where client_submission_id is not null;

create index if not exists feedback_created_at_idx on feedbackgb.feedback (created_at desc);
create index if not exists feedback_category_idx   on feedbackgb.feedback (category);
create index if not exists feedback_store_idx      on feedbackgb.feedback (store_id);
create index if not exists feedback_status_idx     on feedbackgb.feedback (status);
create index if not exists feedback_user_idx       on feedbackgb.feedback (user_id);
create index if not exists feedback_product_idx
  on feedbackgb.feedback (product_id)
  where product_id is not null;
create index if not exists feedback_product_store_time_idx
  on feedbackgb.feedback (store_id, product_id, created_at desc)
  where product_id is not null;
create index if not exists feedback_summary_trgm_idx
  on feedbackgb.feedback using gin (summary gin_trgm_ops);

-- pgvector ANN index — IVFFlat is fine for ≤1M rows.
create index if not exists feedback_embedding_ivf_idx
  on feedbackgb.feedback using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- updated_at trigger
create or replace function feedbackgb.set_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

drop trigger if exists feedback_set_updated_at on feedbackgb.feedback;
create trigger feedback_set_updated_at
  before update on feedbackgb.feedback
  for each row execute function feedbackgb.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. Audit log — every meaningful change is recorded
-- -----------------------------------------------------------------------------
create table if not exists feedbackgb.audit_log (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  feedback_id   uuid references feedbackgb.feedback(id) on delete cascade,
  action        text not null,
  actor         text,
  diff          jsonb
);

create index if not exists audit_log_feedback_idx
  on feedbackgb.audit_log (feedback_id, occurred_at desc);

create or replace function feedbackgb.audit_feedback()
returns trigger as $$
declare
  d jsonb;
  who text;
begin
  -- Prefer the app-set actor (API does `select set_config('app.actor', <uid>, true)`
  -- per-request). Fall back to the JWT sub if present, else to 'service_role'.
  who := coalesce(
    nullif(current_setting('app.actor', true), ''),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    'service_role'
  );
  if TG_OP = 'INSERT' then
    insert into feedbackgb.audit_log (feedback_id, action, actor, diff)
    values (NEW.id, 'insert', who,
            jsonb_build_object('category', NEW.category, 'store_id', NEW.store_id));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    d := '{}'::jsonb;
    if NEW.status is distinct from OLD.status then
      d := d || jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status));
    end if;
    if NEW.summary is distinct from OLD.summary then
      d := d || jsonb_build_object('summary_changed', true);
    end if;
    if d <> '{}'::jsonb then
      insert into feedbackgb.audit_log (feedback_id, action, actor, diff)
      values (NEW.id,
              case when NEW.status is distinct from OLD.status then 'status_change' else 'update' end,
              who, d);
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into feedbackgb.audit_log (feedback_id, action, actor, diff)
    values (OLD.id, 'delete', who, jsonb_build_object('id', OLD.id));
    return OLD;
  end if;
  return null;
end $$ language plpgsql;

drop trigger if exists feedback_audit on feedbackgb.feedback;
create trigger feedback_audit
  after insert or update or delete on feedbackgb.feedback
  for each row execute function feedbackgb.audit_feedback();

-- -----------------------------------------------------------------------------
-- 7. Views — what the admin UI and analytics actually read from
-- -----------------------------------------------------------------------------
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
    f.resolved_by,
    f.assigned_to,
    a.full_name    as assigned_full_name,
    -- Offline columns
    f.client_created_at,
    f.client_submission_id,
    f.fields -> 'photo_urls' as photo_urls
  from feedbackgb.feedback f
  left join feedbackgb.categories c on c.id = f.category
  left join categories.spots      s on s.spot_id = f.store_id
  left join feedbackgb.users      u on u.id = f.user_id
  left join feedbackgb.users      a on a.id = f.assigned_to
  left join categories.products   p on p.id = f.product_id;

-- -----------------------------------------------------------------------------
-- 7b. Product catalog views (v1 priority flow — Мало / Багато / Брак)
--     v_products           — flat, non-hidden POS catalog for the picker.
--     v_popular_products   — rolling 7-day popularity per store.
-- -----------------------------------------------------------------------------
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_products          to service_role';
    execute 'grant select on feedbackgb.v_popular_products  to service_role';
  end if;
end $$;

create materialized view if not exists feedbackgb.feedback_stats_daily as
  select
    date_trunc('day', f.created_at)::date as day,
    f.category,
    f.store_id,
    count(*) as count_total,
    count(*) filter (where f.status = 'new')         as count_new,
    count(*) filter (where f.status = 'in_progress') as count_in_progress,
    count(*) filter (where f.status = 'resolved')    as count_resolved
  from feedbackgb.feedback f
  group by 1, 2, 3;

create unique index if not exists feedback_stats_daily_pk
  on feedbackgb.feedback_stats_daily (day, category, store_id);

create or replace function feedbackgb.refresh_stats() returns void as $$
  refresh materialized view concurrently feedbackgb.feedback_stats_daily;
$$ language sql;

revoke all on function feedbackgb.refresh_stats() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function feedbackgb.refresh_stats() from anon, authenticated';
    execute 'grant execute on function feedbackgb.refresh_stats() to service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 8. Helper analytics functions (service_role only)
-- -----------------------------------------------------------------------------
create or replace function feedbackgb.top_missing_items(
  p_store_id integer default null,
  p_from     timestamptz default now() - interval '30 days',
  p_to       timestamptz default now(),
  p_limit    int default 20
) returns table (
  item_name text,
  mentions  bigint,
  last_seen timestamptz
) language sql stable as $$
  select
    lower(trim(f.fields ->> 'item_name')) as item_name,
    count(*)                              as mentions,
    max(f.created_at)                     as last_seen
  from feedbackgb.feedback f
  where f.category = 'missing_item'
    and f.created_at between p_from and p_to
    and f.fields ? 'item_name'
    and (p_store_id is null or f.store_id = p_store_id)
  group by 1
  order by mentions desc, last_seen desc
  limit p_limit;
$$;

revoke all on function feedbackgb.top_missing_items(integer, timestamptz, timestamptz, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function feedbackgb.top_missing_items(integer, timestamptz, timestamptz, int) from anon, authenticated';
    execute 'grant execute on function feedbackgb.top_missing_items(integer, timestamptz, timestamptz, int) to service_role';
  end if;
end $$;

create or replace function feedbackgb.search_feedback_by_embedding(
  query_embedding vector(1536),
  match_count int default 10,
  filter_category text default null
) returns table (
  id        uuid,
  category  text,
  summary   text,
  similarity real,
  created_at timestamptz
) language sql stable as $$
  select
    f.id,
    f.category,
    f.summary,
    1 - (f.embedding <=> query_embedding) as similarity,
    f.created_at
  from feedbackgb.feedback f
  where f.embedding is not null
    and (filter_category is null or f.category = filter_category)
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

revoke all on function feedbackgb.search_feedback_by_embedding(vector, int, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function feedbackgb.search_feedback_by_embedding(vector, int, text) from anon, authenticated';
    execute 'grant execute on function feedbackgb.search_feedback_by_embedding(vector, int, text) to service_role';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Row Level Security
-- -----------------------------------------------------------------------------
alter table feedbackgb.feedback   enable row level security;
alter table feedbackgb.audit_log  enable row level security;
alter table feedbackgb.users      enable row level security;
alter table feedbackgb.categories enable row level security;

drop policy if exists categories_read_all on feedbackgb.categories;
create policy categories_read_all on feedbackgb.categories
  for select to service_role using (true);

-- Users / feedback / audit_log: no policies for anon/authenticated.
-- service_role bypasses RLS anyway. The app always reaches the DB as
-- service_role; the browser never does.

-- -----------------------------------------------------------------------------
-- 10. Storage bucket
--     Private by default — admin UI generates short-lived signed URLs.
--     If you need public sharing, toggle the bucket to public in Studio.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('feedback-photos', 'feedback-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 11. Seed users WITHOUT PINs
--     Each user row is created active but with pin_hash = NULL so they cannot
--     log in until an operator calls `feedbackgb.set_user_pin(<uuid>, '<pin>')`
--     from the SQL Editor (service_role).
--
--     Example rotation (run once after applying schema):
--       select id, full_name from feedbackgb.users;
--       select feedbackgb.set_user_pin('<admin-uuid>', '<6-8 digit pin>');
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from feedbackgb.users where full_name = 'Галя Балувана') then
    insert into feedbackgb.users (full_name, role, store_id)
    values ('Галя Балувана', 'admin', null);
  end if;
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Кварц') then
    insert into feedbackgb.users (full_name, role, store_id)
    values ('Продавчиня — Кварц', 'seller', 1);
  end if;
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Шкільна') then
    insert into feedbackgb.users (full_name, role, store_id)
    values ('Продавчиня — Шкільна', 'seller', 2);
  end if;
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Герцена') then
    insert into feedbackgb.users (full_name, role, store_id)
    values ('Продавчиня — Герцена', 'seller', 3);
  end if;
end $$;

-- =============================================================================
-- Done.
--
-- After applying:
--   1. Rotate PINs:
--      select id, full_name from feedbackgb.users;
--      select feedbackgb.set_user_pin('<uuid>', '<6-8 digits>');
--   2. Sanity check:
--      select full_name from feedbackgb.users where is_active;
--      select (feedbackgb.verify_pin('<uuid>', '<pin>')).full_name;
-- =============================================================================
