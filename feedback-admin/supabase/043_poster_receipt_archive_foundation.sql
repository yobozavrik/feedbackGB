-- Foundation only: SQL runtime verification still required. No ingestion/partitions activated.
-- No existing sales facts/RPCs are changed. Keys live OUTSIDE the database.
begin;
-- Fail before any DDL if a partial/previous foundation exists; never silently skip tables.
do $$
begin
  if to_regnamespace('feedbackgb') is null then raise exception 'receipt_schema_missing'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='feedbackgb' and c.relname in ('poster_receipt_import_runs',
      'poster_receipt_source_payloads','poster_client_snapshots','poster_receipt_identities',
      'poster_receipt_versions','poster_receipt_line_versions','poster_receipt_field_registry'))
  then raise exception 'receipt_foundation_already_exists'; end if;
end $$;
create table feedbackgb.poster_receipt_import_runs (
  id uuid primary key,
  account_id text not null check (account_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  date_from date not null, date_to date not null,
  timezone text not null check (timezone = 'Europe/Kyiv'),
  parser_version text not null,
  status text not null default 'staging' check (status in ('staging','failed','accepted')),
  started_at timestamptz not null default now(), completed_at timestamptz,
  source_count bigint check (source_count >= 0), page_count integer check (page_count >= 0),
  error_code text check (error_code ~ '^[a-z_]{1,80}$'),
  check (date_from <= date_to),
  check (status <> 'accepted' or (completed_at is not null and source_count is not null and page_count is not null)),
  unique (id,account_id)
);

-- Full original response bytes: receipt header, products and unknown fields remain here.
-- AES-GCM AAD includes account + endpoint + object UUID; neither keys nor plaintext stored.
create table feedbackgb.poster_receipt_source_payloads (
  id uuid primary key,
  run_id uuid not null,
  account_id text not null,
  endpoint text not null check (endpoint in ('transactions.getTransactions','clients.getClient')),
  source_page integer check (source_page > 0),
  observed_at timestamptz not null,
  archive_format text not null check (archive_format = 'aes-256-gcm-v1'),
  key_id text not null check (key_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  nonce bytea not null check (octet_length(nonce)=12),
  auth_tag bytea not null check (octet_length(auth_tag)=16),
  ciphertext bytea not null check (octet_length(ciphertext) between 1 and 33554432),
  foreign key (run_id,account_id) references feedbackgb.poster_receipt_import_runs(id,account_id),
  check ((endpoint='transactions.getTransactions' and source_page is not null) or
         (endpoint='clients.getClient' and source_page is null)),
  unique (id,run_id,account_id,endpoint)
);
create unique index poster_receipt_payload_page_idx on feedbackgb.poster_receipt_source_payloads(run_id,source_page)
  where endpoint='transactions.getTransactions';

create table feedbackgb.poster_client_snapshots (
  id uuid primary key,
  account_id text not null, client_id bigint not null check (client_id>0),
  run_id uuid not null,
  source_payload_id uuid not null,
  source_endpoint text not null default 'clients.getClient' check (source_endpoint='clients.getClient'),
  observed_at timestamptz not null,
  foreign key (source_payload_id,run_id,account_id,source_endpoint)
    references feedbackgb.poster_receipt_source_payloads(id,run_id,account_id,endpoint),
  unique (id,run_id,account_id,client_id), unique (run_id,account_id,client_id)
);
create index poster_client_snapshot_lookup_idx on feedbackgb.poster_client_snapshots(account_id,client_id,observed_at desc);

-- Unpartitioned identities ensure global uniqueness even if the close date changes.
create table feedbackgb.poster_receipt_identities (
  id uuid primary key,
  account_id text not null,
  transaction_id bigint not null check (transaction_id>0),
  created_at timestamptz not null default now(),
  unique (account_id,transaction_id), unique (id,account_id)
);
create table feedbackgb.poster_receipt_versions (
  id uuid primary key,
  account_id text not null, identity_id uuid not null, run_id uuid not null,
  source_payload_id uuid not null,
  source_endpoint text not null default 'transactions.getTransactions' check (source_endpoint='transactions.getTransactions'),
  source_row_no integer not null check (source_row_no>0),
  spot_id bigint not null check (spot_id>0),
  source_date_close text not null,
  source_date_start text, source_date_start_new text,
  closed_at timestamptz, business_date date,
  observed_at timestamptz not null,
  client_id bigint check (client_id>=0), client_snapshot_id uuid,
  client_state text not null check (client_state in ('guest','pending','available','unavailable')),
  -- Native values are NOT labelled UAH. Monetary projection is blocked until field basis verified.
  sum_source text, paid_source text,
  paid_cash_source text, paid_card_source text, paid_bonus_source text,
  paid_certificate_source text, paid_third_party_source text, paid_ewallet_source text,
  round_sum_source text, tax_sum_source text,
  tip_sum_source text, tips_cash_source text, tips_card_source text,
  total_profit_source text, total_profit_netto_source text,
  money_basis text not null default 'unverified' check (money_basis in ('unverified','minor_uah','major_uah')),
  discount_percent numeric, bonus_percent numeric,
  source_fiscal_status integer, source_reason text, source_status integer,
  source_pay_type integer, source_card_type integer, source_payment_method_id bigint,
  source_user_id bigint, source_table_id bigint, source_guests_count integer,
  source_service_mode integer, source_processing_status integer,
  source_auto_accept boolean, source_application_id bigint,
  -- Free-text comments/card details/customer names stay only in encrypted original bytes.
  expected_line_count integer not null check (expected_line_count>=0),
  foreign key (identity_id,account_id) references feedbackgb.poster_receipt_identities(id,account_id),
  foreign key (source_payload_id,run_id,account_id,source_endpoint)
    references feedbackgb.poster_receipt_source_payloads(id,run_id,account_id,endpoint),
  foreign key (client_snapshot_id,run_id,account_id,client_id)
    references feedbackgb.poster_client_snapshots(id,run_id,account_id,client_id),
  check (((client_state='guest' and coalesce(client_id,0)=0 and client_snapshot_id is null) or
         (client_state='available' and client_id>0 and client_snapshot_id is not null) or
         (client_state in ('pending','unavailable') and client_id>0 and client_snapshot_id is null)) is true),
  unique (run_id,identity_id), unique (id,spot_id,business_date),
  unique (source_payload_id,source_row_no)
);
create index poster_receipt_version_identity_idx on feedbackgb.poster_receipt_versions(identity_id,observed_at desc);
create index poster_receipt_version_store_day_idx on feedbackgb.poster_receipt_versions(spot_id,business_date,run_id);
create index poster_receipt_version_run_idx on feedbackgb.poster_receipt_versions(run_id);
create index poster_receipt_version_client_idx on feedbackgb.poster_receipt_versions(account_id,client_id,business_date)
  where client_id>0;
create table feedbackgb.poster_receipt_line_versions (
  receipt_version_id uuid not null references feedbackgb.poster_receipt_versions(id),
  source_line_no integer not null check (source_line_no>0),
  product_id bigint, modification_id bigint, source_type integer, source_workshop_id bigint,
  -- Preserve repeats by ordinal, NOT unique(product_id). Complete line exists in encrypted page.
  quantity_source text, product_sum_source text, paid_source text,
  bonus_source text, bonus_accrual_source text, certificate_source text,
  product_price_source text, round_sum_source text,
  cost_source text, cost_netto_source text, profit_source text, profit_netto_source text,
  source_fiscal_company_id bigint, source_fiscal_status integer,
  source_tax_id bigint, source_tax_type integer, source_tax_fiscal integer,
  tax_sum_source text, tax_value_source text,
  quantity_unit text,
  quantity_basis text not null default 'unverified' check (quantity_basis in ('unverified','verified')),
  check (quantity_basis <> 'verified' or quantity_unit is not null),
  discount_percent numeric,
  primary key (receipt_version_id,source_line_no)
);
create index poster_receipt_line_product_idx on feedbackgb.poster_receipt_line_versions(product_id,receipt_version_id);

create table feedbackgb.poster_receipt_field_registry (
  endpoint text not null, field_path text not null, observed_type text not null,
  unit_basis text, verification_state text not null default 'unverified'
    check (verification_state in ('unverified','verified')),
  evidence_ref text, updated_at timestamptz not null default now(),
  primary key (endpoint,field_path,observed_type),
  check (verification_state <> 'verified' or (unit_basis is not null and evidence_ref is not null))
);

-- Defense against accidental mutation; correction = new immutable version, not overwrite.
create function feedbackgb.reject_poster_receipt_archive_mutation() returns trigger
language plpgsql set search_path=feedbackgb,pg_temp as $$
begin raise exception 'poster_receipt_archive_immutable'; end;
$$;
create trigger poster_receipt_payload_immutable before update or delete on feedbackgb.poster_receipt_source_payloads
  for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();
create trigger poster_client_snapshot_immutable before update or delete on feedbackgb.poster_client_snapshots
  for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();
create trigger poster_receipt_version_immutable before update or delete on feedbackgb.poster_receipt_versions
  for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();
create trigger poster_receipt_line_immutable before update or delete on feedbackgb.poster_receipt_line_versions
  for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();

alter table feedbackgb.poster_receipt_import_runs enable row level security;
alter table feedbackgb.poster_receipt_source_payloads enable row level security;
alter table feedbackgb.poster_client_snapshots enable row level security;
alter table feedbackgb.poster_receipt_identities enable row level security;
alter table feedbackgb.poster_receipt_versions enable row level security;
alter table feedbackgb.poster_receipt_line_versions enable row level security;
alter table feedbackgb.poster_receipt_field_registry enable row level security;
revoke all on table feedbackgb.poster_receipt_import_runs,feedbackgb.poster_receipt_source_payloads,
  feedbackgb.poster_client_snapshots,feedbackgb.poster_receipt_identities,feedbackgb.poster_receipt_versions,
  feedbackgb.poster_receipt_line_versions,feedbackgb.poster_receipt_field_registry from public,anon,authenticated,service_role;
revoke all on function feedbackgb.reject_poster_receipt_archive_mutation() from public,anon,authenticated,service_role;
-- No application grants yet. Atomic validated publication and audited private access come next.
-- No analytics view: raw/unverified/incomplete projections must not become dashboard measures.
commit;
