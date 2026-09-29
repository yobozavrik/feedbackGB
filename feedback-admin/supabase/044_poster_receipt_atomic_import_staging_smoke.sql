-- STAGING ONLY. Synthetic SQL integrity fixtures; NO Poster requests or real customer data.
-- On a SEPARATE staging DB, set feedbackgb.receipt_smoke_environment='staging' for your session.
-- Entire script ROLLBACKs; a success means these SQL cases passed, NOT ingestion/crypto/races.
begin;
do $$
declare
  v_run uuid:=gen_random_uuid(); v_page uuid:=gen_random_uuid();
  v_day date:=(statement_timestamp() at time zone 'Europe/Kyiv')::date-1;
  v_bundle jsonb; v_result jsonb; v_bad jsonb;
begin
  if current_setting('feedbackgb.receipt_smoke_environment',true) is distinct from 'staging'
    then raise exception 'receipt_smoke_staging_required'; end if;
  if (select enabled from feedbackgb.poster_receipt_ingest_policy where singleton)
    then raise exception 'receipt_smoke_requires_disabled_policy'; end if;
  v_bundle:=jsonb_build_object('run_id',v_run,'account_id','staging-receipt-smoke',
    'business_date',v_day,'spot_ids',jsonb_build_array('1'),'parser_version','sql-smoke-v1',
    'observed_at',statement_timestamp(),'source_count',0,'page_count',1,
    'clients','[]'::jsonb,'receipts','[]'::jsonb,
    'payloads',jsonb_build_array(jsonb_build_object('id',v_page,'endpoint','transactions.getTransactions',
      'source_page',1,'source_item_count',0,'archive_format','aes-256-gcm-v1','key_id','sql-fixture-not-real-key',
      'nonce',encode(decode(repeat('00',12),'hex'),'base64'),
      'auth_tag',encode(decode(repeat('00',16),'hex'),'base64'),
      'ciphertext',encode(convert_to('synthetic-sql-fixture','UTF8'),'base64'))));
  begin
    perform feedbackgb.import_poster_receipt_bundle(v_bundle);
    raise exception 'smoke_disabled_gate_failed';
  exception when raise_exception then
    if sqlerrm<>'receipt_ingestion_disabled' then raise; end if;
  end;
  update feedbackgb.poster_receipt_ingest_policy set enabled=true where singleton;
  v_bad:=jsonb_set(v_bundle,'{payloads}','[]'::jsonb);
  begin
    perform feedbackgb.import_poster_receipt_bundle(v_bad);
    raise exception 'smoke_missing_page_failed';
  exception when raise_exception then
    if sqlerrm<>'receipt_bundle_incomplete' then raise; end if;
  end;
  if exists(select 1 from feedbackgb.poster_receipt_import_runs where id=v_run)
    then raise exception 'smoke_partial_run_leaked'; end if;
  v_result:=feedbackgb.import_poster_receipt_bundle(v_bundle);
  if v_result->>'status'<>'accepted' or (v_result->>'replayed')::boolean
    then raise exception 'smoke_publish_failed'; end if;
  v_result:=feedbackgb.import_poster_receipt_bundle(v_bundle);
  if not (v_result->>'replayed')::boolean then raise exception 'smoke_replay_failed'; end if;
  begin
    perform feedbackgb.import_poster_receipt_bundle(jsonb_set(v_bundle,'{parser_version}','"sql-smoke-v2"'::jsonb));
    raise exception 'smoke_conflict_failed';
  exception when raise_exception then
    if sqlerrm<>'receipt_run_conflict' then raise; end if;
  end;
  begin
    update feedbackgb.poster_receipt_import_runs set parser_version='changed' where id=v_run;
    raise exception 'smoke_immutable_run_failed';
  exception when raise_exception then
    if sqlerrm<>'receipt_accepted_run_immutable' then raise; end if;
  end;
  -- Real receipt fixture: repeated product lines must survive, ordered separately.
  v_run:=gen_random_uuid(); v_page:=gen_random_uuid();
  v_bundle:=jsonb_set(v_bundle,'{run_id}',to_jsonb(v_run));
  v_bundle:=jsonb_set(v_bundle,'{source_count}','1'::jsonb);
  v_bundle:=jsonb_set(v_bundle,'{payloads,0,id}',to_jsonb(v_page));
  v_bundle:=jsonb_set(v_bundle,'{payloads,0,source_item_count}','1'::jsonb);
  v_bundle:=jsonb_set(v_bundle,'{receipts}',jsonb_build_array(jsonb_build_object(
    'transaction_id','1','spot_id','1','source_payload_id',v_page,'source_row_no',1,
    'projection',jsonb_build_object('source_date_close',v_day::text||' 12:00:00','client_id','0','sum_source','-12.50'),
    'lines',jsonb_build_array(jsonb_build_object('product_id','1','quantity_source','-0.5'),
                             jsonb_build_object('product_id','1','quantity_source','-0.5')))));
  perform feedbackgb.import_poster_receipt_bundle(v_bundle);
  if (select count(*) from feedbackgb.poster_receipt_line_versions l join feedbackgb.poster_receipt_versions r
        on r.id=l.receipt_version_id where r.run_id=v_run)<>2
    then raise exception 'smoke_repeated_lines_failed'; end if;
end $$;
rollback;
