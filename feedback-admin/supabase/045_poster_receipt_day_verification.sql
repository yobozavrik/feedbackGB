-- Read-only audit of latest accepted whole-network day28/09. Never returns raw/PII values.
with target as (
  select * from feedbackgb.poster_receipt_import_runs
  where status='accepted' and date_from=date '2026-09-28' and date_to=date '2026-09-28'
  order by completed_at desc,id desc limit 1
), payloads as materialized (
  select p.* from feedbackgb.poster_receipt_source_payloads p join target t on t.id=p.run_id
), source_records as materialized (
  select p.id as payload_id,s.ordinality as row_no,s.value as source_record
  from payloads p cross join lateral json_array_elements(p.raw_body::json->'response'->'data')
    with ordinality as s(value,ordinality)
  where p.endpoint='transactions.getTransactions'
), receipts as materialized (
  select r.*,i.transaction_id,
    s.source_record,
    to_jsonb(r) as projected
  from feedbackgb.poster_receipt_versions r join target t on t.id=r.run_id
  join feedbackgb.poster_receipt_identities i on i.id=r.identity_id
  join source_records s on s.payload_id=r.source_payload_id and s.row_no=r.source_row_no
), lines as materialized (
  select l.*,r.source_record->'products'->(l.source_line_no-1) as source_line,
    to_jsonb(l) as projected
  from feedbackgb.poster_receipt_line_versions l join receipts r on r.id=l.receipt_version_id
), clients as materialized (
  select c.*,p.raw_body::json->'response'->0 as source_profile
  from feedbackgb.poster_client_snapshots c join target t on t.id=c.run_id join payloads p on p.id=c.source_payload_id
), header_map(source_field,projection_field,kind) as (values
('date_close','source_date_close','text'),
('date_start','source_date_start','text'),
('date_start_new','source_date_start_new','text'),
('sum','sum_source','text'),
('payed_sum','paid_source','text'),
('payed_cash','paid_cash_source','text'),
('payed_card','paid_card_source','text'),
('payed_bonus','paid_bonus_source','text'),
('payed_cert','paid_certificate_source','text'),
('payed_third_party','paid_third_party_source','text'),
('payed_ewallet','paid_ewallet_source','text'),
('round_sum','round_sum_source','text'),
('tax_sum','tax_sum_source','text'),
('tip_sum','tip_sum_source','text'),
('tips_cash','tips_cash_source','text'),
('tips_card','tips_card_source','text'),
('total_profit','total_profit_source','text'),
('total_profit_netto','total_profit_netto_source','text'),
('discount','discount_percent','numeric'),
('bonus','bonus_percent','numeric'),
('print_fiscal','source_fiscal_status','numeric'),
('reason','source_reason','numeric'),
('status','source_status','numeric'),
('pay_type','source_pay_type','numeric'),
('payed_card_type','source_card_type','numeric'),
('payment_method_id','source_payment_method_id','numeric'),
('user_id','source_user_id','numeric'),
('table_id','source_table_id','numeric'),
('guests_count','source_guests_count','numeric'),
('service_mode','source_service_mode','numeric'),
('processing_status','source_processing_status','numeric'),
('auto_accept','source_auto_accept','text'),
('application_id','source_application_id','numeric')
), line_map(source_field,projection_field,kind) as (values
('product_id','product_id','numeric'),
('modification_id','modification_id','numeric'),
('type','source_type','numeric'),
('workshop_id','source_workshop_id','numeric'),
('num','quantity_source','text'),
('product_sum','product_sum_source','text'),
('payed_sum','paid_source','text'),
('bonus_sum','bonus_source','text'),
('bonus_accrual','bonus_accrual_source','text'),
('cert_sum','certificate_source','text'),
('product_price','product_price_source','text'),
('round_sum','round_sum_source','text'),
('product_cost','cost_source','text'),
('product_cost_netto','cost_netto_source','text'),
('product_profit','profit_source','text'),
('product_profit_netto','profit_netto_source','text'),
('fiscal_company_id','source_fiscal_company_id','numeric'),
('print_fiscal','source_fiscal_status','numeric'),
('tax_id','source_tax_id','numeric'),
('tax_type','source_tax_type','numeric'),
('tax_fiscal','source_tax_fiscal','numeric'),
('tax_sum','tax_sum_source','text'),
('tax_value','tax_value_source','text'),
('discount','discount_percent','numeric')
)
select jsonb_build_object(
 'accepted_run_found',exists(select 1 from target),
 'run_id',(select id from target),
 'declared_receipts',(select source_count from target),
 'actual_receipts',(select count(*) from receipts),
 'actual_product_lines',(select count(*) from lines),
 'declared_product_lines',(select coalesce(sum(expected_line_count),0) from receipts),
 'client_snapshots',(select count(*) from clients),
 'referenced_clients',(select count(distinct client_id) from receipts where client_id>0),
 'source_pages',(select count(*) from payloads where endpoint='transactions.getTransactions'),
 'declared_pages',(select page_count from target),
 'raw_payloads',(select count(*) from payloads where archive_format='raw-utf8-v1'),
 'all_payloads',(select count(*) from payloads),
 'hash_mismatches',(select count(*) from payloads where raw_body is null or source_sha256 is distinct from encode(pg_catalog.sha256(convert_to(raw_body,'UTF8')),'hex')),
 'source_page_count_mismatches',(select count(*) from payloads where endpoint='transactions.getTransactions' and (
   (raw_body::json->'response'->>'count')::bigint is distinct from (select source_count from target)
   or (raw_body::json->'response'->'page'->>'count')::integer is distinct from source_item_count
   or json_array_length(raw_body::json->'response'->'data') is distinct from source_item_count
   or (raw_body::json->'response'->'page'->>'page')::integer is distinct from source_page)),
 'receipt_identity_mismatches',(select count(*) from receipts where
   (source_record->>'transaction_id')::bigint is distinct from transaction_id
   or (source_record->>'spot_id')::bigint is distinct from spot_id
   or coalesce((source_record->>'client_id')::bigint,0) is distinct from client_id
   or source_record->>'date_close' is distinct from source_date_close
   or json_array_length(source_record->'products') is distinct from expected_line_count),
 'header_field_mismatches',(select count(*) from receipts r cross join header_map m where case
   when m.kind='numeric' then (r.source_record->>m.source_field)::numeric is distinct from (r.projected->>m.projection_field)::numeric
   else (r.source_record->>m.source_field) is distinct from (r.projected->>m.projection_field) end),
 'line_field_mismatches',(select count(*) from lines l cross join line_map m where case
   when m.kind='numeric' then (l.source_line->>m.source_field)::numeric is distinct from (l.projected->>m.projection_field)::numeric
   else (l.source_line->>m.source_field) is distinct from (l.projected->>m.projection_field) end),
 'client_identity_mismatches',(select count(*) from clients where (source_profile->>'client_id')::bigint is distinct from client_id),
 'client_link_errors',(select count(*) from receipts r where r.client_id>0 and not exists(select 1 from clients c where c.id=r.client_snapshot_id and c.client_id=r.client_id)),
 'receipt_line_count_mismatches',(select count(*) from receipts r where expected_line_count<>(select count(*) from lines l where l.receipt_version_id=r.id)),
 'duplicate_receipt_identities',(select count(*) from (select identity_id from receipts group by identity_id having count(*)>1) d),
 'stores_with_receipts',(select count(distinct spot_id) from receipts),
 'declared_current_stores',(select cardinality(source_spot_ids) from target)
) as receipt_day_verification;
