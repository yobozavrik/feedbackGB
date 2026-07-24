-- Client-editable draft carts for supply-app.
--
-- Applied manually by super_admin after 20260723_005.
--
-- Business rule (see docs/supply-app/HR_CONSUMABLES_BRIDGE_BUILD.md phase C):
-- a supply worker builds a consumables cart in draft state, editing items and
-- quantities freely; only "Відправити на склад" turns it into a real feedback
-- row. Drafts are per (user, category) — one active draft at a time — and are
-- never visible to admins (they don't appear in feedback_feed).
--
-- Scope right now: category = 'consumables_request' only. The schema tolerates
-- other categories in future without another migration.
--
-- Idempotency contract (matches consumables): `draft.id` becomes both
-- `feedback.id` AND `client_submission_id` on submit, so a retry after CRM
-- accept + feedback insert failure hits the same key on both sides.

set search_path = feedbackgb, public, pg_catalog;

create table if not exists feedbackgb.feedback_drafts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references feedbackgb.users(id) on delete cascade,
  facility_id    uuid null references feedbackgb.facilities(id) on delete restrict,
  category       text not null check (category in ('consumables_request')),
  cart_items     jsonb not null default '[]'::jsonb
                   check (jsonb_typeof(cart_items) = 'array'
                          and jsonb_array_length(cart_items) <= 100),
  comment        text null check (comment is null or char_length(comment) <= 4000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One active draft per (user, category). Submit deletes the row → next draft
-- inherits a fresh id.
create unique index if not exists feedback_drafts_user_category_idx
  on feedbackgb.feedback_drafts (user_id, category);

create index if not exists feedback_drafts_updated_at_idx
  on feedbackgb.feedback_drafts (updated_at desc);

alter table feedbackgb.feedback_drafts enable row level security;
alter table feedbackgb.feedback_drafts force row level security;

-- Same RLS-only model as the other supply tables: no anon/authenticated grants,
-- access only through service_role via the API layer.
revoke all on feedbackgb.feedback_drafts from anon, authenticated;
grant select, insert, update, delete on feedbackgb.feedback_drafts to service_role;

-- Reuse the touch_updated_at trigger from migration 001.
create trigger feedback_drafts_touch_updated_at
before update on feedbackgb.feedback_drafts
for each row execute function feedbackgb.touch_updated_at();
