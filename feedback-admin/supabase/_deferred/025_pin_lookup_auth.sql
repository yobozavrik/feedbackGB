-- ОТЛОЖЕНО. НЕ ПРИМЕНЯТЬ НИ К ОДНОЙ БАЗЕ. Вход по PIN оставлен прежним (решение владельца 2026-09-15).
-- Внимание: уже применена к рабочей базе 2026-09-15; добавленные объекты не используются кодом.
--
-- PIN-only authentication transition (plan B).
--
-- PIN lookup values are HMAC-SHA256(PIN, PIN_PEPPER), calculated only in the
-- app process. The pepper is never stored in Postgres. `pin_hash` remains the
-- bcrypt credential and is still verified after indexed lookup.
--
-- Deployment order:
--   1. Set the same PIN_PEPPER (>=32 random bytes) in both applications.
--   2. Apply this migration.
--   3. Deploy both applications from the matching commit.
-- Legacy rows are populated lazily at successful login or when an admin
-- resets a PIN. Do not remove verify_pin_global until the readback query in
-- PHOTO_REPORT_REMEDIATION_EXECUTION_2026-09-15.md reports zero NULL rows.

set search_path = feedbackgb, public, pg_catalog;

alter table feedbackgb.users
  add column if not exists pin_lookup bytea;

create unique index if not exists users_pin_lookup_unique_active_idx
  on feedbackgb.users (pin_lookup)
  where is_active and pin_lookup is not null;

create or replace function feedbackgb.verify_pin_lookup(
  p_pin_lookup_hex text,
  p_pin text
)
returns feedbackgb.users
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
as $$
declare
  matched feedbackgb.users;
begin
  if p_pin is null or p_pin !~ '^\d{6}$'
     or p_pin_lookup_hex is null or p_pin_lookup_hex !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into matched
    from feedbackgb.users
   where is_active
     and pin_hash is not null
     and pin_lookup = decode(p_pin_lookup_hex, 'hex')
     and (locked_until is null or locked_until <= now())
   limit 1;

  if not found or matched.pin_hash <> crypt(p_pin, matched.pin_hash) then
    return null;
  end if;

  update feedbackgb.users
     set last_login = now(), failed_attempts = 0, locked_until = null
   where id = matched.id
  returning * into matched;
  return matched;
end $$;

-- Used only after the legacy verifier has positively authenticated the PIN.
-- It cannot assign a lookup key without proving possession of the PIN again.
create or replace function feedbackgb.backfill_pin_lookup(
  p_user_id uuid,
  p_pin text,
  p_pin_lookup_hex text
)
returns boolean
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
as $$
declare
  updated_count integer;
begin
  if p_pin is null or p_pin !~ '^\d{6}$'
     or p_pin_lookup_hex is null or p_pin_lookup_hex !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update feedbackgb.users
     set pin_lookup = decode(p_pin_lookup_hex, 'hex')
   where id = p_user_id
     and is_active
     and pin_hash is not null
     and pin_hash = crypt(p_pin, pin_hash)
     and (pin_lookup is null or pin_lookup = decode(p_pin_lookup_hex, 'hex'));
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end $$;

create or replace function feedbackgb.set_user_pin(
  p_user_id uuid,
  p_pin text,
  p_pin_lookup_hex text
)
returns void
language plpgsql
security definer
set search_path = feedbackgb, extensions, household_chemicals, public, pg_catalog
as $$
begin
  if p_pin is null or p_pin !~ '^\d{6}$' then
    raise exception 'PIN must be exactly 6 digits';
  end if;
  if p_pin_lookup_hex is null or p_pin_lookup_hex !~ '^[0-9a-f]{64}$' then
    raise exception 'PIN lookup must be a SHA-256 hex digest';
  end if;

  update feedbackgb.users
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)),
         pin_lookup = decode(p_pin_lookup_hex, 'hex'),
         failed_attempts = 0,
         locked_until = null
   where id = p_user_id;
  if not found then
    raise exception 'user % not found', p_user_id;
  end if;
end $$;

revoke all on function feedbackgb.verify_pin_lookup(text, text) from public, anon, authenticated;
revoke all on function feedbackgb.backfill_pin_lookup(uuid, text, text) from public, anon, authenticated;
revoke all on function feedbackgb.set_user_pin(uuid, text, text) from public, anon, authenticated;
grant execute on function feedbackgb.verify_pin_lookup(text, text) to service_role;
grant execute on function feedbackgb.backfill_pin_lookup(uuid, text, text) to service_role;
grant execute on function feedbackgb.set_user_pin(uuid, text, text) to service_role;
