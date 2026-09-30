select jsonb_build_object(
  'function_exists', to_regprocedure(
    'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)'
  ) is not null,
  'comparison_total_outside_current_gate', position(
    'if v_compare_complete then' in pg_get_functiondef(to_regprocedure(
      'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)'
    ))
  ) < position(
    'if v_current_complete then' in pg_get_functiondef(to_regprocedure(
      'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)'
    ))
  )
) as store_catalog_comparison_fix_readback;

-- Regression: current incomplete, comparison complete. The comparison total
-- must remain the real non-zero total rather than the initialized zero.
select feedbackgb.read_store_category_product_analytics(
  date '2026-09-23', date '2026-09-29', null,
  date '2026-09-16', date '2026-09-22', clock_timestamp(),
  null, false, null, null, '', 'revenue', 'desc', 25, 0
) as incomplete_current_complete_comparison;

-- Acceptance sample: complete current period. Categories/products must be
-- populated and category revenue must reconcile to totalRevenueMinor.
with sample as (
  select feedbackgb.read_store_category_product_analytics(
    date '2026-09-16', date '2026-09-22', null,
    date '2026-09-09', date '2026-09-15', clock_timestamp(),
    null, false, null, null, '', 'revenue', 'desc', 25, 0
  ) value
)
select jsonb_build_object(
  'status', value #>> '{current,status}',
  'total_revenue_minor', value #>> '{current,totalRevenueMinor}',
  'category_count', jsonb_array_length(value->'categories'),
  'product_page_count', jsonb_array_length(value #> '{products,rows}'),
  'product_total', (value #>> '{products,total}')::integer,
  'category_revenue_minor', coalesce((
    select sum((category->>'revenueMinor')::numeric)::text
    from jsonb_array_elements(value->'categories') category
  ), '0'),
  'categories_reconcile', coalesce((
    select sum((category->>'revenueMinor')::numeric)
    from jsonb_array_elements(value->'categories') category
  ), 0) = (value #>> '{current,totalRevenueMinor}')::numeric
) as complete_period_acceptance
from sample;
