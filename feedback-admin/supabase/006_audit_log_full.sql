-- 006_audit_log_full.sql
-- Generalize audit_log so it can record auth + admin events as well as the
-- existing feedback-table changes from the BEFORE/AFTER trigger.
--
-- Backwards compatible: existing rows keep working, the feedback trigger
-- keeps writing the same shape (just with a renamed action prefix), and
-- new columns are nullable.

set search_path = feedbackgb, public;

-- 1. New columns ---------------------------------------------------------
alter table feedbackgb.audit_log
  add column if not exists actor_user_id  uuid       references feedbackgb.users(id) on delete set null,
  add column if not exists target_user_id uuid       references feedbackgb.users(id) on delete set null,
  add column if not exists target_type    text,
  add column if not exists ip             inet,
  add column if not exists user_agent     text,
  add column if not exists meta           jsonb;

-- Index for chronological browsing in the admin UI (most-recent-first scan).
create index if not exists audit_log_occurred_at_idx
  on feedbackgb.audit_log (occurred_at desc);

-- Index for "show me everything user X did".
create index if not exists audit_log_actor_user_idx
  on feedbackgb.audit_log (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

-- 2. Update the feedback trigger to use action='feedback.<verb>' so that
--    auth/admin events written by the API code path don't collide.
create or replace function feedbackgb.audit_feedback()
returns trigger as $$
declare
  d jsonb;
  who text;
  who_uid uuid;
begin
  -- app.actor is set per-request by the API to the authenticated user's UUID.
  who := coalesce(
    nullif(current_setting('app.actor', true), ''),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub',
    'service_role'
  );
  begin
    who_uid := nullif(who, 'service_role')::uuid;
  exception when others then
    who_uid := null;
  end;

  if TG_OP = 'INSERT' then
    insert into feedbackgb.audit_log
      (feedback_id, action, actor, actor_user_id, target_type,
       meta)
    values (NEW.id, 'feedback.insert', who, who_uid, 'feedback',
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
      insert into feedbackgb.audit_log
        (feedback_id, action, actor, actor_user_id, target_type,
         diff, meta)
      values (NEW.id,
              case when NEW.status is distinct from OLD.status
                   then 'feedback.status_change' else 'feedback.update' end,
              who, who_uid, 'feedback', d, d);
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    insert into feedbackgb.audit_log
      (feedback_id, action, actor, actor_user_id, target_type, meta)
    values (OLD.id, 'feedback.delete', who, who_uid, 'feedback',
            jsonb_build_object('id', OLD.id));
    return OLD;
  end if;
  return null;
end $$ language plpgsql;

-- 3. Permissions: service_role does the writes (BYPASSRLS already), but we
--    grant explicit insert so future direct PostgREST callers work too.
grant insert, select on feedbackgb.audit_log to service_role;

-- 4. Human-readable view for the /admin/audit UI.
create or replace view feedbackgb.v_audit_log as
  select
    a.id,
    a.occurred_at,
    a.action,
    case
      when a.action like 'auth.%'      then '🔑 Авторизація'
      when a.action like 'feedback.%'  then '📝 Фідбек'
      when a.action like 'admin.%'     then '🛠 Адмін'
      else                                  '·'
    end                                              as section,
    case a.action
      when 'auth.login.success'        then 'Вхід'
      when 'auth.login.failure'        then 'Невдалий вхід'
      when 'auth.logout'               then 'Вихід'
      when 'feedback.insert'           then 'Додано фідбек'
      when 'feedback.update'           then 'Оновлено фідбек'
      when 'feedback.status_change'    then 'Зміна статусу'
      when 'feedback.delete'           then 'Видалено фідбек'
      when 'admin.user.pin_reset'      then 'PIN перевидано'
      when 'admin.user.unlock'         then 'Розблоковано'
      when 'admin.send_report'         then 'Telegram-звіт надіслано'
      when 'admin.mirror_to_drive'     then 'Бекап у Drive'
      else a.action
    end                                              as action_title,
    a.actor_user_id,
    actor.full_name                                  as actor_full_name,
    actor.role                                       as actor_role,
    a.target_user_id,
    target.full_name                                 as target_full_name,
    a.target_type,
    a.feedback_id,
    a.ip,
    a.user_agent,
    a.meta,
    a.diff
  from feedbackgb.audit_log a
  left join feedbackgb.users actor  on actor.id  = a.actor_user_id
  left join feedbackgb.users target on target.id = a.target_user_id
  order by a.occurred_at desc;

comment on view feedbackgb.v_audit_log is
  '🔍 Журнал усіх дій у системі — авторизація, фідбеки, адмін-дії (з людиночитаними назвами)';

grant select on feedbackgb.v_audit_log to service_role;
