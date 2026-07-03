-- 017_fix_pgcrypto_search_path.sql
-- Fix "function crypt(text, text) does not exist" on PIN login (both apps).
--
-- Root cause: this Postgres instance is shared with other, unrelated
-- projects. The `pgcrypto` extension (providing crypt()/gen_salt(), used
-- by PIN hashing) ended up installed in a schema belonging to one of those
-- other projects instead of the conventional `extensions` schema.
-- feedbackgb.verify_pin_global() and feedbackgb.set_user_pin() were
-- defined (009_pin_only_auth.sql) with
-- `set search_path = feedbackgb, extensions, public, pg_catalog`, which
-- does not include that schema — so crypt()/gen_salt() fail to resolve
-- inside those functions, even though `service_role`'s own search_path
-- was separately fixed.
--
-- Fix: add that schema to these two functions' own SET search_path
-- clause. This is scoped to feedbackgb's own functions only — it does not
-- touch the pgcrypto extension itself or any other project's schema/role,
-- so there is no risk to any other project sharing this instance.
--
-- Function bodies are otherwise byte-for-byte identical to
-- 009_pin_only_auth.sql — only the SET search_path clause changed.

set search_path = feedbackgb, public, pg_catalog;

create or replace function feedbackgb.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
as $$
declare
  collision_user uuid;
begin
  if p_pin !~ '^\d{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;

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

create or replace function feedbackgb.verify_pin_global(p_pin text)
returns feedbackgb.users
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
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

-- Grants are unaffected by CREATE OR REPLACE (they stick to the function
-- signature), but re-assert them defensively in case this is ever run
-- against a fresh function oid.
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
