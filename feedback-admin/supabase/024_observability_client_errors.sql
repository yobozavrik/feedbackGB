-- Makes browser crashes easy to find in /admin/audit.
-- Runtime request logs themselves stay in Vercel; audit_log stores durable
-- business events and client-side failures without request bodies or secrets.

set search_path = feedbackgb, public;

create index if not exists audit_log_action_occurred_at_idx
  on feedbackgb.audit_log (action, occurred_at desc);

create or replace view feedbackgb.v_audit_log as
  select
    a.id,
    a.occurred_at,
    a.action,
    case
      when a.action like 'auth.%'     then 'auth'
      when a.action like 'feedback.%' then 'feedback'
      when a.action like 'admin.%'    then 'admin'
      when a.action like 'client.%'   then 'system'
      else                                 'system'
    end as section,
    case a.action
      when 'auth.login.success'       then 'Вхід'
      when 'auth.login.failure'       then 'Невдалий вхід'
      when 'auth.logout'              then 'Вихід'
      when 'feedback.insert'          then 'Додано фідбек'
      when 'feedback.update'          then 'Оновлено фідбек'
      when 'feedback.status_change'   then 'Зміна статусу'
      when 'feedback.delete'          then 'Видалено фідбек'
      when 'admin.user.pin_reset'     then 'PIN перевидано'
      when 'admin.user.unlock'        then 'Розблоковано'
      when 'admin.send_report'        then 'Telegram-звіт надіслано'
      when 'admin.mirror_to_drive'    then 'Бекап у Drive'
      when 'client.error'             then 'Помилка застосунку'
      else a.action
    end as action_title,
    a.actor_user_id,
    actor.full_name as actor_full_name,
    actor.role as actor_role,
    a.target_user_id,
    target.full_name as target_full_name,
    a.target_type,
    a.feedback_id,
    a.ip,
    a.user_agent,
    a.meta,
    a.diff
  from feedbackgb.audit_log a
  left join feedbackgb.users actor on actor.id = a.actor_user_id
  left join feedbackgb.users target on target.id = a.target_user_id
  order by a.occurred_at desc;

grant select on feedbackgb.v_audit_log to service_role;
