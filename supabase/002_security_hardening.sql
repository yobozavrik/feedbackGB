-- =============================================================================
-- 002 Security hardening — apply ONCE on top of an existing feedbackGB install
-- =============================================================================
-- This migration:
--   1. Drops the anon/authenticated execute-grants on feedbackgb.* functions.
--   2. Replaces verify_pin(text) -> verify_pin(uuid, text) so login no longer
--      linear-scans bcrypt over every active user (and so two users sharing
--      the same PIN can't impersonate each other).
--   3. Blanks out every existing pin_hash and failed_attempts state — you MUST
--      call feedbackgb.set_user_pin(<uuid>, '<6-8 digit pin>') for every
--      active user after running this file.
--   4. Adds failed_attempts / locked_until columns driving server-side
--      lockout inside verify_pin.
--   5. Flips the feedback-photos bucket to private (admin UI now generates
--      short-lived signed URLs). If you're relying on public URLs stored in
--      feedbackgb.feedback.photo_url, re-upload with `select feedbackgb.*` or
--      leave the bucket public via Studio after reviewing.
--   6. Updates the audit trigger to read `app.actor` (set per-request by the
--      API) so audit_log is no longer a flat line of "service_role".
--
-- Apply in SQL Editor (service_role). Safe to re-run.
-- =============================================================================

-- 1. Revoke anon/authenticated access to every function in the schema.
do $$
declare
  r record;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    for r in
      select p.oid::regprocedure::text as sig
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'feedbackgb'
    loop
      execute format('revoke all on function %s from public, anon, authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    end loop;
  end if;
end $$;

-- Also drop default-privilege grants to anon/authenticated so future
-- functions created in this schema don't inherit them.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema feedbackgb revoke select on tables from anon, authenticated';
    execute 'alter default privileges in schema feedbackgb revoke execute on functions from anon, authenticated';
  end if;
end $$;

-- 2. Add lockout columns.
alter table feedbackgb.users
  add column if not exists failed_attempts int not null default 0,
  add column if not exists locked_until timestamptz;

-- 3. Drop the old verify_pin(text) and create verify_pin(uuid, text).
drop function if exists feedbackgb.verify_pin(text);

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

-- 4. set_user_pin: require 6-digit minimum (old 4-digit seeds are now invalid).
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

-- Re-revoke + service_role grant on the replaced functions.
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

-- 5. Wipe all existing PINs so the committed 1234/1111/2222/3333 defaults stop
--    granting access. Operator must re-provision PINs via set_user_pin.
update feedbackgb.users
   set pin_hash = null,
       failed_attempts = 0,
       locked_until = null;

-- 6. Login-picker view.
create or replace view feedbackgb.v_login_users as
  select id, full_name, role, store_id
  from feedbackgb.users
  where is_active
  order by full_name asc;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'revoke all on feedbackgb.v_login_users from public';
    execute 'grant select on feedbackgb.v_login_users to service_role';
  end if;
end $$;

-- 7. Swap the audit trigger to read app.actor (set per-request by the API).
create or replace function feedbackgb.audit_feedback()
returns trigger as $$
declare
  d jsonb;
  who text;
begin
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

-- 8. Storage bucket: make private. If you need public photos, toggle manually
--    in Studio after reviewing.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='buckets') then
    update storage.buckets
       set public = false,
           allowed_mime_types = array['image/jpeg','image/png','image/webp'],
           file_size_limit = 5242880
     where id = 'feedback-photos';
  end if;
end $$;

-- =============================================================================
-- AFTER applying:
--   select id, full_name from feedbackgb.users order by full_name;
--   select feedbackgb.set_user_pin('<admin-uuid>',  '<6-8 digit pin>');
--   select feedbackgb.set_user_pin('<seller-uuid>', '<6-8 digit pin>');
--   select (feedbackgb.verify_pin('<uuid>', '<pin>')).full_name;  -- smoke test
-- =============================================================================
