-- 022_app_actor_rpc.sql
-- Fixes audit_log actor attribution, which has never actually worked: both
-- API routes call `supabase.rpc("set_config", {...})` to stamp `app.actor`
-- before writing to `feedback`, so the `audit_feedback()` trigger
-- (006_audit_log_full.sql) can attribute the row to the real user. But
-- `set_config` is a pg_catalog builtin, not a function in the `feedbackgb`
-- schema -- PostgREST only exposes RPCs from the schema(s) configured for
-- the API (feedbackgb here), so every one of those calls has been silently
-- failing (swallowed by the route's try/catch), and every feedback.insert /
-- feedback.status_change row has been falling back to actor='service_role'
-- with actor_user_id=null. The admin UI has no rendering path for
-- 'service_role' and shows it as "anon" -- confirmed live: every
-- feedback.insert/status_change row in audit_log today has
-- actor='service_role', actor_user_id=null.
--
-- Fix: expose a thin wrapper in `feedbackgb` that PostgREST can actually
-- call, and have both API routes call that instead of the bare builtin.

set search_path = feedbackgb, public;

create or replace function feedbackgb.set_app_actor(actor_uid uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform set_config('app.actor', actor_uid::text, true);
end;
$$;

revoke all on function feedbackgb.set_app_actor(uuid) from public, anon, authenticated;
grant execute on function feedbackgb.set_app_actor(uuid) to service_role;
