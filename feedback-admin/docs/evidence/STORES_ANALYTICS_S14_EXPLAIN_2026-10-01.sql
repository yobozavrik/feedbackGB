-- S-14 read-only SQL Editor probe. It creates and changes no database objects or rows.
-- Run as one script and retain every JSON plan as evidence before changing indexes.
begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

-- Confirm the roster used by every plan. Expected on 2026-10-01: 26 unique stores.
select count(*) as store_count,
  count(distinct id) as distinct_store_count,
  array_agg(id order by id) as spot_ids
from feedbackgb.v_stores;

explain (analyze, buffers, wal, settings, format json)
select feedbackgb.read_store_analytics_overview(
  date '2026-09-16',
  date '2026-09-22',
  (select array_agg(id order by id)::bigint[] from feedbackgb.v_stores),
  null,
  null,
  timestamptz '2026-10-01T14:30:16.276Z'
);

explain (analyze, buffers, wal, settings, format json)
select feedbackgb.read_store_category_product_analytics(
  date '2026-09-16',
  date '2026-09-22',
  (select array_agg(id order by id)::bigint[] from feedbackgb.v_stores),
  null,
  null,
  timestamptz '2026-10-01T14:30:16.276Z',
  null,
  false,
  null,
  null,
  '',
  'revenue',
  'desc',
  25,
  0
);

explain (analyze, buffers, wal, settings, format json)
select feedbackgb.read_store_penetration_analytics(
  date '2026-09-16',
  date '2026-09-22',
  (select array_agg(id order by id)::bigint[] from feedbackgb.v_stores),
  timestamptz '2026-10-01T14:30:16.276Z',
  null
);

rollback;
