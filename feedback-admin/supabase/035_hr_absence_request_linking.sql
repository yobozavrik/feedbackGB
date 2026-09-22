-- 035_hr_absence_request_linking.sql
--
-- Links seller HR requests to approved absences and makes active absences a
-- scheduling constraint. This migration is forward-only: do not edit 031-034.
-- Apply to staging first. No existing HR request is changed by this migration.

begin;

alter table feedbackgb.employee_absences
  add column if not exists source_feedback_id uuid
    references feedbackgb.feedback(id) on delete restrict;

create unique index if not exists employee_absences_source_feedback_id_key
  on feedbackgb.employee_absences (source_feedback_id)
  where source_feedback_id is not null;

-- Append the source column without reordering the existing 033 view contract.
create or replace view feedbackgb.v_employee_absences as
select
  a.id, a.employee_id, u.full_name as employee_full_name, u.display_label as employee_display_label,
  a.store_id, s.name as store_name, a.absence_type, a.starts_on, a.ends_on, a.status, a.note,
  a.cancel_reason, a.row_version, a.created_at, a.updated_at,
  a.source_feedback_id
from feedbackgb.employee_absences a
join feedbackgb.users u on u.id = a.employee_id
left join feedbackgb.v_stores s on s.id = a.store_id;

-- Only the four first-version workflow topics belong to the HR Kanban.
-- Resignation deliberately remains in the general feedback feed.
create or replace view feedbackgb.v_hr_absence_requests as
select
  f.id as feedback_id,
  f.created_at as requested_at,
  f.updated_at,
  f.status as feedback_status,
  f.assigned_to,
  assignee.full_name as assigned_full_name,
  f.resolved_at,
  f.resolved_by,
  f.user_id as employee_id,
  employee.full_name as employee_full_name,
  employee.display_label as employee_display_label,
  f.store_id as requested_store_id,
  requested_store.name as requested_store_name,
  f.fields ->> 'hr_topic' as hr_topic,
  f.fields ->> 'date_from' as requested_date_from,
  -- For an open sick leave, the approval may supply the end date. Keep the
  -- original payload untouched but expose that approved end to month filters.
  coalesce(nullif(f.fields ->> 'date_to', ''), a.ends_on::text) as requested_date_to,
  f.fields ->> 'target_store_name' as target_store_name,
  case
    when coalesce(f.fields ->> 'target_store_id', '') ~ '^\d+$'
      then (f.fields ->> 'target_store_id')::integer
    else null
  end as target_store_id,
  f.fields ->> 'comment' as requester_comment,
  f.photo_url,
  f.fields -> 'photo_urls' as photo_urls,
  a.id as absence_id,
  a.status as absence_status,
  a.absence_type,
  a.starts_on as absence_starts_on,
  a.ends_on as absence_ends_on
from feedbackgb.feedback f
join feedbackgb.users employee on employee.id = f.user_id
left join feedbackgb.users assignee on assignee.id = f.assigned_to
left join categories.spots requested_store on requested_store.spot_id = f.store_id
left join feedbackgb.employee_absences a on a.source_feedback_id = f.id
where f.category = 'hr_question'
  and f.fields ->> 'hr_topic' in ('vacation', 'day-off', 'sick-leave', 'transfer');

-- Keep the manual path safe too. The original 033 trigger checked seller role
-- but allowed an inactive seller; replacing the function is forward-only.
create or replace function feedbackgb.validate_employee_absence()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
declare
  v_user feedbackgb.users;
begin
  select * into v_user from feedbackgb.users where id = new.employee_id;
  if not found or v_user.role <> 'seller' or v_user.is_active = false then
    raise exception 'absence employee must be an active seller';
  end if;
  if tg_op = 'INSERT' and new.store_id is null then
    new.store_id := v_user.store_id;
  end if;
  return new;
end;
$$;

-- Approve locks the request row before reading it. This is the concurrency
-- lock for all topics, including transfer where no absence row is created.
create or replace function feedbackgb.approve_hr_absence_request(
  p_feedback_id uuid,
  p_actor_user_id uuid,
  p_note text default null,
  p_sick_ends_on date default null
)
returns table (
  feedback_id uuid,
  absence_id uuid,
  applicant_user_id uuid,
  topic text
)
language plpgsql
security definer
set search_path = feedbackgb, categories, pg_catalog
as $$
declare
  v_feedback feedbackgb.feedback;
  v_employee feedbackgb.users;
  v_actor feedbackgb.users;
  v_topic text;
  v_absence_type text;
  v_starts_on date;
  v_ends_on date;
  v_note text;
  v_absence_id uuid;
begin
  select * into v_actor from feedbackgb.users where id = p_actor_user_id;
  if not found or v_actor.is_active = false or v_actor.role not in ('admin', 'super_admin') then
    raise exception 'hr_request_actor_not_active_admin' using errcode = 'P0001';
  end if;

  select * into v_feedback
  from feedbackgb.feedback
  where id = p_feedback_id
  for update;

  if not found then
    raise exception 'hr_request_not_found' using errcode = 'P0001';
  end if;

  v_topic := v_feedback.fields ->> 'hr_topic';
  if v_feedback.category <> 'hr_question'
    or v_topic not in ('vacation', 'day-off', 'sick-leave', 'transfer') then
    raise exception 'hr_request_topic_not_supported' using errcode = 'P0001';
  end if;

  if v_feedback.status not in ('new', 'in_progress') then
    raise exception 'hr_request_not_actionable' using errcode = 'P0001';
  end if;

  select * into v_employee
  from feedbackgb.users
  where id = v_feedback.user_id;
  if not found or v_employee.role <> 'seller' or v_employee.is_active = false then
    raise exception 'hr_request_employee_not_active_seller' using errcode = 'P0001';
  end if;

  if p_note is not null then
    v_note := nullif(trim(p_note), '');
    if v_note is not null and length(v_note) not between 3 and 500 then
      raise exception 'hr_request_invalid_note' using errcode = 'P0001';
    end if;
  end if;

  if v_topic = 'transfer' then
    update feedbackgb.feedback
    set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id,
      assigned_to = p_actor_user_id
    where id = v_feedback.id;

    return query select v_feedback.id, null::uuid, v_feedback.user_id, v_topic;
    return;
  end if;

  if v_feedback.store_id is null then
    raise exception 'hr_request_store_snapshot_missing' using errcode = 'P0001';
  end if;

  if coalesce(v_feedback.fields ->> 'date_from', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'hr_request_invalid_start_date' using errcode = 'P0001';
  end if;
  v_starts_on := (v_feedback.fields ->> 'date_from')::date;

  if v_topic = 'sick-leave' then
    if coalesce(v_feedback.fields ->> 'date_to', '') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_ends_on := (v_feedback.fields ->> 'date_to')::date;
    else
      v_ends_on := p_sick_ends_on;
    end if;
  else
    if coalesce(v_feedback.fields ->> 'date_to', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'hr_request_invalid_end_date' using errcode = 'P0001';
    end if;
    v_ends_on := (v_feedback.fields ->> 'date_to')::date;
  end if;

  if v_ends_on is null or v_ends_on < v_starts_on then
    raise exception 'hr_request_invalid_absence_period' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from feedbackgb.employee_absences
    where source_feedback_id = v_feedback.id
  ) then
    raise exception 'hr_request_already_approved' using errcode = 'P0001';
  end if;

  v_absence_type := case v_topic
    when 'vacation' then 'vacation'
    when 'day-off' then 'day_off'
    when 'sick-leave' then 'sick_leave'
  end;

  insert into feedbackgb.employee_absences (
    employee_id, store_id, absence_type, starts_on, ends_on, note,
    source_feedback_id, created_by, updated_by
  ) values (
    v_feedback.user_id, v_feedback.store_id, v_absence_type, v_starts_on, v_ends_on, v_note,
    v_feedback.id, p_actor_user_id, p_actor_user_id
  ) returning id into v_absence_id;

  update feedbackgb.feedback
  set status = 'resolved', resolved_at = now(), resolved_by = p_actor_user_id,
    assigned_to = p_actor_user_id
  where id = v_feedback.id;

  return query select v_feedback.id, v_absence_id, v_feedback.user_id, v_topic;
end;
$$;

create or replace function feedbackgb.review_hr_absence_request(
  p_feedback_id uuid,
  p_actor_user_id uuid,
  p_comment text default null
)
returns table (
  feedback_id uuid,
  applicant_user_id uuid,
  topic text
)
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
declare
  v_feedback feedbackgb.feedback;
  v_actor feedbackgb.users;
  v_comment text;
  v_topic text;
begin
  select * into v_actor from feedbackgb.users where id = p_actor_user_id;
  if not found or v_actor.is_active = false or v_actor.role not in ('admin', 'super_admin') then
    raise exception 'hr_request_actor_not_active_admin' using errcode = 'P0001';
  end if;

  if p_comment is not null then
    v_comment := nullif(trim(p_comment), '');
    if v_comment is not null and length(v_comment) not between 3 and 500 then
      raise exception 'hr_request_invalid_comment' using errcode = 'P0001';
    end if;
  end if;

  select * into v_feedback
  from feedbackgb.feedback
  where id = p_feedback_id
  for update;

  if not found then
    raise exception 'hr_request_not_found' using errcode = 'P0001';
  end if;
  v_topic := v_feedback.fields ->> 'hr_topic';
  if v_feedback.category <> 'hr_question'
    or v_topic not in ('vacation', 'day-off', 'sick-leave', 'transfer') then
    raise exception 'hr_request_topic_not_supported' using errcode = 'P0001';
  end if;
  if v_feedback.status <> 'new' then
    raise exception 'hr_request_not_actionable' using errcode = 'P0001';
  end if;

  if v_comment is not null then
    insert into feedbackgb.feedback_comments (feedback_id, author_id, body)
    values (v_feedback.id, p_actor_user_id, v_comment);
  end if;

  update feedbackgb.feedback
  set status = 'in_progress', assigned_to = p_actor_user_id,
    resolved_at = null, resolved_by = null
  where id = v_feedback.id;

  return query select v_feedback.id, v_feedback.user_id, v_topic;
end;
$$;

create or replace function feedbackgb.reject_hr_absence_request(
  p_feedback_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
returns table (
  feedback_id uuid,
  applicant_user_id uuid,
  topic text
)
language plpgsql
security definer
set search_path = feedbackgb, pg_catalog
as $$
declare
  v_feedback feedbackgb.feedback;
  v_actor feedbackgb.users;
  v_reason text;
  v_topic text;
begin
  select * into v_actor from feedbackgb.users where id = p_actor_user_id;
  if not found or v_actor.is_active = false or v_actor.role not in ('admin', 'super_admin') then
    raise exception 'hr_request_actor_not_active_admin' using errcode = 'P0001';
  end if;

  v_reason := trim(coalesce(p_reason, ''));
  if length(v_reason) not between 3 and 500 then
    raise exception 'hr_request_invalid_rejection_reason' using errcode = 'P0001';
  end if;

  select * into v_feedback
  from feedbackgb.feedback
  where id = p_feedback_id
  for update;

  if not found then
    raise exception 'hr_request_not_found' using errcode = 'P0001';
  end if;

  v_topic := v_feedback.fields ->> 'hr_topic';
  if v_feedback.category <> 'hr_question'
    or v_topic not in ('vacation', 'day-off', 'sick-leave', 'transfer') then
    raise exception 'hr_request_topic_not_supported' using errcode = 'P0001';
  end if;
  if v_feedback.status not in ('new', 'in_progress') then
    raise exception 'hr_request_not_actionable' using errcode = 'P0001';
  end if;

  insert into feedbackgb.feedback_comments (feedback_id, author_id, body)
  values (v_feedback.id, p_actor_user_id, v_reason);

  update feedbackgb.feedback
  set status = 'rejected', assigned_to = p_actor_user_id,
    resolved_at = null, resolved_by = null
  where id = v_feedback.id;

  return query select v_feedback.id, v_feedback.user_id, v_topic;
end;
$$;

-- A planned absence covers full local calendar days. A shift crossing midnight
-- is therefore checked against every local date it touches in the period TZ.
create or replace function feedbackgb.validate_store_work_shift()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, categories, pg_catalog
as $$
declare
  v_period feedbackgb.work_schedule_periods;
  v_employee feedbackgb.users;
  v_permission feedbackgb.seller_store_permissions;
  v_local_start date;
  v_local_end date;
  v_assignment_changed boolean;
begin
  select * into v_period from feedbackgb.work_schedule_periods where id = new.period_id;
  if not found then raise exception 'work schedule period % does not exist', new.period_id; end if;
  if v_period.scope <> 'store' then raise exception 'store_work_shifts requires a store scope period'; end if;
  if v_period.status in ('locked', 'archived') then raise exception 'work schedule period % is locked', new.period_id; end if;

  v_local_start := (new.starts_at at time zone v_period.timezone)::date;
  v_local_end := ((new.ends_at - interval '1 microsecond') at time zone v_period.timezone)::date;
  if v_local_start < v_period.period_start or v_local_end > v_period.period_end then
    raise exception 'shift must fall inside its schedule period in %', v_period.timezone;
  end if;

  select * into v_employee from feedbackgb.users where id = new.employee_id;
  if not found or not v_employee.is_active or v_employee.role <> 'seller' then
    raise exception 'store work shift employee must be an active seller';
  end if;

  v_assignment_changed := tg_op = 'INSERT'
    or new.employee_id is distinct from old.employee_id
    or new.store_id is distinct from old.store_id
    or new.is_replacement is distinct from old.is_replacement
    or new.replacement_permission_id is distinct from old.replacement_permission_id;

  if new.is_replacement then
    if v_assignment_changed then
      select * into v_permission from feedbackgb.seller_store_permissions
      where id = new.replacement_permission_id and seller_id = new.employee_id
        and store_id = new.store_id and revoked_at is null;
      if not found then raise exception 'active replacement-store permission is required'; end if;
    end if;
  elsif v_employee.store_id is distinct from new.store_id then
    raise exception 'regular shift must use the employee home store';
  end if;

  if tg_op = 'UPDATE' and old.status = 'scheduled' and new.status = 'cancelled' and new.change_reason is null then
    raise exception 'cancelling a shift requires a reason';
  end if;

  if new.status = 'scheduled' and exists (
    select 1
    from feedbackgb.employee_absences absence
    where absence.employee_id = new.employee_id
      and absence.status = 'active'
      and daterange(v_local_start, v_local_end, '[]')
        && daterange(absence.starts_on, absence.ends_on, '[]')
  ) then
    raise exception 'schedule_employee_absent' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace view feedbackgb.v_store_schedule_issues as
select
  s.id as shift_id, s.period_id,
  'inactive_or_wrong_role_employee'::text as issue_code,
  'Shift employee is not an active seller'::text as issue_message,
  s.employee_id, s.store_id, s.starts_at, s.ends_at
from feedbackgb.store_work_shifts s
join feedbackgb.users u on u.id = s.employee_id
where s.status = 'scheduled' and (u.is_active = false or u.role <> 'seller')
union all
select
  s.id, s.period_id,
  'replacement_permission_not_active'::text,
  'Replacement shift permission is no longer active'::text,
  s.employee_id, s.store_id, s.starts_at, s.ends_at
from feedbackgb.store_work_shifts s
left join feedbackgb.seller_store_permissions p on p.id = s.replacement_permission_id
where s.status = 'scheduled' and s.is_replacement = true
  and (p.id is null or p.revoked_at is not null or p.seller_id <> s.employee_id or p.store_id <> s.store_id)
union all
select
  s.id, s.period_id,
  'employee_active_absence'::text,
  'Shift overlaps an active employee absence'::text,
  s.employee_id, s.store_id, s.starts_at, s.ends_at
from feedbackgb.store_work_shifts s
join feedbackgb.work_schedule_periods period on period.id = s.period_id
join feedbackgb.employee_absences absence on absence.employee_id = s.employee_id
  and absence.status = 'active'
  and daterange(
    (s.starts_at at time zone period.timezone)::date,
    ((s.ends_at - interval '1 microsecond') at time zone period.timezone)::date,
    '[]'
  ) && daterange(absence.starts_on, absence.ends_on, '[]')
where s.status = 'scheduled';

revoke all on table feedbackgb.v_hr_absence_requests from public, anon, authenticated;
grant select on table feedbackgb.v_hr_absence_requests to service_role;
revoke all on function feedbackgb.approve_hr_absence_request(uuid, uuid, text, date) from public, anon, authenticated;
revoke all on function feedbackgb.review_hr_absence_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function feedbackgb.reject_hr_absence_request(uuid, uuid, text) from public, anon, authenticated;
grant execute on function feedbackgb.approve_hr_absence_request(uuid, uuid, text, date) to service_role;
grant execute on function feedbackgb.review_hr_absence_request(uuid, uuid, text) to service_role;
grant execute on function feedbackgb.reject_hr_absence_request(uuid, uuid, text) to service_role;

commit;
