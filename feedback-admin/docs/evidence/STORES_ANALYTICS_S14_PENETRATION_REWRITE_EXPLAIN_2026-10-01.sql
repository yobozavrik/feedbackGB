-- S-14 candidate penetration rewrite. Read-only benchmark: no persistent objects/rows.
-- Compare this JSON plan with P2 before replacing the production function.
begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

explain (analyze, buffers, wal, settings, format json)
with params as materialized (
  select array_agg(id::bigint order by id) spot_ids
  from feedbackgb.v_stores where is_active is true
), selected_runs as materialized (
  select min(r.id::text)::uuid run_id, r.date_from business_date
  from feedbackgb.poster_receipt_import_runs r
  join feedbackgb.poster_receipt_analytics_runs a on a.run_id = r.id
    and a.methodology_version = 'poster-receipt-purchase-v1'
  cross join params p
  where r.status = 'accepted' and r.date_from = r.date_to
    and r.date_from between date '2026-09-16' and date '2026-09-22'
    and r.completed_at <= timestamptz '2026-10-01T14:30:16.276Z'
    and a.projected_at <= timestamptz '2026-10-01T14:30:16.276Z'
    and p.spot_ids <@ r.source_spot_ids
  group by r.date_from having count(*) = 1
), receipts as materialized (
  select f.receipt_version_id, f.business_date, f.spot_id
  from feedbackgb.poster_receipt_analytics_facts f
  join selected_runs r on r.run_id = f.run_id
  cross join params p
  where f.spot_id = any(p.spot_ids) and f.eligibility_status = 'eligible'
), lines as materialized (
  select l.receipt_version_id, l.business_date, l.spot_id,
    l.product_id, l.modification_id
  from feedbackgb.poster_receipt_line_analytics_facts l
  join selected_runs r on r.run_id = l.run_id
  cross join params p
  where l.spot_id = any(p.spot_ids) and l.eligible_purchase
), sales_latest as materialized (
  select distinct on (r.business_date, r.spot_id)
    r.id, r.business_date, r.spot_id
  from feedbackgb.foodcost_sales_runs r
  cross join params p
  where r.status = 'completed'
    and r.business_date between date '2026-09-16' and date '2026-09-22'
    and r.spot_id = any(p.spot_ids)
    and r.completed_at <= timestamptz '2026-10-01T14:30:16.276Z'
  order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
), catalog as materialized (
  select l.business_date, l.spot_id, f.product_id, f.modification_id,
    case when count(*) filter(where f.category_id_snapshot is null) = 0
      and count(distinct f.category_id_snapshot) = 1
      then min(f.category_id_snapshot) end category_id,
    case when count(distinct f.product_name_snapshot) = 1
      then min(f.product_name_snapshot) end product_name
  from sales_latest l
  join feedbackgb.foodcost_sales_facts f on f.run_id = l.id
  group by l.business_date, l.spot_id, f.product_id, f.modification_id
), bridge as materialized (
  select distinct receipt_version_id, business_date, spot_id,
    product_id, modification_id
  from lines
), mapped as materialized (
  select b.*, c.category_id, c.product_name
  from bridge b left join catalog c
    using(business_date, spot_id, product_id, modification_id)
), category_stats as materialized (
  select category_id,
    count(distinct receipt_version_id) receipt_count,
    count(distinct spot_id) store_count
  from mapped where category_id is not null
  group by category_id
), product_stats as materialized (
  select product_id, modification_id,
    case when count(*) filter(where category_id is null) = 0
      and count(distinct category_id) = 1 then min(category_id) end category_id,
    case when count(distinct product_name) = 1 then min(product_name) end product_name,
    count(distinct receipt_version_id) receipt_count,
    count(distinct spot_id) store_count
  from mapped group by product_id, modification_id
)
select
  (select count(*) from receipts) eligible_receipts,
  (select count(*) from lines) eligible_lines,
  (select count(*) from bridge) bridge_rows,
  (select count(*) from mapped) mapped_rows,
  (select count(*) from mapped where category_id is null) unmapped_rows,
  (select count(*) from category_stats) category_groups,
  (select count(*) from product_stats) product_groups,
  (select coalesce(sum(receipt_count), 0) from category_stats) category_receipt_memberships,
  (select coalesce(sum(receipt_count), 0) from product_stats) product_receipt_memberships;

rollback;
