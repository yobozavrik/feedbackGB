-- Verified receipt analytics projection and product bridge.
-- Forward-only; requires accepted immutable receipt history from 043-049.
-- Raw payloads and customer fields remain inaccessible.
begin;

do $$
begin
  if to_regclass('feedbackgb.poster_receipt_import_runs') is null
    or to_regclass('feedbackgb.poster_receipt_versions') is null
    or to_regclass('feedbackgb.poster_receipt_line_versions') is null
    or to_regprocedure('feedbackgb.audit_poster_receipt_day(date,uuid)') is null
  then raise exception 'receipt_analytics_source_missing'; end if;
  if to_regclass('feedbackgb.poster_receipt_analytics_runs') is not null
    or to_regclass('feedbackgb.poster_receipt_analytics_facts') is not null
    or to_regclass('feedbackgb.poster_receipt_line_analytics_facts') is not null
  then raise exception 'receipt_analytics_projection_already_exists'; end if;
end $$;

create function feedbackgb._poster_receipt_major_to_minor(p_value text)
returns bigint language plpgsql immutable strict
set search_path = feedbackgb, pg_temp
as $$
declare v_value numeric;
begin
  if length(p_value) > 64 or p_value !~ '^-?[0-9]+([.][0-9]{1,2})?$'
    then raise exception 'receipt_money_basis_invalid'; end if;
  v_value := p_value::numeric * 100;
  if v_value < -9223372036854775808::numeric or v_value > 9223372036854775807::numeric
    then raise exception 'receipt_money_basis_invalid'; end if;
  return v_value::bigint;
end;
$$;

create function feedbackgb._poster_receipt_quantity(p_value text)
returns numeric language plpgsql immutable strict
set search_path = feedbackgb, pg_temp
as $$
begin
  if length(p_value) > 64 or p_value !~ '^-?[0-9]+([.][0-9]+)?$'
    then raise exception 'receipt_quantity_basis_invalid'; end if;
  return p_value::numeric;
end;
$$;

create table feedbackgb.poster_receipt_analytics_runs (
  run_id uuid primary key references feedbackgb.poster_receipt_import_runs(id),
  business_date date not null,
  methodology_version text not null check (methodology_version = 'poster-receipt-purchase-v1'),
  receipt_count bigint not null check (receipt_count >= 0),
  line_count bigint not null check (line_count >= 0),
  eligible_receipt_count bigint not null check (eligible_receipt_count >= 0),
  fiscal_return_count bigint not null check (fiscal_return_count >= 0),
  other_excluded_count bigint not null check (other_excluded_count >= 0),
  paid_minor_total numeric not null,
  eligible_paid_minor numeric not null,
  line_paid_minor_total numeric not null,
  projected_at timestamptz not null default clock_timestamp(),
  check (eligible_receipt_count + fiscal_return_count + other_excluded_count = receipt_count),
  check (paid_minor_total = line_paid_minor_total)
);

create table feedbackgb.poster_receipt_analytics_facts (
  receipt_version_id uuid primary key references feedbackgb.poster_receipt_versions(id),
  run_id uuid not null references feedbackgb.poster_receipt_import_runs(id),
  identity_id uuid not null references feedbackgb.poster_receipt_identities(id),
  business_date date not null,
  spot_id bigint not null check (spot_id > 0),
  paid_minor bigint not null,
  line_count integer not null check (line_count >= 0),
  has_identified_client boolean not null,
  fiscal_return boolean not null,
  eligibility_status text not null check (eligibility_status in
    ('eligible','fiscal_return','closed_without_payment','non_positive_paid','no_lines')),
  unique (run_id, receipt_version_id)
);

create table feedbackgb.poster_receipt_line_analytics_facts (
  receipt_version_id uuid not null,
  source_line_no integer not null check (source_line_no > 0),
  run_id uuid not null,
  business_date date not null,
  spot_id bigint not null check (spot_id > 0),
  product_id bigint not null check (product_id > 0),
  modification_id bigint not null check (modification_id >= 0),
  quantity numeric not null,
  paid_minor bigint not null,
  eligible_purchase boolean not null,
  primary key (receipt_version_id, source_line_no),
  foreign key (run_id, receipt_version_id)
    references feedbackgb.poster_receipt_analytics_facts(run_id, receipt_version_id)
);

create index poster_receipt_analytics_day_store_idx
  on feedbackgb.poster_receipt_analytics_facts(business_date, spot_id, run_id);
create index poster_receipt_analytics_eligible_day_store_idx
  on feedbackgb.poster_receipt_analytics_facts(business_date, spot_id, run_id)
  where eligibility_status = 'eligible';
create index poster_receipt_line_analytics_product_idx
  on feedbackgb.poster_receipt_line_analytics_facts(product_id, modification_id, business_date, spot_id)
  where eligible_purchase;
create index poster_receipt_line_analytics_receipt_idx
  on feedbackgb.poster_receipt_line_analytics_facts(run_id, receipt_version_id)
  where eligible_purchase;

create view feedbackgb.v_poster_receipt_product_bridge
with (security_barrier = true) as
select distinct run_id, business_date, spot_id, receipt_version_id, product_id, modification_id
from feedbackgb.poster_receipt_line_analytics_facts
where eligible_purchase;

create function feedbackgb._project_poster_receipt_analytics_run(p_run_id uuid)
returns jsonb language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_run feedbackgb.poster_receipt_import_runs%rowtype;
  v_receipts bigint;
  v_lines bigint;
  v_existing feedbackgb.poster_receipt_analytics_runs%rowtype;
begin
  if p_run_id is null then raise exception 'receipt_analytics_run_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended('poster-receipt-analytics:' || p_run_id::text, 0));
  select * into v_run from feedbackgb.poster_receipt_import_runs where id = p_run_id for share;
  if not found or v_run.status <> 'accepted' or v_run.date_from <> v_run.date_to
    then raise exception 'receipt_analytics_run_invalid'; end if;

  select * into v_existing from feedbackgb.poster_receipt_analytics_runs where run_id = p_run_id;
  if found then
    return jsonb_build_object('status','projected','replayed',true,'run_id',p_run_id,
      'day',v_existing.business_date,'receipts',v_existing.receipt_count,
      'lines',v_existing.line_count,'eligible_receipts',v_existing.eligible_receipt_count);
  end if;

  select count(*), coalesce(sum(r.expected_line_count),0)
    into v_receipts, v_lines
  from feedbackgb.poster_receipt_versions r where r.run_id = p_run_id;
  if v_receipts <> v_run.source_count
    or v_lines <> (select count(*) from feedbackgb.poster_receipt_line_versions l
      join feedbackgb.poster_receipt_versions r on r.id=l.receipt_version_id
      where r.run_id=p_run_id)
  then raise exception 'receipt_analytics_source_incomplete'; end if;

  if exists(
    select 1 from feedbackgb.poster_receipt_versions r
    where r.run_id=p_run_id and (r.paid_source is null or length(r.paid_source)>64
      or r.paid_source !~ '^-?[0-9]+([.][0-9]{1,2})?$')
  ) or exists(
    select 1 from feedbackgb.poster_receipt_line_versions l
    join feedbackgb.poster_receipt_versions r on r.id=l.receipt_version_id
    where r.run_id=p_run_id and (l.paid_source is null or length(l.paid_source)>64
      or l.paid_source !~ '^-?[0-9]+([.][0-9]{1,2})?$'
      or l.quantity_source is null or length(l.quantity_source)>64
      or l.quantity_source !~ '^-?[0-9]+([.][0-9]+)?$')
  ) then raise exception 'receipt_analytics_basis_invalid'; end if;

  if exists(
    select 1
    from feedbackgb.poster_receipt_versions r
    left join lateral (
      select count(*) line_count,
        coalesce(sum(feedbackgb._poster_receipt_major_to_minor(l.paid_source)),0)::numeric line_paid
      from feedbackgb.poster_receipt_line_versions l where l.receipt_version_id=r.id
    ) x on true
    where r.run_id=p_run_id and (x.line_count<>r.expected_line_count
      or x.line_paid<>feedbackgb._poster_receipt_major_to_minor(r.paid_source)::numeric)
  ) then raise exception 'receipt_analytics_reconciliation_failed'; end if;

  insert into feedbackgb.poster_receipt_analytics_facts(
    receipt_version_id,run_id,identity_id,business_date,spot_id,paid_minor,line_count,
    has_identified_client,fiscal_return,eligibility_status)
  select r.id,r.run_id,r.identity_id,v_run.date_from,r.spot_id,
    feedbackgb._poster_receipt_major_to_minor(r.paid_source),r.expected_line_count,
    coalesce(r.client_id,0)>0,coalesce(r.source_fiscal_status=2,false),
    case
      when r.source_fiscal_status=2 then 'fiscal_return'
      when coalesce(nullif(btrim(r.source_reason),''),'0')<>'0' then 'closed_without_payment'
      when feedbackgb._poster_receipt_major_to_minor(r.paid_source)<=0 then 'non_positive_paid'
      when r.expected_line_count=0 then 'no_lines'
      else 'eligible'
    end
  from feedbackgb.poster_receipt_versions r where r.run_id=p_run_id;

  insert into feedbackgb.poster_receipt_line_analytics_facts(
    receipt_version_id,source_line_no,run_id,business_date,spot_id,product_id,
    modification_id,quantity,paid_minor,eligible_purchase)
  select l.receipt_version_id,l.source_line_no,f.run_id,f.business_date,f.spot_id,l.product_id,
    coalesce(l.modification_id,0),feedbackgb._poster_receipt_quantity(l.quantity_source),
    feedbackgb._poster_receipt_major_to_minor(l.paid_source),
    f.eligibility_status='eligible' and feedbackgb._poster_receipt_quantity(l.quantity_source)>0
  from feedbackgb.poster_receipt_line_versions l
  join feedbackgb.poster_receipt_analytics_facts f on f.receipt_version_id=l.receipt_version_id
  where f.run_id=p_run_id;

  insert into feedbackgb.poster_receipt_analytics_runs(
    run_id,business_date,methodology_version,receipt_count,line_count,eligible_receipt_count,
    fiscal_return_count,other_excluded_count,paid_minor_total,eligible_paid_minor,line_paid_minor_total)
  select p_run_id,v_run.date_from,'poster-receipt-purchase-v1',count(*),v_lines,
    count(*) filter(where eligibility_status='eligible'),
    count(*) filter(where eligibility_status='fiscal_return'),
    count(*) filter(where eligibility_status not in ('eligible','fiscal_return')),
    coalesce(sum(paid_minor),0)::numeric,
    coalesce(sum(paid_minor) filter(where eligibility_status='eligible'),0)::numeric,
    (select coalesce(sum(paid_minor),0)::numeric
      from feedbackgb.poster_receipt_line_analytics_facts where run_id=p_run_id)
  from feedbackgb.poster_receipt_analytics_facts where run_id=p_run_id;

  select * into strict v_existing from feedbackgb.poster_receipt_analytics_runs where run_id=p_run_id;
  return jsonb_build_object('status','projected','replayed',false,'run_id',p_run_id,
    'day',v_existing.business_date,'receipts',v_existing.receipt_count,
    'lines',v_existing.line_count,'eligible_receipts',v_existing.eligible_receipt_count,
    'fiscal_returns',v_existing.fiscal_return_count,
    'other_excluded',v_existing.other_excluded_count);
end;
$$;

create function feedbackgb.project_poster_receipt_analytics_day(p_day date)
returns jsonb language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
declare v_run uuid; v_count integer;
begin
  if p_day is null or p_day<date '2026-01-01'
    or p_day >= (clock_timestamp() at time zone 'Europe/Kyiv')::date
    then raise exception 'receipt_analytics_day_invalid'; end if;
  select count(*), min(id::text)::uuid into v_count,v_run
  from feedbackgb.poster_receipt_import_runs
  where status='accepted' and date_from=p_day and date_to=p_day;
  if v_count=0 then return jsonb_build_object('status','missing_source','day',p_day); end if;
  if v_count<>1 then raise exception 'receipt_analytics_source_ambiguous'; end if;
  return feedbackgb._project_poster_receipt_analytics_run(v_run);
end;
$$;

create function feedbackgb.audit_poster_receipt_analytics_day(p_day date)
returns jsonb language plpgsql stable security definer
set search_path = feedbackgb, pg_temp
as $$
declare v_source uuid; v_count integer; v_row feedbackgb.poster_receipt_analytics_runs%rowtype;
begin
  select count(*),min(id::text)::uuid into v_count,v_source
  from feedbackgb.poster_receipt_import_runs
  where status='accepted' and date_from=p_day and date_to=p_day;
  if v_count=0 then return jsonb_build_object('status','missing_source','day',p_day); end if;
  if v_count<>1 then return jsonb_build_object('status','ambiguous_source','day',p_day,'run_count',v_count); end if;
  select * into v_row from feedbackgb.poster_receipt_analytics_runs where run_id=v_source;
  if not found then return jsonb_build_object('status','missing_projection','day',p_day); end if;
  if v_row.receipt_count<>(select count(*) from feedbackgb.poster_receipt_analytics_facts where run_id=v_source)
    or v_row.line_count<>(select count(*) from feedbackgb.poster_receipt_line_analytics_facts where run_id=v_source)
    or v_row.paid_minor_total<>v_row.line_paid_minor_total
    then return jsonb_build_object('status','invalid','day',p_day); end if;
  return jsonb_build_object('status','verified','day',p_day,
    'methodology_version',v_row.methodology_version,'receipts',v_row.receipt_count,
    'lines',v_row.line_count,'eligible_receipts',v_row.eligible_receipt_count,
    'fiscal_returns',v_row.fiscal_return_count,'other_excluded',v_row.other_excluded_count,
    'paid_minor_total',v_row.paid_minor_total::text,
    'eligible_paid_minor',v_row.eligible_paid_minor::text);
end;
$$;

create function feedbackgb.capture_poster_receipt_analytics_projection()
returns trigger language plpgsql security definer
set search_path = feedbackgb, pg_temp
as $$
begin
  if old.status is distinct from 'accepted' and new.status='accepted' then
    perform feedbackgb._project_poster_receipt_analytics_run(new.id);
  end if;
  return new;
end;
$$;

create trigger poster_receipt_capture_analytics_projection
after update of status on feedbackgb.poster_receipt_import_runs
for each row execute function feedbackgb.capture_poster_receipt_analytics_projection();

create trigger poster_receipt_analytics_run_immutable
before update or delete on feedbackgb.poster_receipt_analytics_runs
for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();
create trigger poster_receipt_analytics_fact_immutable
before update or delete on feedbackgb.poster_receipt_analytics_facts
for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();
create trigger poster_receipt_line_analytics_fact_immutable
before update or delete on feedbackgb.poster_receipt_line_analytics_facts
for each row execute function feedbackgb.reject_poster_receipt_archive_mutation();

insert into feedbackgb.poster_receipt_field_registry(endpoint,field_path,observed_type,unit_basis,verification_state,evidence_ref)
values
 ('transactions.getTransactions','response.data[].payed_sum','string','major_uah_x100_to_minor','verified','S-11 live parity 2026-07-31,2026-08-15,2026-08-31,2026-09-01,2026-09-15,2026-09-16,2026-09-28'),
 ('transactions.getTransactions','response.data[].products[].payed_sum','string','major_uah_x100_to_minor','verified','S-11 live line/header/dashboard parity on seven completed days'),
 ('transactions.getTransactions','response.data[].products[].num','number','signed_decimal_quantity; positive=purchase line','verified','S-11 live quantity shape plus explicit fiscal-return exclusion')
on conflict (endpoint,field_path,observed_type) do update set
  unit_basis=excluded.unit_basis,verification_state=excluded.verification_state,
  evidence_ref=excluded.evidence_ref,updated_at=clock_timestamp();

alter table feedbackgb.poster_receipt_analytics_runs enable row level security;
alter table feedbackgb.poster_receipt_analytics_facts enable row level security;
alter table feedbackgb.poster_receipt_line_analytics_facts enable row level security;

revoke all on table feedbackgb.poster_receipt_analytics_runs,
  feedbackgb.poster_receipt_analytics_facts,
  feedbackgb.poster_receipt_line_analytics_facts from public,anon,authenticated,service_role;
revoke all on feedbackgb.v_poster_receipt_product_bridge from public,anon,authenticated,service_role;
revoke all on function feedbackgb._poster_receipt_major_to_minor(text),
  feedbackgb._poster_receipt_quantity(text),
  feedbackgb._project_poster_receipt_analytics_run(uuid),
  feedbackgb.capture_poster_receipt_analytics_projection()
  from public,anon,authenticated,service_role;
revoke all on function feedbackgb.project_poster_receipt_analytics_day(date),
  feedbackgb.audit_poster_receipt_analytics_day(date)
  from public,anon,authenticated,service_role;
grant execute on function feedbackgb.project_poster_receipt_analytics_day(date),
  feedbackgb.audit_poster_receipt_analytics_day(date) to service_role;

commit;
