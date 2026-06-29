-- 007_feedback_lifecycle.sql
-- Adds explicit "assignee" semantics to feedback so admins can claim items
-- and the UI can show a "Моя черга" view. Backwards compatible: rows that
-- existed before this migration get assigned_to = NULL and continue to work.
--
-- Changes:
--   1. feedback.assigned_to (uuid, FK users) — who is currently working on
--      this feedback. Distinct from resolved_by, which is filled in only
--      when status moves to 'resolved'.
--   2. Index on assigned_to (partial — only non-null) for "my queue" lookup.
--   3. feedback_feed view extended with assigned_to + assigned_full_name.
--   4. audit_feedback trigger now records assigned_to changes alongside
--      status / summary changes, so the journal answers "who took it".
--
-- This migration does NOT widen the status enum (still
-- new/in_progress/resolved/rejected). The earlier UI label "Дубль" was a
-- mismatch and is fixed in the client code.

set search_path = feedbackgb, public;

-- 1. New column ----------------------------------------------------------
alter table feedbackgb.feedback
  add column if not exists assigned_to uuid references feedbackgb.users(id) on delete set null;

create index if not exists feedback_assigned_idx
  on feedbackgb.feedback (assigned_to)
  where assigned_to is not null;

-- 2. View ---------------------------------------------------------------
-- CREATE OR REPLACE: PostgreSQL allows appending columns at the end of an
-- existing view definition without dropping dependent objects.
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
    f.product_id,
    p.name         as product_name,
    p.unit         as product_unit,
    f.quantity,
    f.photo_url,
    f.tg_user_id,
    f.tg_username,
    f.tg_display_name,
    f.tg_verified,
    f.summary,
    f.status,
    f.resolved_at,
    f.resolved_by,
    f.assigned_to,
    a.full_name    as assigned_full_name
  from feedbackgb.feedback f
  left join feedbackgb.categories c on c.id = f.category
  left join categories.spots      s on s.spot_id = f.store_id
  left join feedbackgb.users      u on u.id = f.user_id
  left join feedbackgb.users      a on a.id = f.assigned_to
  left join categories.products   p on p.id = f.product_id;

-- 3. Audit trigger ------------------------------------------------------
-- Same pattern as 006: record diff for status / summary / assigned_to.
create or replace function feedbackgb.audit_feedback()
returns trigger as $$
declare
  d jsonb;
  who text;
  who_uid uuid;
begin
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
      (feedback_id, action, actor, actor_user_id, target_type, meta)
    values (NEW.id, 'feedback.insert', who, who_uid, 'feedback',
            jsonb_build_object('category', NEW.category, 'store_id', NEW.store_id));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    d := '{}'::jsonb;
    if NEW.status is distinct from OLD.status then
      d := d || jsonb_build_object('status', jsonb_build_array(OLD.status, NEW.status));
    end if;
    if NEW.assigned_to is distinct from OLD.assigned_to then
      d := d || jsonb_build_object('assigned_to',
        jsonb_build_array(OLD.assigned_to, NEW.assigned_to));
    end if;
    if NEW.summary is distinct from OLD.summary then
      d := d || jsonb_build_object('summary_changed', true);
    end if;
    if d <> '{}'::jsonb then
      insert into feedbackgb.audit_log
        (feedback_id, action, actor, actor_user_id, target_type, diff, meta)
      values (NEW.id,
              case
                when NEW.status is distinct from OLD.status      then 'feedback.status_change'
                when NEW.assigned_to is distinct from OLD.assigned_to then 'feedback.assign'
                else 'feedback.update'
              end,
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
