-- Read-only, service-role-only checkpoint for resumable one-day imports.
-- Returns counts and integrity diagnostics, never raw receipts or customer data.
-- Apply after 043/044/046 in the existing feedbackgb schema. No public objects.
begin;

create function feedbackgb.audit_poster_receipt_day(p_day date, p_run_id uuid default null)
returns jsonb language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_runs integer;
  v_accepted integer;
  v_run feedbackgb.poster_receipt_import_runs%rowtype;
  v_receipts bigint;
  v_expected_lines bigint;
  v_lines bigint;
  v_clients bigint;
  v_distinct_clients bigint;
  v_stores bigint;
  v_duplicate_identities bigint;
  v_client_link_errors bigint;
  v_line_count_mismatches bigint;
  v_source_pages bigint;
  v_source_items bigint;
  v_invalid_payloads bigint;
  v_page_mismatches bigint;
  v_identity_compared bigint;
  v_identity_mismatches bigint;
  v_verified boolean;
begin
  if p_day is null or p_day < date '2026-01-01' then
    raise exception 'receipt_audit_day_invalid';
  end if;

  select count(*), count(*) filter (where status = 'accepted')
    into v_runs, v_accepted
  from feedbackgb.poster_receipt_import_runs
  where date_from = p_day and date_to = p_day;

  if v_runs = 0 then
    return jsonb_build_object('status', 'missing', 'day', p_day);
  end if;
  if v_runs <> 1 or v_accepted <> 1 then
    return jsonb_build_object('status', 'ambiguous', 'day', p_day,
      'run_count', v_runs, 'accepted_count', v_accepted);
  end if;

  select * into strict v_run
  from feedbackgb.poster_receipt_import_runs
  where date_from = p_day and date_to = p_day and status = 'accepted';

  if p_run_id is not null and p_run_id <> v_run.id then
    return jsonb_build_object('status', 'run_mismatch', 'day', p_day,
      'run_id', v_run.id);
  end if;

  select count(*), coalesce(sum(expected_line_count), 0),
    count(distinct spot_id), count(*) - count(distinct identity_id),
    count(distinct client_id) filter (where client_id > 0),
    count(*) filter (where client_id > 0 and
      (client_snapshot_id is null or not exists (
        select 1 from feedbackgb.poster_client_snapshots c
        where c.id = r.client_snapshot_id and c.client_id = r.client_id
          and c.run_id = v_run.id))),
    count(*) filter (where expected_line_count <> (
      select count(*) from feedbackgb.poster_receipt_line_versions l
      where l.receipt_version_id = r.id))
  into v_receipts, v_expected_lines, v_stores, v_duplicate_identities,
    v_distinct_clients, v_client_link_errors, v_line_count_mismatches
  from feedbackgb.poster_receipt_versions r
  where r.run_id = v_run.id;

  select count(*) into v_lines
  from feedbackgb.poster_receipt_line_versions l
  join feedbackgb.poster_receipt_versions r on r.id = l.receipt_version_id
  where r.run_id = v_run.id;

  select count(*) into v_clients
  from feedbackgb.poster_client_snapshots c where c.run_id = v_run.id;

  select count(*) filter (where endpoint = 'transactions.getTransactions'),
    coalesce(sum(source_item_count) filter
      (where endpoint = 'transactions.getTransactions'), 0),
    count(*) filter (where archive_format <> 'raw-utf8-v1'
      or raw_body is null
      or source_sha256 is distinct from
        encode(pg_catalog.sha256(convert_to(raw_body, 'UTF8')), 'hex')),
    count(*) filter (where endpoint = 'transactions.getTransactions' and (
      (raw_body::json -> 'response' ->> 'count')::bigint is distinct from v_run.source_count
      or (raw_body::json -> 'response' -> 'page' ->> 'count')::integer
        is distinct from source_item_count
      or json_array_length(raw_body::json -> 'response' -> 'data')
        is distinct from source_item_count))
  into v_source_pages, v_source_items, v_invalid_payloads, v_page_mismatches
  from feedbackgb.poster_receipt_source_payloads p
  where p.run_id = v_run.id;

  with source_rows as materialized (
    select p.id as payload_id, z.ordinality as row_no, z.value as source_record
    from feedbackgb.poster_receipt_source_payloads p
    cross join lateral json_array_elements(p.raw_body::json -> 'response' -> 'data')
      with ordinality z(value, ordinality)
    where p.run_id = v_run.id and p.endpoint = 'transactions.getTransactions'
  )
  select count(*), count(*) filter (where
    (s.source_record ->> 'transaction_id')::bigint is distinct from i.transaction_id
    or (s.source_record ->> 'spot_id')::bigint is distinct from r.spot_id
    or coalesce((s.source_record ->> 'client_id')::bigint, 0) is distinct from r.client_id
    or s.source_record ->> 'date_close' is distinct from r.source_date_close
    or json_array_length(s.source_record -> 'products') is distinct from r.expected_line_count)
  into v_identity_compared, v_identity_mismatches
  from feedbackgb.poster_receipt_versions r
  join feedbackgb.poster_receipt_identities i on i.id = r.identity_id
  join source_rows s on s.payload_id = r.source_payload_id and s.row_no = r.source_row_no
  where r.run_id = v_run.id;

  v_verified := v_receipts = v_run.source_count
    and v_source_items = v_run.source_count
    and v_source_pages = v_run.page_count
    and v_expected_lines = v_lines
    and v_clients = v_distinct_clients
    and v_invalid_payloads = 0 and v_page_mismatches = 0
    and v_duplicate_identities = 0 and v_client_link_errors = 0
    and v_line_count_mismatches = 0 and v_identity_compared = v_receipts
    and v_identity_mismatches = 0;

  return jsonb_build_object(
    'status', case when v_verified then 'verified' else 'invalid' end,
    'day', p_day, 'run_id', v_run.id,
    'receipts', v_receipts, 'declared_receipts', v_run.source_count,
    'lines', v_lines, 'declared_lines', v_expected_lines,
    'clients', v_clients, 'source_pages', v_source_pages,
    'source_items', v_source_items, 'stores_with_receipts', v_stores,
    'invalid_payloads', v_invalid_payloads,
    'page_mismatches', v_page_mismatches,
    'identity_compared', v_identity_compared,
    'identity_mismatches', v_identity_mismatches,
    'client_link_errors', v_client_link_errors,
    'duplicate_identities', v_duplicate_identities,
    'line_count_mismatches', v_line_count_mismatches);
end;
$$;

revoke all on function feedbackgb.audit_poster_receipt_day(date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function feedbackgb.audit_poster_receipt_day(date, uuid)
  to service_role;

commit;
