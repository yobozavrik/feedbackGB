-- 027_restore_set_user_pin.sql
-- Restores set_user_pin(uuid, text) after 026 replaced it with a stub that
-- always raised, which broke PIN reset and user creation in the live admin.
--
-- ALREADY EXECUTED by the owner on the live database 2026-09-15 ~17:44 UTC.
-- Do not apply again. Kept here so the repository matches the database.
--
-- Body is identical to 017_fix_pgcrypto_search_path.sql. Grants are attached
-- to the function signature and survive CREATE OR REPLACE.

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
