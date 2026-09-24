-- 036_poster_supply_cost_snapshots.sql
-- Read-only Poster supply mirror for independent 30-calendar-day weighted
-- purchase prices. Apply to staging first. Does not change existing data.
-- No objects are created in public.

begin;

create table if not exists feedbackgb.poster_supply_cost_runs (
  id uuid primary key default gen_random_uuid(),
  window_start date not null,
  window_end date not null,
  status text not null default 'running'
    check (status in ('running', 'completed')),
  expected_supplies integer not null default 0 check (expected_supplies >= 0),
  started_at timestamptz not null default now(),
  seeded_at timestamptz,
  completed_at timestamptz,
  constraint poster_supply_cost_runs_window_check check (window_start <= window_end),
  constraint poster_supply_cost_runs_completion_check
    check ((status = 'running' and completed_at is null)
      or (status = 'completed' and completed_at is not null)),
  constraint poster_supply_cost_runs_window_key unique (window_start, window_end)
);

create index if not exists poster_supply_cost_runs_completed_idx
  on feedbackgb.poster_supply_cost_runs (completed_at desc)
  where status = 'completed';

create table if not exists feedbackgb.poster_supply_cost_documents (
  run_id uuid not null references feedbackgb.poster_supply_cost_runs(id) on delete cascade,
  supply_id bigint not null check (supply_id > 0),
  storage_id bigint not null check (storage_id > 0),
  supply_date timestamp without time zone not null,
  -- NULL means not fetched. [] is a valid fetched document with zero lines.
  lines jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  fetched_at timestamptz,
  primary key (run_id, supply_id),
  constraint poster_supply_cost_documents_lines_check
    check (lines is null or jsonb_typeof(lines) = 'array'),
  constraint poster_supply_cost_documents_fetched_check
    check ((lines is null and fetched_at is null)
      or (lines is not null and fetched_at is not null))
);

create index if not exists poster_supply_cost_documents_pending_idx
  on feedbackgb.poster_supply_cost_documents (run_id, supply_id)
  where lines is null;

create table if not exists feedbackgb.poster_supply_cost_averages (
  run_id uuid not null references feedbackgb.poster_supply_cost_runs(id) on delete cascade,
  ingredient_id bigint not null check (ingredient_id > 0),
  ingredient_unit text not null check (ingredient_unit in ('kg', 'l', 'p')),
  total_quantity numeric not null check (total_quantity > 0),
  total_sum_minor numeric not null check (total_sum_minor >= 0),
  supply_count integer not null check (supply_count > 0),
  primary key (run_id, ingredient_id, ingredient_unit)
);

create index if not exists poster_supply_cost_averages_ingredient_idx
  on feedbackgb.poster_supply_cost_averages (ingredient_id, run_id);

alter table feedbackgb.poster_supply_cost_runs enable row level security;
alter table feedbackgb.poster_supply_cost_documents enable row level security;
alter table feedbackgb.poster_supply_cost_averages enable row level security;

revoke all on table feedbackgb.poster_supply_cost_runs from public, anon, authenticated;
revoke all on table feedbackgb.poster_supply_cost_documents from public, anon, authenticated;
revoke all on table feedbackgb.poster_supply_cost_averages from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.poster_supply_cost_runs to service_role;
grant select, insert, update, delete on table feedbackgb.poster_supply_cost_documents to service_role;
grant select, insert, update, delete on table feedbackgb.poster_supply_cost_averages to service_role;

commit;

-- Safe rollback before any snapshots are collected:
-- drop table feedbackgb.poster_supply_cost_averages;
-- drop table feedbackgb.poster_supply_cost_documents;
-- drop table feedbackgb.poster_supply_cost_runs;
