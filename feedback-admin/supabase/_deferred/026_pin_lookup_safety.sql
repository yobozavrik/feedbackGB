-- ОТЛОЖЕНО. НЕ ПРИМЕНЯТЬ НИ К ОДНОЙ БАЗЕ. 026 ломает смену PIN в действующей админке.
-- Уже применялась к рабочей базе 2026-09-15; set_user_pin(uuid,text) восстановлена миграцией 027.
--
-- Safety fixes required before enabling plan-B PIN lookup for real users.
set search_path = feedbackgb, public, pg_catalog;

create or replace function feedbackgb.get_rate_limit_status(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language sql
security definer
set search_path = feedbackgb, public, pg_catalog
as $$
  with active_hits as (
    select h from feedbackgb.rate_limits r, unnest(r.hits) h
     where r.key = p_key
       and h > now() - make_interval(secs => greatest(1, p_window_seconds))
  ), summary as (
    select count(*)::integer as hit_count, min(h) as first_hit from active_hits
  )
  select jsonb_build_object(
    'ok', hit_count < p_limit,
    'remaining', greatest(0, p_limit - hit_count),
    'reset_ms', case when first_hit is null then 0 else greatest(0, extract(epoch from (first_hit + make_interval(secs => greatest(1, p_window_seconds)) - now()))::integer * 1000) end
  ) from summary;
$$;

grant execute on function feedbackgb.get_rate_limit_status(text, integer, integer) to service_role;
revoke all on function feedbackgb.get_rate_limit_status(text, integer, integer) from public, anon, authenticated;

-- The three-argument version must reject a collision with both migrated and
-- legacy (pin_lookup IS NULL) users. The partial unique index alone cannot
-- see legacy rows.
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
  if p_pin is null or p_pin !~ '^\d{6}$' then raise exception 'PIN must be exactly 6 digits'; end if;
  if p_pin_lookup_hex is null or p_pin_lookup_hex !~ '^[0-9a-f]{64}$' then raise exception 'PIN lookup must be a SHA-256 hex digest'; end if;
  if exists (
    select 1 from feedbackgb.users u
     where u.id <> p_user_id and u.is_active and u.pin_hash is not null
       and (u.pin_lookup = decode(p_pin_lookup_hex, 'hex')
            or (u.pin_lookup is null and u.pin_hash = crypt(p_pin, u.pin_hash)))
  ) then
    raise exception 'PIN collision: this PIN is already used by another active user' using errcode = 'unique_violation';
  end if;
  update feedbackgb.users
     set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_lookup = decode(p_pin_lookup_hex, 'hex'), failed_attempts = 0, locked_until = null
   where id = p_user_id;
  if not found then raise exception 'user % not found', p_user_id; end if;
end $$;

-- Explicitly retire the dangerous legacy overload. It remains discoverable
-- only to return a clear error, rather than silently leaving a stale key.
create or replace function feedbackgb.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = feedbackgb, public, pg_catalog
as $$ begin
  raise exception 'set_user_pin(uuid,text) is retired; deploy the application and use set_user_pin(uuid,text,text)' using errcode = 'feature_not_supported';
end $$;

revoke all on function feedbackgb.set_user_pin(uuid, text) from public, anon, authenticated;
grant execute on function feedbackgb.set_user_pin(uuid, text) to service_role;
