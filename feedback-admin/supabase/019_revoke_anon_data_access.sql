-- 019_revoke_anon_data_access.sql
-- SECURITY FIX: revoke anon/authenticated SELECT grants that leak business
-- data through views that bypass RLS.
--
-- Found live (2026-07-03): feedbackgb.feedback_feed, v_stores, v_products
-- and v_popular_products all had SELECT granted to anon/authenticated.
-- These views are owned by `supabase_admin` (a role that bypasses RLS),
-- and Postgres views execute with the OWNER's privileges by default — so
-- granting anon SELECT on feedback_feed exposed every feedback row
-- (customer complaints, store names/addresses, seller names, photo paths)
-- to anyone holding the public anon key, completely bypassing
-- feedbackgb.feedback's own RLS (which correctly returns zero rows for
-- anon when queried directly). Verified live: `curl .../feedback_feed`
-- with only the anon key returned all 42 rows in the table.
--
-- feedback/users/audit_log also had direct anon/authenticated SELECT
-- grants. RLS on those tables currently blocks anon (zero policies —
-- verified live, direct queries return `[]`), but the grants themselves
-- serve no purpose and are a latent risk (anyone who later adds a
-- permissive RLS policy without auditing existing grants would
-- unknowingly re-open this).
--
-- None of these grants are used by the application: grep confirms the
-- only client-side (anon-key) Supabase usage in either app is the
-- Realtime broadcast subscription in admin-client.tsx — no code ever
-- queries these tables/views with the anon key. Both apps read
-- everything server-side via the service_role client, which is
-- unaffected by these revokes (service_role bypasses RLS and grants
-- entirely).

set search_path = feedbackgb, public;

revoke select on feedbackgb.feedback       from anon, authenticated;
revoke select on feedbackgb.users          from anon, authenticated;
revoke select on feedbackgb.audit_log      from anon, authenticated;
revoke select on feedbackgb.feedback_feed  from anon, authenticated;
revoke select on feedbackgb.v_stores           from anon, authenticated;
revoke select on feedbackgb.v_products         from anon, authenticated;
revoke select on feedbackgb.v_popular_products from anon, authenticated;
