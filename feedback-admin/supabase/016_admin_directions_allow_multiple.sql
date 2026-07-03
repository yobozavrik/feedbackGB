-- 016_admin_directions_allow_multiple.sql
-- Allow more than one active admin per (category, store-scope) direction.
--
-- 015_admin_directions.sql enforced exactly one active admin per scope via
-- a partial unique index, so auto-assignment could always resolve to a
-- single admin_id deterministically. Product requirement changed: several
-- admins can now share a direction (e.g. two people covering "Ремонт").
--
-- New behavior (implemented in feedback-app/src/lib/assignment.ts):
--   * Exactly 1 active admin for the resolved scope -> auto-assign them to
--     feedback.assigned_to at creation time, same as before.
--   * 0 or 2+ active admins for the resolved scope -> assigned_to stays
--     NULL. The item becomes a shared queue item, visible to every admin
--     in that direction on the "Мої завдання" page (see
--     feedback-admin/src/app/(admin)/admin/tasks/page.tsx). Whoever picks
--     it up first sets assigned_to via the existing reassign control in
--     FeedDrawer.
--
-- See feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md for the full design.

set search_path = feedbackgb, public;

drop index if exists feedbackgb.admin_directions_scope_uidx;

-- Keep a plain (non-unique) index on the same columns: resolveAssignedAdmin
-- still filters by (category, store_id, is_active) on every lookup, so the
-- index remains load-bearing for query performance, just without the
-- uniqueness constraint.
create index if not exists admin_directions_scope_idx
  on feedbackgb.admin_directions (category, coalesce(store_id, -1))
  where is_active;

-- Still forbid the SAME admin from having two active rows for the same
-- (category, store-scope) — that would be a pointless duplicate, and worse,
-- would make resolveAssignedAdmin see "2 admins" (really the same person
-- twice) and treat a genuinely unambiguous single-admin scope as a shared
-- queue. Different admins sharing a scope remain fully allowed.
create unique index if not exists admin_directions_admin_scope_uidx
  on feedbackgb.admin_directions (admin_id, category, coalesce(store_id, -1))
  where is_active;
