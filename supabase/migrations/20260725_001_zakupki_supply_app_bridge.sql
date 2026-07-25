-- Bridges supply-app (feedbackgb identity) to the existing zakupki
-- procurement schema so raw-material orders are recorded — with full
-- history across every workshop/store/warehouse — in zakupki.requests /
-- zakupki.request_items (type='raw_material'), not a parallel feedbackgb
-- table.
--
-- zakupki has its own, independently-managed employee/PIN identity
-- (zakupki.employees) — separate from feedbackgb.users, which is what
-- supply-app authenticates against. requests.employee_id is NOT NULL, so a
-- supply-app submission needs a way to resolve "this feedbackgb session" to
-- "that zakupki employee row". A super_admin links each real zakupki
-- employee to their supply-app login by setting this column by hand — no
-- auto-provisioning, so zakupki.employees stays exactly what the zakupki
-- owner curates there:
--
--   update zakupki.employees
--      set feedbackgb_user_id = '<feedbackgb.users.id>'
--    where id = '<zakupki.employees.id>';
--
-- This migration is intentionally NOT applied to live Supabase by the repo.
-- A super_admin applies it manually in the Supabase SQL Editor (service_role).

set search_path = zakupki, public, pg_catalog;

-- No cross-schema FK to feedbackgb.users on purpose (same reasoning as
-- request_items.ingredient_id having no FK constraint elsewhere in this
-- schema's design) — zakupki stays independently valid even if feedbackgb
-- is unreachable or the linked user is later removed there.
alter table zakupki.employees
  add column if not exists feedbackgb_user_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'zakupki.employees'::regclass
      and conname = 'employees_feedbackgb_user_id_key'
  ) then
    alter table zakupki.employees
      add constraint employees_feedbackgb_user_id_key unique (feedbackgb_user_id);
  end if;
end $$;

comment on column zakupki.employees.feedbackgb_user_id is
  'feedbackgb.users.id — links this employee to their supply-app login. NULL until a super_admin links it by hand; supply-app order submission fails with a clear message until then.';

create index if not exists employees_feedbackgb_user_idx
  on zakupki.employees (feedbackgb_user_id)
  where feedbackgb_user_id is not null;

-- Idempotency for supply-app order submission (same client_submission_id
-- pattern used across feedbackgb.feedback): a network retry with the same
-- id must hit the same request row, never create a duplicate order.
alter table zakupki.requests
  add column if not exists client_submission_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'zakupki.requests'::regclass
      and conname = 'requests_client_submission_id_key'
  ) then
    alter table zakupki.requests
      add constraint requests_client_submission_id_key unique (client_submission_id);
  end if;
end $$;

comment on column zakupki.requests.client_submission_id is
  'Idempotency key from the submitting client (supply-app). A retry with the same id must not create a second request.';
