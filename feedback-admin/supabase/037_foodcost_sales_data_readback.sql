-- Read-only production/staging checks for migration 037 sales snapshots.
-- Change dates once in the scope CTE when auditing another period.
-- All objects are in feedbackgb; no public schema writes.

with scope as (
  select date '2026-09-10' as date_from, date '2026-09-23' as date_to
), latest as (
  select r.*, row_number() over (
    partition by business_date, spot_id order by completed_at desc, id desc
  ) as rn
  from feedbackgb.foodcost_sales_runs r
  where business_date between (select date_from from scope) and (select date_to from scope)
    and status = 'completed'
), selected as (select * from latest where rn = 1),
fact_totals as (
  select s.id, count(f.*) as fact_rows,
    coalesce(sum(f.payed_sum_minor), 0) as paid,
    coalesce(sum(f.product_profit_minor), 0) as profit,
    sum(f.product_profit_netto_minor) as netto,
    count(f.*) filter (where f.product_profit_netto_minor is null) as netto_nulls
  from selected s left join feedbackgb.foodcost_sales_facts f on f.run_id = s.id
  group by s.id
), expected as (
  select d::date as business_date, s as spot_id
  from scope w, generate_series(w.date_from, w.date_to, interval '1 day') d
  cross join generate_series(1, 26) s
), actual as (
  select distinct business_date, spot_id from selected
)
select jsonb_build_object(
  'dates', count(distinct s.business_date),
  'selected_runs', count(*),
  'distinct_spot_days', count(distinct (s.business_date, s.spot_id)),
  'source_rows', sum(s.source_row_count),
  'fact_rows', sum(f.fact_rows),
  'paid_minor', sum(s.payed_sum_minor),
  'profit_minor', sum(s.product_profit_minor),
  'netto_minor', sum(s.product_profit_netto_minor),
  'netto_null_fact_rows', sum(f.netto_nulls),
  'mismatched_runs', count(*) filter (where s.source_row_count <> f.fact_rows
    or s.payed_sum_minor <> f.paid or s.product_profit_minor <> f.profit
    or s.product_profit_netto_minor is distinct from f.netto),
  'gross_foodcost_percent', round(100.0 * (sum(s.payed_sum_minor) - sum(s.product_profit_minor))
    / nullif(sum(s.payed_sum_minor), 0), 4),
  'netto_foodcost_percent', round(100.0 * (sum(s.payed_sum_minor) - sum(s.product_profit_netto_minor))
    / nullif(sum(s.payed_sum_minor), 0), 4),
  'missing_cells', (select count(*) from expected e left join actual a
    using (business_date, spot_id) where a.spot_id is null),
  'unexpected_cells', (select count(*) from actual a left join expected e
    using (business_date, spot_id) where e.spot_id is null)
) as readback
from selected s join fact_totals f on f.id = s.id
