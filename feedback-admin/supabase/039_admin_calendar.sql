-- Personal admin calendar. No objects or privileges in public schema.
begin;
create table feedbackgb.admin_calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references feedbackgb.users(id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  due_at timestamptz not null,
  remind_at timestamptz,
  status text not null default 'planned' check (status in ('planned','done')),
  reminder_seen_at timestamptz,
  row_version integer not null default 1 check (row_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (remind_at is null or remind_at <= due_at)
);
create index admin_calendar_owner_due_idx on feedbackgb.admin_calendar_tasks(owner_id, due_at);
create index admin_calendar_pending_reminder_idx on feedbackgb.admin_calendar_tasks(owner_id, remind_at)
  where status = 'planned' and reminder_seen_at is null and remind_at is not null;
create table feedbackgb.admin_calendar_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references feedbackgb.admin_calendar_tasks(id) on delete restrict,
  owner_id uuid not null references feedbackgb.users(id) on delete restrict,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  before_data jsonb, after_data jsonb
);
create function feedbackgb.validate_admin_calendar_task() returns trigger
language plpgsql set search_path = pg_catalog, feedbackgb as $$
begin
  if not exists (select 1 from feedbackgb.users where id = new.owner_id and is_active and role in ('admin','super_admin')) then
    raise exception 'calendar_owner_inactive';
  end if;
  if tg_op = 'UPDATE' then
    if new.owner_id <> old.owner_id then raise exception 'calendar_owner_immutable'; end if;
    new.row_version := old.row_version + 1;
    new.updated_at := now();
    if new.remind_at is distinct from old.remind_at or (old.status = 'done' and new.status = 'planned') then
      new.reminder_seen_at := null;
    end if;
  end if;
  return new;
end $$;
create function feedbackgb.audit_admin_calendar_task() returns trigger
language plpgsql set search_path = pg_catalog, feedbackgb as $$
begin
  insert into feedbackgb.admin_calendar_events(task_id,owner_id,event_type,before_data,after_data)
  values (new.id,new.owner_id,lower(tg_op),case when tg_op = 'UPDATE' then to_jsonb(old) else null end,to_jsonb(new));
  return new;
end $$;
create trigger admin_calendar_validate before insert or update on feedbackgb.admin_calendar_tasks
  for each row execute function feedbackgb.validate_admin_calendar_task();
create trigger admin_calendar_audit after insert or update on feedbackgb.admin_calendar_tasks
  for each row execute function feedbackgb.audit_admin_calendar_task();
alter table feedbackgb.admin_calendar_tasks enable row level security;
alter table feedbackgb.admin_calendar_events enable row level security;
revoke all on feedbackgb.admin_calendar_tasks, feedbackgb.admin_calendar_events from public, anon, authenticated;
grant select,insert,update on feedbackgb.admin_calendar_tasks to service_role;
grant select,insert on feedbackgb.admin_calendar_events to service_role;
grant usage,select on sequence feedbackgb.admin_calendar_events_id_seq to service_role;
revoke all on function feedbackgb.validate_admin_calendar_task(), feedbackgb.audit_admin_calendar_task() from public,anon,authenticated;
grant execute on function feedbackgb.validate_admin_calendar_task(), feedbackgb.audit_admin_calendar_task() to service_role;
commit;
