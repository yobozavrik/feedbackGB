-- Forward-only performance fix after full-day RPC SQL57014 cancellation.
-- Requires applied045. Same policy/ACL/constraints/locks/manifest/validation/atomic publish-last.
-- Set-based INSERT, not partial chunks: entire network day remains one transaction.
-- No global role timeout changes, no source rewrite, no ingestion enable.
begin;
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
  end loop;
  insert into feedbackgb.poster_receipt_source_payloads(id,run_id,account_id,endpoint,source_page,source_item_count,
      observed_at,archive_format,key_id,nonce,auth_tag,ciphertext,raw_body,source_sha256)
    select (p->>'id')::uuid,v_run,v_account,p->>'endpoint',
      (p->>'source_page')::integer,(p->>'source_item_count')::integer,
      v_observed,p->>'archive_format',p->>'key_id',
      decode(p->>'nonce','base64'),decode(p->>'auth_tag','base64'),decode(p->>'ciphertext','base64'),
      p->>'raw_body',p->>'source_sha256' from jsonb_array_elements(p_bundle->'payloads') b(p);

  if (select count(*) from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='transactions.getTransactions')<>v_pages
    or exists(select 1 from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='transactions.getTransactions'
      and (source_item_count is null or source_page>v_pages))
    or (select coalesce(sum(source_item_count),0) from feedbackgb.poster_receipt_source_payloads
      where run_id=v_run and endpoint='transactions.getTransactions')<>v_count
    then raise exception 'receipt_bundle_incomplete'; end if;

  for v_client in select value from jsonb_array_elements(p_bundle->'clients') loop
    if jsonb_typeof(v_client)<>'object' or exists(select 1 from jsonb_object_keys(v_client) k where k not in
      ('id','client_id','source_payload_id')) then raise exception 'receipt_bundle_invalid'; end if;
  end loop;
  insert into feedbackgb.poster_client_snapshots(id,account_id,client_id,run_id,source_payload_id,observed_at)
      select (c->>'id')::uuid,v_account,(c->>'client_id')::bigint,v_run,(c->>'source_payload_id')::uuid,v_observed from jsonb_array_elements(p_bundle->'clients') b(c);

  -- Every client source page is consumed exactly once by one observed profile.
  if (select count(*) from feedbackgb.poster_receipt_source_payloads where run_id=v_run and endpoint='clients.getClient')
    <>jsonb_array_length(p_bundle->'clients') or exists(
      select 1 from feedbackgb.poster_receipt_source_payloads p where p.run_id=v_run and p.endpoint='clients.getClient'
      and (select count(*) from feedbackgb.poster_client_snapshots s where s.run_id=v_run and s.source_payload_id=p.id)<>1)
    then raise exception 'receipt_bundle_incomplete'; end if;

  -- Validate all source contracts BEFORE set-based publication. No skipped records.
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where jsonb_typeof(r)<>'object'
      or exists(select 1 from jsonb_object_keys(r) k where k not in
        ('transaction_id','spot_id','source_payload_id','source_row_no','projection','lines'))
      or jsonb_typeof(r->'projection') is distinct from 'object'
      or jsonb_typeof(r->'lines') is distinct from 'array')
    then raise exception 'receipt_bundle_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where r->'projection'->>'source_date_close' is null
      or left(r->'projection'->>'source_date_close',11)<>(v_day::text||' '))
    then raise exception 'receipt_date_unverified'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where (r->>'spot_id')::bigint is null or not ((r->>'spot_id')::bigint=any(v_spots)))
    then raise exception 'receipt_unknown_spot'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where exists(select 1 from jsonb_object_keys(r->'projection') k where k not in
      ('source_date_close','source_date_start','source_date_start_new','client_id',
       'sum_source','paid_source','paid_cash_source','paid_card_source','paid_bonus_source',
       'paid_certificate_source','paid_third_party_source','paid_ewallet_source','round_sum_source',
       'tax_sum_source','tip_sum_source','tips_cash_source','tips_card_source','total_profit_source',
       'total_profit_netto_source','discount_percent','bonus_percent','source_fiscal_status','source_reason',
       'source_status','source_pay_type','source_card_type','source_payment_method_id','source_user_id',
       'source_table_id','source_guests_count','source_service_mode','source_processing_status','source_auto_accept','source_application_id'))
      or jsonb_array_length(r->'lines')>5000)
    then raise exception 'receipt_bundle_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where not exists(select 1 from feedbackgb.poster_receipt_source_payloads p
      where p.id=(r->>'source_payload_id')::uuid and p.run_id=v_run and p.endpoint='transactions.getTransactions'
        and (r->>'source_row_no')::integer between 1 and p.source_item_count))
    then raise exception 'receipt_bundle_incomplete'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    where coalesce((r->'projection'->>'client_id')::bigint,0)>0 and not exists(
      select 1 from feedbackgb.poster_client_snapshots c where c.run_id=v_run and c.account_id=v_account
        and c.client_id=(r->'projection'->>'client_id')::bigint))
    then raise exception 'receipt_client_incomplete'; end if;
  if exists(select 1 from jsonb_array_elements(p_bundle->'receipts') b(r)
    cross join lateral jsonb_array_elements(r->'lines') z(l)
    where jsonb_typeof(l)<>'object' or exists(select 1 from jsonb_object_keys(l) k where k not in
      ('product_id','modification_id','source_type','source_workshop_id','quantity_source','product_sum_source',
         'paid_source','bonus_source','bonus_accrual_source','certificate_source','product_price_source','round_sum_source',
         'cost_source','cost_netto_source','profit_source','profit_netto_source','source_fiscal_company_id','source_fiscal_status',
         'source_tax_id','source_tax_type','source_tax_fiscal','tax_sum_source','tax_value_source','discount_percent'))
      or coalesce(l->>'product_id','') !~ '^[1-9][0-9]*$' or l->>'quantity_source' is null)
    then raise exception 'receipt_bundle_invalid'; end if;

  insert into feedbackgb.poster_receipt_identities(id,account_id,transaction_id)
    select gen_random_uuid(),v_account,x.transaction_id from (
      select distinct (r->>'transaction_id')::bigint as transaction_id
      from jsonb_array_elements(p_bundle->'receipts') b(r)
    ) x
    on conflict (account_id,transaction_id) do nothing;

  insert into feedbackgb.poster_receipt_versions
    select populated.*
    from jsonb_array_elements(p_bundle->'receipts') b(r)
    join feedbackgb.poster_receipt_identities i on i.account_id=v_account and i.transaction_id=(r->>'transaction_id')::bigint
    left join feedbackgb.poster_client_snapshots c on c.run_id=v_run and c.account_id=v_account
      and c.client_id=coalesce((r->'projection'->>'client_id')::bigint,0)
    cross join lateral jsonb_populate_record(null::feedbackgb.poster_receipt_versions,
      (r->'projection')||jsonb_build_object(
        'id',gen_random_uuid(),'account_id',v_account,'identity_id',i.id,'run_id',v_run,
        'source_payload_id',(r->>'source_payload_id')::uuid,'source_endpoint','transactions.getTransactions',
        'source_row_no',(r->>'source_row_no')::integer,'spot_id',(r->>'spot_id')::bigint,'observed_at',v_observed,
        'client_id',coalesce((r->'projection'->>'client_id')::bigint,0),'client_snapshot_id',c.id,
        'client_state',case when coalesce((r->'projection'->>'client_id')::bigint,0)=0 then 'guest' else 'available' end,
        'money_basis','unverified','expected_line_count',jsonb_array_length(r->'lines'))) as populated;

  insert into feedbackgb.poster_receipt_line_versions
    select populated.*
    from jsonb_array_elements(p_bundle->'receipts') b(r)
    join feedbackgb.poster_receipt_versions v on v.run_id=v_run
      and v.source_payload_id=(r->>'source_payload_id')::uuid and v.source_row_no=(r->>'source_row_no')::integer
    cross join lateral jsonb_array_elements(r->'lines') with ordinality z(l,ordinality)
    cross join lateral jsonb_populate_record(null::feedbackgb.poster_receipt_line_versions,
      l||jsonb_build_object('receipt_version_id',v.id,'source_line_no',z.ordinality::integer,
        'quantity_basis','unverified')) as populated;

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
commit;
