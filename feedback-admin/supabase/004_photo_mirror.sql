-- 004_photo_mirror.sql
-- Tracks which feedback rows with photos have been mirrored to Google Drive.
-- The cron at /api/cron/mirror-to-drive consults this table to avoid
-- uploading the same photo twice and to surface persistent failures.

set search_path = feedbackgb, public;

create table if not exists feedbackgb.photo_mirror (
  feedback_id   uuid primary key references feedbackgb.feedback(id) on delete cascade,
  drive_file_id text,
  mirrored_at   timestamptz,
  error         text,
  attempts      int not null default 0,
  last_attempt  timestamptz
);

create index if not exists photo_mirror_pending_idx
  on feedbackgb.photo_mirror (last_attempt)
  where mirrored_at is null;

-- Service role drives the cron; mirror only via service_role.
revoke all on feedbackgb.photo_mirror from public, anon, authenticated;
grant select, insert, update, delete on feedbackgb.photo_mirror to service_role;

alter table feedbackgb.photo_mirror enable row level security;
-- service_role has BYPASSRLS (set in 002_security_hardening), so no policy required.
