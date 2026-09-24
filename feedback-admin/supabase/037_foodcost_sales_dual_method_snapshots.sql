-- 037_foodcost_sales_dual_method_snapshots.sql
-- Poster sales snapshots for BOTH foodcost methodologies.
-- Apply to staging first. This migration does not backfill or change existing data.
-- All objects stay in feedbackgb; no objects are created in public.

begin;

create table feedbackgb.foodcost_sales_runs (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  spot_id bigint not null check (spot_id > 0),
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  methodology_version text not null default 'poster-sales-dual-v1',
  source_row_count integer check (source_row_count is null or source_row_count >= 0),
  payed_sum_minor bigint,
  product_profit_minor bigint,
  product_profit_netto_minor bigint,
  source_fetched_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  constraint foodcost_sales_runs_completion_check check (
    (status = 'completed' and completed_at is not null and source_fetched_at is not null
      and source_row_count is not null and payed_sum_minor is not null
      and product_profit_minor is not null and error_code is null)
    or (status = 'running' and completed_at is null and error_code is null)
    or (status = 'failed' and completed_at is null and error_code is not null)
  )
);

create index foodcost_sales_runs_latest_completed_idx
  on feedbackgb.foodcost_sales_runs (business_date, spot_id, completed_at desc, id desc)
  where status = 'completed';

create table feedbackgb.foodcost_sales_facts (
  run_id uuid not null references feedbackgb.foodcost_sales_runs(id) on delete cascade,
  -- Source row order is scoped to one fetched spot/day. Do not assume that
  -- product_id + modification_id stays unique for every historical period.
  source_row_no integer not null check (source_row_no >= 0),
  product_id bigint not null check (product_id > 0),
  modification_id bigint not null check (modification_id >= 0),
  category_id_snapshot bigint check (category_id_snapshot is null or category_id_snapshot > 0),
  product_name_snapshot text not null check (length(btrim(product_name_snapshot)) > 0),
  category_name_snapshot text,
  quantity numeric(20, 7) not null,
  unit text,
  weight_based boolean not null,
  payed_sum_minor bigint not null,
  product_profit_minor bigint not null,
  -- NULL means Poster did not provide the field; it must not become zero.
  product_profit_netto_minor bigint,
  product_sum_minor bigint,
  bonus_sum_minor bigint,
  cert_sum_minor bigint,
  discount_minor bigint,
  primary key (run_id, source_row_no)
);

create index foodcost_sales_facts_product_idx
  on feedbackgb.foodcost_sales_facts (product_id, run_id);
create index foodcost_sales_facts_product_modifier_idx
  on feedbackgb.foodcost_sales_facts (run_id, product_id, modification_id);
create index foodcost_sales_facts_category_idx
  on feedbackgb.foodcost_sales_facts (category_id_snapshot, run_id);

alter table feedbackgb.foodcost_sales_runs enable row level security;
alter table feedbackgb.foodcost_sales_facts enable row level security;

revoke all on table feedbackgb.foodcost_sales_runs from public, anon, authenticated;
revoke all on table feedbackgb.foodcost_sales_facts from public, anon, authenticated;
grant select, insert, update, delete on table feedbackgb.foodcost_sales_runs to service_role;
grant select, insert, update, delete on table feedbackgb.foodcost_sales_facts to service_role;

commit;

-- Rollback ONLY before any sales snapshots are written and after ensuring no
-- downstream view/function depends on these tables:
-- begin;
-- drop table feedbackgb.foodcost_sales_facts;
-- drop table feedbackgb.foodcost_sales_runs;
-- commit;
