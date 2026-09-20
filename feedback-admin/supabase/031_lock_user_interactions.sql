-- 031_lock_user_interactions.sql
-- SECURITY FIX (H0): lock feedbackgb.user_interactions away from the public
-- anon key.
--
-- Root cause: 013_interaction_tracking.sql created this table with
--   grant insert, select on feedbackgb.user_interactions to anon;
--   grant insert, select on feedbackgb.user_interactions to authenticated;
-- and never enabled row-level security. The anon key is the *public*
-- NEXT_PUBLIC_SUPABASE_ANON_KEY shipped in the browser bundle, so anyone
-- holding it could, via a direct Supabase PostgREST request (bypassing the
-- Next.js API, its auth middleware and rate limits):
--   * SELECT every user's interaction/heatmap rows (behavioural data +
--     user_id enumeration across all users), and
--   * INSERT arbitrary rows (analytics pollution / unbounded storage write).
-- This is the same class of exposure that 019_revoke_anon_data_access.sql
-- fixed for feedback_feed / v_stores / v_products; user_interactions was
-- overlooked in that pass.
--
-- Why this is safe for both apps (no behaviour change on the happy path):
--   * Both the seller app and the admin panel read/write this table ONLY
--     server-side via the service_role client (getServerSupabase) — see
--     feedback-app .../api/analytics/interactions/route.ts and
--     feedback-admin .../api/admin/analytics/interactions/route.ts.
--     service_role bypasses RLS and is unaffected by the revokes below.
--   * The only client-side (anon-key) Supabase usage in either app is the
--     Realtime "admin-feedback-changes" channel (admin-client.tsx), which
--     does not touch this table.
--
-- Rollback (NOT recommended — this re-opens the leak):
--   alter table feedbackgb.user_interactions disable row level security;
--   grant insert, select on feedbackgb.user_interactions to anon, authenticated;

set search_path = feedbackgb, public;

revoke insert, select on feedbackgb.user_interactions from anon, authenticated;

-- RLS enabled with ZERO policies = deny-all for every non-owner role
-- (anon / authenticated). service_role bypasses RLS entirely, so all
-- server-side reads/writes keep working exactly as before.
alter table feedbackgb.user_interactions enable row level security;

-- Defensive: re-assert that only service_role retains table privileges,
-- mirroring the grant block in 013_interaction_tracking.sql. Guarded on the
-- role existing so this is a no-op on instances without the anon role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke insert, select on feedbackgb.user_interactions from anon';
    execute 'revoke insert, select on feedbackgb.user_interactions from authenticated';
    execute 'grant all privileges on feedbackgb.user_interactions to service_role';
  end if;
end $$;
