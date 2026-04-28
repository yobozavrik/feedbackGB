-- =============================================================================
-- Patch: fix pgcrypto search_path on verify_pin / set_user_pin
-- =============================================================================
-- On Supabase the `pgcrypto` extension is installed into the `extensions`
-- schema, not `public`. Our SECURITY DEFINER functions had `set search_path =
-- feedbackgb, public, pg_catalog` which left out `extensions`, so crypt() and
-- gen_salt() were not visible.
--
-- This patch:
--   1. Re-creates verify_pin / set_user_pin with `extensions` in search_path.
--   2. Re-seeds the admin + 3 sellers (idempotent — only inserts missing rows
--      whose pin_hash is now generated against the right crypt()).
-- =============================================================================

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
  for u in select * from feedbackgb.users where is_active loop
    if u.pin_hash = crypt(p_pin, u.pin_hash) then
      update feedbackgb.users set last_login = now() where id = u.id;
      return u;
    end if;
  end loop;
  return null;
end $$;

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

-- Re-seed (now using fully-qualified extensions.crypt / extensions.gen_salt
-- so this DO block also works regardless of search_path).
do $$
declare
  v_id uuid;
begin
  if not exists (select 1 from feedbackgb.users where full_name = 'Галя Балувана') then
    v_id := gen_random_uuid();
    insert into feedbackgb.users (id, full_name, pin_hash, role, store_id)
    values (v_id, 'Галя Балувана',
            extensions.crypt('1234', extensions.gen_salt('bf', 10)),
            'admin', null);
  else
    update feedbackgb.users
       set pin_hash = extensions.crypt('1234', extensions.gen_salt('bf', 10))
     where full_name = 'Галя Балувана';
  end if;

  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Кварц') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Кварц',
            extensions.crypt('1111', extensions.gen_salt('bf', 10)), 'seller', 1);
  else
    update feedbackgb.users set pin_hash = extensions.crypt('1111', extensions.gen_salt('bf', 10))
     where full_name = 'Продавчиня — Кварц';
  end if;

  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Шкільна') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Шкільна',
            extensions.crypt('2222', extensions.gen_salt('bf', 10)), 'seller', 2);
  else
    update feedbackgb.users set pin_hash = extensions.crypt('2222', extensions.gen_salt('bf', 10))
     where full_name = 'Продавчиня — Шкільна';
  end if;

  if not exists (select 1 from feedbackgb.users where full_name = 'Продавчиня — Герцена') then
    insert into feedbackgb.users (full_name, pin_hash, role, store_id)
    values ('Продавчиня — Герцена',
            extensions.crypt('3333', extensions.gen_salt('bf', 10)), 'seller', 3);
  else
    update feedbackgb.users set pin_hash = extensions.crypt('3333', extensions.gen_salt('bf', 10))
     where full_name = 'Продавчиня — Герцена';
  end if;
end $$;

-- Sanity check (should print 'Галя Балувана')
-- select (feedbackgb.verify_pin('1234')).full_name;
