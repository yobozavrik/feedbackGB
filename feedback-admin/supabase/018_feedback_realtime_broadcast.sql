-- 018_feedback_realtime_broadcast.sql
-- Fixes the admin feed's "live update without manual refresh" feature,
-- which has never actually worked: admin-client.tsx subscribes to
-- `postgres_changes` on feedbackgb.feedback using the browser's anon-key
-- client, but that table has RLS enabled with zero policies for
-- anon/authenticated (see schema.sql section 9 — "service_role bypasses
-- RLS anyway... the browser never [reaches the DB as service_role]").
-- Postgres Changes respects RLS, so the anon-key subscriber silently
-- receives nothing — the channel shows SUBSCRIBED but never fires.
--
-- Fix: use Realtime's "Broadcast from Database" pattern instead. A trigger
-- calls realtime.send() to publish a message to a topic; broadcast
-- channels do not require RLS on the underlying table. Deliberately keep
-- the payload to `{ id, event }` only — no row content (no summary, no
-- customer name, no photo) — since this broadcast topic is reachable by
-- anyone holding the public anon key. The admin UI does an authenticated
-- follow-up GET (/api/admin/feedback/<id>, added alongside this migration)
-- to fetch category/summary for the notification, so nothing is lost —
-- feedback content itself is still only ever readable through the
-- session-gated server routes.

set search_path = feedbackgb, public;

create or replace function feedbackgb.notify_feedback_change()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, realtime, public, pg_catalog
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'id', coalesce(new.id, old.id),
      'event', tg_op
    ),
    'feedback_changed',
    'admin-feedback-changes',
    false -- not a private/authorized channel: payload carries no row content
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists feedback_notify_realtime on feedbackgb.feedback;
create trigger feedback_notify_realtime
  after insert or update or delete on feedbackgb.feedback
  for each row execute function feedbackgb.notify_feedback_change();

-- realtime.messages has RLS enabled with zero existing policies (verified
-- live: relrowsecurity=true, no rows in pg_policies for this table) — so
-- without an explicit policy, anon/authenticated would still receive
-- nothing even though realtime.send() stores the message. Scope the
-- policy tightly to this one topic: it does not grant any access to
-- feedbackgb.feedback or any other table, only to the content-free
-- `{id, event}` broadcast rows this trigger writes.
drop policy if exists admin_feedback_changes_read on realtime.messages;
create policy admin_feedback_changes_read on realtime.messages
  for select
  to anon, authenticated
  using (topic = 'admin-feedback-changes' and extension = 'broadcast');
