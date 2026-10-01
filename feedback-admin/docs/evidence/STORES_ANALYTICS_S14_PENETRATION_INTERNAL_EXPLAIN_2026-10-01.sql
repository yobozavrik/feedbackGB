-- S-14 read-only internal probe for the slow penetration reader.
-- It creates no persistent objects and changes no application rows.
-- Run as one script in Supabase SQL Editor and retain all JSON plans.
begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

show work_mem;
show temp_file_limit;
show track_io_timing;

-- P1: accepted/projected runs selected for the fixed complete period.
explain (analyze, buffers, wal, settings, format json)
with params as (
  select array_agg(id::bigint order by id) spot_ids
  from feedbackgb.v_stores where is_active is true
)
select min(r.id::text)::uuid run_id, r.date_from business_date
from feedbackgb.poster_receipt_import_runs r
join feedbackgb.poster_receipt_analytics_runs a
  on a.run_id = r.id and a.methodology_version = 'poster-receipt-purchase-v1'
cross join params p
where r.status = 'accepted' and r.date_from = r.date_to
  and r.date_from between date '2026-09-16' and date '2026-09-22'
  and r.completed_at <= timestamptz '2026-10-01T14:30:16.276Z'
  and a.projected_at <= timestamptz '2026-10-01T14:30:16.276Z'
  and p.spot_ids <@ r.source_spot_ids
group by r.date_from having count(*) = 1;

-- P2: full internal relation graph used by read_store_penetration_analytics.
-- The final projection returns only aggregate counts, so no receipt/customer payload
-- or business rows leave the database while the same joins, DISTINCTs and groups run.
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
), catalog as materialized (
  select business_date, spot_id, product_id, modification_id,
    case when count(*) filter(where category_id is null) = 0
      and count(distinct category_id) = 1 then min(category_id) end category_id,
    case when count(distinct product_name) = 1 then min(product_name) end product_name
  from feedbackgb._store_analytics_latest_facts(
    date '2026-09-16', date '2026-09-22',
    (select spot_ids from params), timestamptz '2026-10-01T14:30:16.276Z'
  )
  group by business_date, spot_id, product_id, modification_id
), bridge as materialized (
  select distinct receipt_version_id, business_date, spot_id,
    product_id, modification_id
  from lines
), mapped as materialized (
  select b.*, c.category_id, c.product_name
  from bridge b left join catalog c
    using(business_date, spot_id, product_id, modification_id)
), category_links as materialized (
  select distinct receipt_version_id, business_date, spot_id, category_id
  from mapped where category_id is not null
), product_links as materialized (
  select distinct receipt_version_id, business_date, spot_id,
    product_id, modification_id, category_id, product_name
  from mapped
)
select
  (select count(*) from receipts) eligible_receipts,
  (select count(*) from lines) eligible_lines,
  (select count(*) from bridge) bridge_rows,
  (select count(*) from mapped) mapped_rows,
  (select count(*) from mapped where category_id is null) unmapped_rows,
  (select count(*) from category_links) category_link_rows,
  (select count(*) from product_links) product_link_rows,
  (select count(*) from (
    select category_id, count(distinct receipt_version_id)
    from category_links group by category_id
  ) c) category_groups,
  (select count(*) from (
    select product_id, modification_id, count(distinct receipt_version_id)
    from product_links group by product_id, modification_id
  ) p) product_groups;

rollback;
