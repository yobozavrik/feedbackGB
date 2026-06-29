-- 009_pin_only_auth.sql
-- PIN-only authentication redesign.
--
-- Goals:
--   1. Login becomes "enter 6-digit PIN" only — no user/store selector.
--   2. The PIN identifies a SINGLE user row (so audit knows "who").
--   3. Per-store sellers (the Excel seed) collapse to one user-row per
--      store; both sellers at one store share the store's PIN. Audit
--      records the action against the store, not against an individual
--      seller (this is acceptable per product requirement).
--   4. New role `super_admin` (1 person) sits above `admin` (3 people).
--   5. Bcrypt hashes are still stored, but uniqueness is enforced
--      *logically* inside `set_user_pin` (you can't add a UNIQUE index
--      on the hash because bcrypt salts are random).
--
-- Backwards compatibility:
--   * Old `verify_pin(uuid, text)` keeps existing behaviour and remains
--     callable; the API just stops using it. We don't drop it so that
--     audit-log / FK references survive.
--   * Old seeded users (Галя Балувана, Продавчиня — Кварц / — Шкільна
--     / — Герцена) are **deactivated** (is_active = false), not deleted,
--     so audit_log FKs stay clean.
--
-- Apply order:
--   schema.sql → 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 (THIS).

set search_path = feedbackgb, public, pg_catalog;

-- 1. Schema additions ---------------------------------------------------

-- 1a. Allow `super_admin` role.
alter table feedbackgb.users
  drop constraint if exists users_role_check;
alter table feedbackgb.users
  add constraint users_role_check
  check (role in ('seller', 'admin', 'super_admin'));

-- 1b. `display_label` — canonical human-readable label shown in admin UI
--     (audit log, /admin/users, etc.). For per-store sellers it carries
--     the Excel store name even when categories.spots FK is NULL.
alter table feedbackgb.users
  add column if not exists display_label text;

-- 2. PIN uniqueness + 6-digit enforcement -------------------------------

-- 2a. Tighten `set_user_pin`:
--     * exactly 6 digits (was 6-8)
--     * reject if any OTHER active user already has this PIN
--       (collision detection — the Excel seed assigns 23 unique PINs;
--        future operator-driven PIN rotations must keep that invariant).
create or replace function feedbackgb.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
declare
  collision_user uuid;
begin
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

  -- Linear scan over active users with a non-null hash. Fine at our
  -- scale (~27 rows). Each row costs one bcrypt verify (~1-3ms).
  select id into collision_user
    from feedbackgb.users
   where is_active
     and pin_hash is not null
     and id <> p_user_id
     and pin_hash = crypt(p_pin, pin_hash)
   limit 1;

  if collision_user is not null then
    raise exception 'PIN collision: this PIN is already used by user %', collision_user
      using errcode = 'unique_violation';
  end if;

  update feedbackgb.users
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         failed_attempts = 0,
         locked_until = null
   where id = p_user_id;

  if not found then
    raise exception 'user % not found', p_user_id;
  end if;
end $$;

-- 3. verify_pin_global(pin) — the new login entry point -----------------
-- Returns the matching user row, or NULL if no active user matches /
-- input is malformed / multiple matches (defense-in-depth: should be
-- impossible because set_user_pin enforces uniqueness, but we fail
-- closed instead of picking one arbitrarily).
create or replace function feedbackgb.verify_pin_global(p_pin text)
returns feedbackgb.users
language plpgsql
security definer
set search_path = feedbackgb, extensions, public, pg_catalog
as $$
declare
  u           feedbackgb.users;
  match_count int := 0;
  matched     feedbackgb.users;
begin
  if p_pin is null or p_pin !~ '^\d{6}$' then
    return null;
  end if;

  for u in
    select * from feedbackgb.users
     where is_active
       and pin_hash is not null
       and (locked_until is null or locked_until <= now())
  loop
    if u.pin_hash = crypt(p_pin, u.pin_hash) then
      match_count := match_count + 1;
      matched := u;
      if match_count > 1 then
        -- Ambiguous: two active users share the same PIN. Refuse to
        -- log either one in. set_user_pin should prevent this from
        -- ever happening, so this branch is purely belt-and-suspenders.
        return null;
      end if;
    end if;
  end loop;

  if match_count = 0 then
    return null;
  end if;

  -- On match: bump last_login + clear failure counters.
  update feedbackgb.users
     set last_login = now(),
         failed_attempts = 0,
         locked_until = null
   where id = matched.id
  returning * into matched;

  return matched;
end $$;

-- Lock down: only service_role calls these.
revoke all on function feedbackgb.set_user_pin(uuid, text)        from public;
revoke all on function feedbackgb.verify_pin_global(text)         from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function feedbackgb.set_user_pin(uuid, text)        from anon, authenticated';
    execute 'revoke all on function feedbackgb.verify_pin_global(text)         from anon, authenticated';
    execute 'grant execute on function feedbackgb.set_user_pin(uuid, text)        to service_role';
    execute 'grant execute on function feedbackgb.verify_pin_global(text)         to service_role';
  end if;
end $$;

-- 4. Reseed users from the Excel sheet ---------------------------------
-- Strategy:
--   * Deactivate every existing user so old PINs stop working.
--   * Insert one row per Excel store + four admin placeholder rows.
--   * Map Excel store name -> categories.spots(spot_id) by case- and
--     whitespace-insensitive name match. NULL FK is allowed (we keep
--     `display_label` as a fallback for the admin UI).
--   * Rows start with pin_hash = NULL — operator must call
--     `feedbackgb.set_user_pin(<uuid>, '<6-digit-pin>')` from the SQL
--     Editor to issue PINs (the 23 store PINs + 4 admin PINs come
--     from the operator out-of-band).
--   * Idempotent: re-running this migration will not create duplicates
--     because of the WHERE NOT EXISTS guard on display_label.

-- 4a. Deactivate the old seed (don't delete — audit_log FKs reference these).
update feedbackgb.users
   set is_active = false,
       pin_hash = null
 where full_name in (
   'Галя Балувана',
   'Продавчиня — Кварц',
   'Продавчиня — Шкільна',
   'Продавчиня — Герцена'
 );

-- 4b. Insert 23 store rows from the Excel sheet.
do $$
declare
  rec             record;
  matched_spot    int;
  full_label      text;
  matched_count   int := 0;
  unmatched_count int := 0;
begin
  for rec in
    select * from (values
      (1,  'ЕНТУЗІАСТІВ', 'Дощівник-Губка Христина / Цюпа Наталія'),
      (2,  'ГЕРОЇВ М.',   'Триколич Ольга'),
      (3,  'ПРОСПЕКТ',    'Лєснік Наталія / Бабій Олена'),
      (4,  'ГРАВІТОН',    'Пашуляк Ніколетта / Унгурян Наталія'),
      (5,  'КВАРЦ',       'Пашник Яна / Юзбашієва Наталія'),
      (6,  'РУСЬКА',      'Жучок Марина / Чорна Аліна'),
      (7,  'ГЕРЦЕНА',     'Журавель Наталія / Іванова Надія'),
      (8,  'КОМАРОВА',    'Черненко Анастасія / Матіос Юлія'),
      (9,  'САДГОРА',     'Мостолюк Тетяна / Орищук Ірина'),
      (10, 'СТОРОЖИНЕЦЬ', 'Гонтар Інна / Ставнецька Людмила'),
      (11, 'ЧЕРЕМОШ',     'Маланюк Лариса / Морошан Марія'),
      (12, 'КИЇВ',        'Балцан Ірина / Фефчак Юлія'),
      (13, 'РІВНЕНСЬКА',  'Добровольська Інна / Бебич Інна'),
      (14, 'САДОВА',      'Мельничук Крістіна / Ротар Катерина'),
      (15, 'ШКІЛЬНА',     'Сергієнко Юлія / Пантя Тетяна'),
      (16, 'ХОТИНСЬКА',   'Лакуста Аліна / Скорейко Яна'),
      (17, 'МІКРОРАЙОН',  'Берестова Надія / Шеремет Тетяна'),
      (18, 'БУЛЬВАР',     'Козьмій Сніжана / Ковальчук Роман'),
      (19, 'КВАРТАЛ',     'Ковтун Катя / Голубашенко Наталія'),
      (20, 'БІЛОРУСЬКА',  'Войтюк Олена / Супчинська Тетяна'),
      (21, 'КЛУБ',        'Алексюк Юлія / Сирбу Ліліана'),
      (22, 'РОША',        'Задорожна Анастасія / Назарова Світлана'),
      (23, 'КОМПАС',      'Крисько Марія / Крисько Анастасія')
    ) as t(excel_idx, store_name, sellers)
    order by excel_idx
  loop
    full_label := format('Магазин %s — %s', rec.excel_idx, rec.store_name);

    select s.spot_id
      into matched_spot
      from categories.spots s
     where lower(trim(s.name)) = lower(trim(rec.store_name))
       and s.is_deleted = false
     order by s.spot_id
     limit 1;

    if matched_spot is not null then
      matched_count := matched_count + 1;
    else
      unmatched_count := unmatched_count + 1;
      raise notice '[009] no categories.spots match for "%": store_id will be NULL', rec.store_name;
    end if;

    if not exists (select 1 from feedbackgb.users where display_label = full_label) then
      insert into feedbackgb.users (full_name, role, store_id, display_label, is_active)
      values (
        format('%s (%s)', full_label, rec.sellers),
        'seller',
        matched_spot,
        full_label,
        true
      );
    end if;

    matched_spot := null;  -- reset between iterations
  end loop;

  raise notice '[009] reseed: % stores matched, % unmatched (FK NULL)',
    matched_count, unmatched_count;
end $$;

-- 4c. Insert 4 admin placeholders (3 admin + 1 super_admin).
--     PINs are NULL; operator sets them via set_user_pin(<uuid>, '<6-digit>').
do $$
begin
  if not exists (select 1 from feedbackgb.users where display_label = 'Адмін 1') then
    insert into feedbackgb.users (full_name, role, store_id, display_label, is_active)
    values ('Адмін 1', 'admin', null, 'Адмін 1', true);
  end if;
  if not exists (select 1 from feedbackgb.users where display_label = 'Адмін 2') then
    insert into feedbackgb.users (full_name, role, store_id, display_label, is_active)
    values ('Адмін 2', 'admin', null, 'Адмін 2', true);
  end if;
  if not exists (select 1 from feedbackgb.users where display_label = 'Адмін 3') then
    insert into feedbackgb.users (full_name, role, store_id, display_label, is_active)
    values ('Адмін 3', 'admin', null, 'Адмін 3', true);
  end if;
  if not exists (select 1 from feedbackgb.users where display_label = 'Супер-адмін') then
    insert into feedbackgb.users (full_name, role, store_id, display_label, is_active)
    values ('Супер-адмін', 'super_admin', null, 'Супер-адмін', true);
  end if;
end $$;

-- 5. Refresh v_login_users so the legacy /api/auth/users endpoint keeps
--    rendering display_label (used in admin UI dropdowns) without
--    leaking inactive rows. The webapp /login PIN-pad no longer uses
--    this endpoint at all.
create or replace view feedbackgb.v_login_users as
  select id,
         coalesce(display_label, full_name) as full_name,
         role,
         store_id
    from feedbackgb.users
   where is_active
   order by display_label asc, full_name asc;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant select on feedbackgb.v_login_users to service_role';
  end if;
end $$;

-- =============================================================================
-- After applying:
--   1. Sanity check the new rows:
--        select id, display_label, role, store_id, pin_hash is not null as has_pin
--          from feedbackgb.users
--         where is_active
--         order by role, display_label;
--   2. Issue PINs (operator runs out-of-band — PINs come via the secure
--      delivery channel from Devin):
--        select feedbackgb.set_user_pin(
--          (select id from feedbackgb.users where display_label = 'Магазин 1 — ЕНТУЗІАСТІВ'),
--          '110426'
--        );
--        ... (repeat for each store + admin)
--   3. Verify login-by-PIN works:
--        select (feedbackgb.verify_pin_global('110426')).display_label;
-- =============================================================================
