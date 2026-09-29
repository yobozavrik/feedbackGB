-- User decision 2026-09-29: new full receipt/client source stored WITHOUT encryption.
-- Forward-only. Requires applied043/044. Keeps old AES rows untouched and all RLS/ACL/FKs/triggers.
-- NO ingestion enable, no data rewrite, no source API calls. Raw source contains personal data.
begin;
do $$
begin
  if to_regprocedure('feedbackgb.import_poster_receipt_bundle(jsonb)') is null
    then raise exception 'receipt_atomic_schema_missing'; end if;
end $$;
alter table feedbackgb.poster_receipt_source_payloads
  add column raw_body text,
  add column source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$');
alter table feedbackgb.poster_receipt_source_payloads
  alter column key_id drop not null,
  alter column nonce drop not null,
  alter column auth_tag drop not null,
  alter column ciphertext drop not null,
  drop constraint poster_receipt_source_payloads_archive_format_check;
alter table feedbackgb.poster_receipt_source_payloads
  add constraint poster_receipt_source_payloads_archive_format_check
    check (archive_format in ('aes-256-gcm-v1','raw-utf8-v1')),
  add constraint poster_receipt_source_payloads_storage_shape_check check ((
    (archive_format='aes-256-gcm-v1'
      and key_id is not null and nonce is not null and auth_tag is not null and ciphertext is not null
      and raw_body is null and source_sha256 is null)
    or (archive_format='raw-utf8-v1'
      and key_id is null and nonce is null and auth_tag is null and ciphertext is null
      and raw_body is not null and octet_length(raw_body) between 1 and 33554432
      and source_sha256 is not null
      and source_sha256=encode(pg_catalog.sha256(convert_to(raw_body,'UTF8')),'hex'))
  ) is true);
comment on column feedbackgb.poster_receipt_source_payloads.raw_body is
  'Exact original UTF-8 JSON, UNENCRYPTED. Contains personal data. No browser/anon/authenticated/service direct access.';
comment on column feedbackgb.poster_receipt_source_payloads.source_sha256 is
  'SHA-256 of exact UTF-8 source bytes. Integrity only, NOT encryption/authentication.';
create or replace function feedbackgb.import_poster_receipt_bundle(p_bundle jsonb) returns jsonb
language plpgsql security definer set search_path=feedbackgb,pg_temp as $$
declare
  v_run uuid; v_account text; v_day date; v_spot bigint; v_spots bigint[]; v_count integer; v_pages integer;
  v_hash text; v_existing feedbackgb.poster_receipt_import_runs%rowtype;
  v_payload jsonb; v_receipt jsonb; v_client jsonb; v_line jsonb;
  v_identity uuid; v_version uuid; v_page_id uuid; v_ordinal integer;
  v_observed timestamptz; v_projection jsonb; v_client_id bigint; v_client_snapshot uuid;
begin
  if not exists(select 1 from feedbackgb.poster_receipt_ingest_policy where singleton and enabled)
    then raise exception 'receipt_ingestion_disabled'; end if;
  if p_bundle is null or jsonb_typeof(p_bundle)<>'object' or octet_length(p_bundle::text)>16777216
    then raise exception 'receipt_bundle_invalid'; end if;
  if exists(select 1 from jsonb_object_keys(p_bundle) k where k not in
    ('run_id','account_id','business_date','spot_ids','parser_version','observed_at',
     'source_count','page_count','payloads','clients','receipts'))
    then raise exception 'receipt_bundle_invalid'; end if;
  v_run:=(p_bundle->>'run_id')::uuid; v_account:=p_bundle->>'account_id';
  v_day:=(p_bundle->>'business_date')::date;
  if jsonb_typeof(p_bundle->'spot_ids') is distinct from 'array' then raise exception 'receipt_bundle_invalid'; end if;
  select array_agg(value::bigint order by value::bigint) into v_spots from jsonb_array_elements_text(p_bundle->'spot_ids');
  v_observed:=(p_bundle->>'observed_at')::timestamptz;
  v_count:=(p_bundle->>'source_count')::integer; v_pages:=(p_bundle->>'page_count')::integer;
  if v_run is null or v_account is null or v_account !~ '^[A-Za-z0-9_.:-]{1,128}$'
    or v_day is null or v_day<date '2026-01-01'
    or v_day >= (statement_timestamp() at time zone 'Europe/Kyiv')::date
    or v_spots is null or cardinality(v_spots)>100 or array_position(v_spots,null) is not null
    or exists(select 1 from unnest(v_spots) s where s<=0)
    or (select count(distinct s) from unnest(v_spots) s)<>cardinality(v_spots)
    or v_count is null or v_count<0 or v_count>20000
    or v_pages is null or v_pages<1 or v_pages>128
    or v_observed is null or v_observed>statement_timestamp()+interval '1 minute'
    or coalesce(p_bundle->>'parser_version','') !~ '^[A-Za-z0-9_.:-]{1,64}$'
    then raise exception 'receipt_bundle_invalid'; end if;
  if jsonb_typeof(p_bundle->'payloads') is distinct from 'array'
    or jsonb_typeof(p_bundle->'clients') is distinct from 'array'
    or jsonb_typeof(p_bundle->'receipts') is distinct from 'array'
    then raise exception 'receipt_bundle_invalid'; end if;
  if jsonb_array_length(p_bundle->'receipts')<>v_count
    or jsonb_array_length(p_bundle->'clients')>v_count
    or jsonb_array_length(p_bundle->'payloads')>v_count+v_pages
    then raise exception 'receipt_bundle_incomplete'; end if;

  v_hash:=encode(pg_catalog.sha256(convert_to(p_bundle::text,'UTF8')),'hex');
  -- Fixed lock order. Same run ID cannot race, even across two different accounts.
  perform pg_advisory_xact_lock(hashtextextended('poster-receipt-run:'||v_run::text,0));
  perform pg_advisory_xact_lock(hashtextextended('poster-receipt-account:'||v_account,0));
  select * into v_existing from feedbackgb.poster_receipt_import_runs where id=v_run for update;
  if found then
    if v_existing.status='accepted' and v_existing.account_id=v_account and v_existing.bundle_sha256=v_hash then
      return jsonb_build_object('run_id',v_run,'status','accepted','replayed',true,'receipt_count',v_existing.source_count);
    end if;
    raise exception 'receipt_run_conflict';
  end if;
  if v_observed<statement_timestamp()-interval '2 hours' then raise exception 'receipt_bundle_stale'; end if;
  insert into feedbackgb.poster_receipt_import_runs(id,account_id,date_from,date_to,timezone,parser_version,
    source_count,page_count,bundle_sha256,source_spot_ids)
  values(v_run,v_account,v_day,v_day,'Europe/Kyiv',p_bundle->>'parser_version',v_count,v_pages,v_hash,v_spots);

  for v_payload in select value from jsonb_array_elements(p_bundle->'payloads') loop
    if jsonb_typeof(v_payload)<>'object' or exists(select 1 from jsonb_object_keys(v_payload) k where k not in
      ('id','endpoint','source_page','source_item_count','archive_format','key_id','nonce','auth_tag','ciphertext','raw_body','source_sha256'))
      then raise exception 'receipt_bundle_invalid'; end if;
    if v_payload->>'archive_format'='raw-utf8-v1' then
      if v_payload->>'raw_body' is null
        or octet_length(v_payload->>'raw_body') not between 1 and 33554432
        or (v_payload->>'source_sha256') is distinct from
          encode(pg_catalog.sha256(convert_to(v_payload->>'raw_body','UTF8')),'hex')
        or (v_payload->>'key_id') is not null or (v_payload->>'nonce') is not null
        or (v_payload->>'auth_tag') is not null or (v_payload->>'ciphertext') is not null
        then raise exception 'receipt_bundle_invalid'; end if;
      -- JSON (not JSONB): validate without rounding/normalizing original source text.
      if json_typeof((v_payload->>'raw_body')::json) is distinct from 'object'
        then raise exception 'receipt_bundle_invalid'; end if;
    elsif v_payload->>'archive_format'='aes-256-gcm-v1' then
      -- Legacy ciphertext retained as-is. Never label it plaintext or auto-decrypt old data.
      if (v_payload->>'raw_body') is not null or (v_payload->>'source_sha256') is not null
        then raise exception 'receipt_bundle_invalid'; end if;
    else raise exception 'receipt_bundle_invalid'; end if;
    insert into feedbackgb.poster_receipt_source_payloads(id,run_id,account_id,endpoint,source_page,source_item_count,
      observed_at,archive_format,key_id,nonce,auth_tag,ciphertext,raw_body,source_sha256)
    values((v_payload->>'id')::uuid,v_run,v_account,v_payload->>'endpoint',
      (v_payload->>'source_page')::integer,(v_payload->>'source_item_count')::integer,
      v_observed,v_payload->>'archive_format',v_payload->>'key_id',
      decode(v_payload->>'nonce','base64'),decode(v_payload->>'auth_tag','base64'),decode(v_payload->>'ciphertext','base64'),
      v_payload->>'raw_body',v_payload->>'source_sha256');
  end loop;
  if (select count(*) from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='transactions.getTransactions')<>v_pages
    or exists(select 1 from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='transactions.getTransactions'
      and (source_item_count is null or source_page>v_pages))
    or (select coalesce(sum(source_item_count),0) from feedbackgb.poster_receipt_source_payloads
      where run_id=v_run and endpoint='transactions.getTransactions')<>v_count
    then raise exception 'receipt_bundle_incomplete'; end if;

  for v_client in select value from jsonb_array_elements(p_bundle->'clients') loop
    if jsonb_typeof(v_client)<>'object' or exists(select 1 from jsonb_object_keys(v_client) k where k not in
      ('id','client_id','source_payload_id')) then raise exception 'receipt_bundle_invalid'; end if;
    insert into feedbackgb.poster_client_snapshots(id,account_id,client_id,run_id,source_payload_id,observed_at)
      values((v_client->>'id')::uuid,v_account,(v_client->>'client_id')::bigint,v_run,(v_client->>'source_payload_id')::uuid,v_observed);
  end loop;
  -- Every client source page is consumed exactly once by one observed profile.
  if (select count(*) from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='clients.getClient')
    <>jsonb_array_length(p_bundle->'clients') or exists(
      select 1 from feedbackgb.poster_receipt_source_payloads p where p.run_id=v_run and p.endpoint='clients.getClient'
      and (select count(*) from feedbackgb.poster_client_snapshots s where s.run_id=v_run and s.source_payload_id=p.id)<>1)
    then raise exception 'receipt_bundle_incomplete'; end if;

  for v_receipt in select value from jsonb_array_elements(p_bundle->'receipts') loop
    if jsonb_typeof(v_receipt)<>'object' or exists(select 1 from jsonb_object_keys(v_receipt) k where k not in
      ('transaction_id','spot_id','source_payload_id','source_row_no','projection','lines'))
      or jsonb_typeof(v_receipt->'projection') is distinct from 'object'
      or jsonb_typeof(v_receipt->'lines') is distinct from 'array'
      then raise exception 'receipt_bundle_invalid'; end if;
    v_projection:=v_receipt->'projection';
    if v_projection->>'source_date_close' is null
      or left(v_projection->>'source_date_close',11)<>(v_day::text||' ')
      then raise exception 'receipt_date_unverified'; end if;
    v_spot:=(v_receipt->>'spot_id')::bigint;
    if v_spot is null or not (v_spot=any(v_spots)) then raise exception 'receipt_unknown_spot'; end if;
    -- Explicit allowlist: no client names/comments/phones, arbitrary payload or writer-owned IDs.
    if exists(select 1 from jsonb_object_keys(v_projection) k where k not in
      ('source_date_close','source_date_start','source_date_start_new','client_id',
       'sum_source','paid_source','paid_cash_source','paid_card_source','paid_bonus_source',
       'paid_certificate_source','paid_third_party_source','paid_ewallet_source','round_sum_source',
       'tax_sum_source','tip_sum_source','tips_cash_source','tips_card_source','total_profit_source',
       'total_profit_netto_source','discount_percent','bonus_percent','source_fiscal_status','source_reason',
       'source_status','source_pay_type','source_card_type','source_payment_method_id','source_user_id',
       'source_table_id','source_guests_count','source_service_mode','source_processing_status','source_auto_accept','source_application_id'))
      then raise exception 'receipt_bundle_invalid'; end if;
    v_page_id:=(v_receipt->>'source_payload_id')::uuid;
    v_ordinal:=(v_receipt->>'source_row_no')::integer;
    if v_ordinal is null or not exists(select 1 from feedbackgb.poster_receipt_source_payloads p
      where p.id=v_page_id and p.run_id=v_run and p.endpoint='transactions.getTransactions'
      and v_ordinal between 1 and p.source_item_count)
      then raise exception 'receipt_bundle_incomplete'; end if;
    insert into feedbackgb.poster_receipt_identities(id,account_id,transaction_id)
      values(gen_random_uuid(),v_account,(v_receipt->>'transaction_id')::bigint)
      on conflict (account_id,transaction_id) do nothing;
    select id into strict v_identity from feedbackgb.poster_receipt_identities
      where account_id=v_account and transaction_id=(v_receipt->>'transaction_id')::bigint;
    v_version:=gen_random_uuid(); v_client_id:=coalesce((v_projection->>'client_id')::bigint,0);
    select id into v_client_snapshot from feedbackgb.poster_client_snapshots
      where run_id=v_run and account_id=v_account and client_id=v_client_id;
    -- No silent missing client: full bundle must enrich each referenced non-guest client.
    if v_client_id>0 and v_client_snapshot is null then raise exception 'receipt_client_incomplete'; end if;
    if jsonb_array_length(v_receipt->'lines')>5000 then raise exception 'receipt_bundle_invalid'; end if;
    insert into feedbackgb.poster_receipt_versions
      select (jsonb_populate_record(null::feedbackgb.poster_receipt_versions,v_projection||jsonb_build_object(
        'id',v_version,'account_id',v_account,'identity_id',v_identity,'run_id',v_run,
        'source_payload_id',v_page_id,'source_endpoint','transactions.getTransactions','source_row_no',v_ordinal,
        'spot_id',v_spot,'observed_at',v_observed,'client_id',v_client_id,'client_snapshot_id',v_client_snapshot,
        'client_state',case when v_client_id=0 then 'guest' else 'available' end,
        'money_basis','unverified','expected_line_count',jsonb_array_length(v_receipt->'lines')))).*;
    v_ordinal:=0;
    for v_line in select value from jsonb_array_elements(v_receipt->'lines') loop
      v_ordinal:=v_ordinal+1;
      if jsonb_typeof(v_line)<>'object' or exists(select 1 from jsonb_object_keys(v_line) k where k not in
        ('product_id','modification_id','source_type','source_workshop_id','quantity_source','product_sum_source',
         'paid_source','bonus_source','bonus_accrual_source','certificate_source','product_price_source','round_sum_source',
         'cost_source','cost_netto_source','profit_source','profit_netto_source','source_fiscal_company_id','source_fiscal_status',
         'source_tax_id','source_tax_type','source_tax_fiscal','tax_sum_source','tax_value_source','discount_percent'))
        then raise exception 'receipt_bundle_invalid'; end if;
      if coalesce(v_line->>'product_id','') !~ '^[1-9][0-9]*$' or v_line->>'quantity_source' is null
        then raise exception 'receipt_bundle_invalid'; end if;
      insert into feedbackgb.poster_receipt_line_versions
        select (jsonb_populate_record(null::feedbackgb.poster_receipt_line_versions,v_line||jsonb_build_object(
          'receipt_version_id',v_version,'source_line_no',v_ordinal,'quantity_basis','unverified'))).*;
    end loop;
  end loop;
  if (select count(*) from feedbackgb.poster_receipt_versions where run_id=v_run)<>v_count
    or exists(select 1 from feedbackgb.poster_client_snapshots s where s.run_id=v_run
      and not exists(select 1 from feedbackgb.poster_receipt_versions r where r.run_id=v_run and r.client_snapshot_id=s.id))
    then raise exception 'receipt_bundle_incomplete'; end if;
  -- Publish LAST. Any exception rolls back the entire RPC, including new identities.
  update feedbackgb.poster_receipt_import_runs set status='accepted',completed_at=clock_timestamp() where id=v_run;
  return jsonb_build_object('run_id',v_run,'status','accepted','replayed',false,'receipt_count',v_count);
exception
  when invalid_text_representation or invalid_parameter_value or numeric_value_out_of_range or datetime_field_overflow
    or not_null_violation or check_violation or foreign_key_violation or unique_violation then
      raise exception 'receipt_bundle_invalid';
end;
$$;
revoke all on function feedbackgb.import_poster_receipt_bundle(jsonb) from public,anon,authenticated,service_role;
grant execute on function feedbackgb.import_poster_receipt_bundle(jsonb) to service_role;
-- Explicitly keep all direct access closed; publishing is only through service RPC.
revoke all on table feedbackgb.poster_receipt_source_payloads from public,anon,authenticated,service_role;
commit;
