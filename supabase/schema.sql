-- =============================================================================
-- FeedbackGB — full backend schema
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
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid(), crypt()
create extension if not exists "pg_trgm";    -- trigram fuzzy search
create extension if not exists "vector";     -- pgvector (AI embeddings)

create schema if not exists feedbackgb;

-- Grants for Supabase roles (no-op if those roles don't exist).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant usage on schema feedbackgb to authenticator, anon, authenticated, service_role';
    execute 'alter default privileges in schema feedbackgb grant select on tables to anon, authenticated';
    execute 'alter default privileges in schema feedbackgb grant select, insert, update, delete on tables to service_role';
    execute 'alter default privileges in schema feedbackgb grant execute on functions to anon, authenticated, service_role';
    -- service_role may need to FK-reference categories.spots
    execute 'grant references on table categories.spots to service_role';
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

-- Allow read of the view to all roles
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_stores to anon, authenticated, service_role';
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
  ('supply_problem',     '📦', 'Проблема з постачанням',     'Привезли не те / зіпсоване / запізно',      2),
  ('store_idea',         '💡', 'Ідея для магазину',           'Що покращити в моєму магазині',             3),
  ('spotted_elsewhere',  '👀', 'Підгледіла в іншому місці',   'Класна ідея ззовні — фото + опис',          4),
  ('tech_issue',         '🔧', 'Технічна проблема',           'Обладнання, ремонт, чистота',               5),
  ('customer_voice',     '🗣', 'Голос клієнта',               'Що часто питають / на що скаржаться',       6)
on conflict (id) do update set
  emoji = excluded.emoji,
  title = excluded.title,
  short = excluded.short,
  sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- 4. Users (PIN auth)
--    pin_hash uses bcrypt via pgcrypto.crypt(). PIN never stored in plaintext.
-- -----------------------------------------------------------------------------
create table if not exists feedbackgb.users (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  pin_hash    text not null,                                       -- bcrypt
  store_id    integer references categories.spots(spot_id),
  role        text not null default 'seller'
              check (role in ('seller', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  last_login  timestamptz
);

create index if not exists users_active_idx on feedbackgb.users (is_active);
create index if not exists users_role_idx   on feedbackgb.users (role);

-- Helper to verify a 4-digit PIN with constant-time bcrypt comparison.
-- Returns the user row when the PIN matches, NULL otherwise.
create or replace function feedbackgb.verify_pin(p_pin text)
returns feedbackgb.users
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
declare
  u feedbackgb.users;
begin
  if p_pin is null or p_pin !~ '^\d{4,6}$' then
    return null;
  end if;
  -- bcrypt-compare against every active user; fast enough for <10k users.
  for u in select * from feedbackgb.users where is_active loop
    if u.pin_hash = crypt(p_pin, u.pin_hash) then
      update feedbackgb.users set last_login = now() where id = u.id;
      return u;
    end if;
  end loop;
  return null;
end $$;

-- Helper to create / reset a user PIN (admin/seed path; service_role only).
create or replace function feedbackgb.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
begin
  if p_pin !~ '^\d{4,6}$' then
    raise exception 'PIN must be 4-6 digits';
  end if;
  update feedbackgb.users
     set pin_hash = crypt(p_pin, gen_salt('bf', 10))
   where id = p_user_id;
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

  -- structured per-category answers
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
  resolved_by     uuid references feedbackgb.users(id)
);

create index if not exists feedback_created_at_idx on feedbackgb.feedback (created_at desc);
create index if not exists feedback_category_idx   on feedbackgb.feedback (category);
create index if not exists feedback_store_idx      on feedbackgb.feedback (store_id);
create index if not exists feedback_status_idx     on feedbackgb.feedback (status);
create index if not exists feedback_user_idx       on feedbackgb.feedback (user_id);
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
  who := coalesce(
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
end $$ language plpgsql security definer;

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
  left join feedbackgb.users      u on u.id = f.user_id;

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

-- -----------------------------------------------------------------------------
-- 8. Helper analytics functions
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

-- -----------------------------------------------------------------------------
-- 9. Row Level Security
-- -----------------------------------------------------------------------------
alter table feedbackgb.feedback   enable row level security;
alter table feedbackgb.audit_log  enable row level security;
alter table feedbackgb.users      enable row level security;
alter table feedbackgb.categories enable row level security;

drop policy if exists categories_read_all on feedbackgb.categories;
create policy categories_read_all on feedbackgb.categories
  for select using (true);

-- Users: anon/authenticated cannot read. service_role bypasses RLS.
-- (Login flow uses verify_pin() function which is SECURITY DEFINER, so it
-- works even with RLS on.)

-- Feedback: anon/authenticated cannot read directly — admin UI uses
-- service_role server-side.

-- Audit log: service_role only.

-- -----------------------------------------------------------------------------
-- 10. Storage bucket
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('feedback-photos', 'feedback-photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 11. Seed: sample admin + sellers (so the app works the moment SQL completes)
--
--    Default PINs (CHANGE LATER!):
--      admin   1234  →  Галя Балувана (admin)
--      seller  1111  →  Продавчиня магазину Кварц (spot 1)
--      seller  2222  →  Продавчиня магазину Шкільна (spot 2)
--      seller  3333  →  Продавчиня магазину Герцена (spot 3)
--
--    Reset / change PIN later:
--      select feedbackgb.set_user_pin('<user_uuid>', '4321');
-- -----------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  -- admin
  if not exists (select 1 from feedbackgb.users where full_name = 'Галя Балувана') then
    v_id := gen_random_uuid();
    insert into feedbackgb.users (id, full_name, pin_hash, role, store_id)
    values (v_id, 'Галя Балувана', extensions.crypt('1234', extensions.gen_salt('bf', 10)), 'admin', null);
  end if;

  -- 3 sellers tied to spots 1/2/3
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Кварц') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Кварц', extensions.crypt('1111', extensions.gen_salt('bf', 10)), 'seller', 1);
  end if;
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Шкільна') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Шкільна', extensions.crypt('2222', extensions.gen_salt('bf', 10)), 'seller', 2);
  end if;
  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Герцена') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Герцена', extensions.crypt('3333', extensions.gen_salt('bf', 10)), 'seller', 3);
  end if;
end $$;

-- =============================================================================
-- Done.
--
-- Quick smoke test (in SQL Editor):
--   select * from feedbackgb.v_stores limit 5;
--   select id, full_name, role, store_id from feedbackgb.users;
--   select (feedbackgb.verify_pin('1234')).full_name;   -- should return 'Галя Балувана'
--
-- Insert a fake feedback as service_role:
--   insert into feedbackgb.feedback (category, store_id, fields, summary)
--   values ('missing_item', 2, '{"item_name":"тест"}', '🛒 тест запис');
--   select * from feedbackgb.feedback_feed;
-- =============================================================================
