select jsonb_build_object(
  'reader_exists',to_regprocedure('feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamp with time zone,bigint)') is not null,
  'service_execute',has_function_privilege('service_role','feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamp with time zone,bigint)','execute'),
  'anon_execute_denied',not has_function_privilege('anon','feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamp with time zone,bigint)','execute'),
  'authenticated_execute_denied',not has_function_privilege('authenticated','feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamp with time zone,bigint)','execute')
) as store_penetration_reader_readback;

with sample as (
  select feedbackgb.read_store_penetration_analytics(
    date '2026-09-16',date '2026-09-22',null,clock_timestamp(),null) value
)
select jsonb_build_object(
  'status',value->>'status',
  'eligible_receipts',value->'denominator'->>'eligibleReceipts',
  'mapping_status',value->'mapping'->>'status',
  'bridge_rows',value->'mapping'->>'bridgeRows',
  'mapped_rows',value->'mapping'->>'mappedRows',
  'unmapped_rows',value->'mapping'->>'unmappedRows',
  'category_count',jsonb_array_length(value->'categories'),
  'product_count',jsonb_array_length(value->'products'),
  'category_receipts_within_denominator',not exists(
    select 1 from jsonb_array_elements(value->'categories') row
    where (row->>'receiptCount')::bigint>(value->'denominator'->>'eligibleReceipts')::bigint),
  'historical_roster_verified',value->'historicalRosterVerified'
) as store_penetration_sample
from sample;
