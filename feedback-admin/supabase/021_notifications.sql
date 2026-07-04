-- 021_notifications.sql
-- In-app notifications: bell icon in admin panel + seller app.
-- See feedback-admin/docs/IN_APP_NOTIFICATIONS_PLAN.md for the full design.
--
-- MVP events:
--   feedback.assigned_to_admin           -> notifies the responsible admin
--   feedback.status_in_progress_for_seller -> notifies the seller

set search_path = feedbackgb, public;

create table if not exists feedbackgb.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references feedbackgb.users(id) on delete cascade,
  feedback_id       uuid null references feedbackgb.feedback(id) on delete cascade,
  type              text not null,
  title             text not null,
  body              text not null,
  payload           jsonb not null default '{}'::jsonb,
  is_read           boolean not null default false,
  read_at           timestamptz null,
  created_at        timestamptz not null default now()
);

create index if not exists notifications_recipient_created_idx
  on feedbackgb.notifications (recipient_user_id, created_at desc);

create index if not exists notifications_recipient_unread_idx
  on feedbackgb.notifications (recipient_user_id, created_at desc)
  where is_read = false;

create index if not exists notifications_feedback_idx
  on feedbackgb.notifications (feedback_id, created_at desc)
  where feedback_id is not null;

-- RLS enabled, no anon/authenticated policies: only the server (service_role,
-- which bypasses RLS) reads/writes this table, same pattern as `feedback`.
alter table feedbackgb.notifications enable row level security;

grant select, insert, update on feedbackgb.notifications to service_role;
