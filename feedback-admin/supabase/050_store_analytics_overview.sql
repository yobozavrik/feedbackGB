-- Read-only store/network overview over verified foodcost sales runs and accepted
-- receipt archives. No raw receipt or customer payload is exposed.
begin;

create function feedbackgb.read_store_analytics_overview(
  p_from date,
  p_to date,
  p_spot_ids bigint[] default null,
  p_compare_from date default null,
  p_compare_to date default null,
  p_as_of timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Kyiv')::date;
  v_spots bigint[];
  v_label text;
  v_from date;
  v_to date;
  v_expected integer;
  v_completed integer;
  v_receipt_expected integer;
  v_receipt_completed integer;
  v_revenue numeric;
  v_profit numeric;
  v_profit_netto numeric;
  v_netto_complete boolean;
  v_oldest timestamptz;
  v_newest timestamptz;
  v_missing jsonb;
  v_receipt_missing jsonb;
  v_trend jsonb;
  v_stores jsonb;
  v_receipts bigint;
  v_clients bigint;
  v_summary jsonb;
  v_current jsonb;
  v_comparison jsonb;
begin
  if p_from is null or p_to is null or p_from < date '2026-01-01'
    or p_from > p_to or p_to >= v_today or p_to - p_from > 365
    or p_as_of is null or p_as_of > clock_timestamp() + interval '1 minute' then
    raise exception 'store_analytics_scope_invalid';
  end if;
  if (p_compare_from is null) <> (p_compare_to is null) then
    raise exception 'store_analytics_comparison_invalid';
  end if;
  if p_compare_from is not null and (
    p_compare_from < date '2026-01-01' or p_compare_from > p_compare_to
    or p_compare_to >= v_today or p_compare_to - p_compare_from <> p_to - p_from
  ) then
    raise exception 'store_analytics_comparison_invalid';
  end if;

  select array_agg(id::bigint order by id) into v_spots
  from feedbackgb.v_stores where is_active is true;
  if v_spots is null or cardinality(v_spots) = 0 then
    raise exception 'store_analytics_roster_unavailable';
  end if;
  if p_spot_ids is not null then
    if cardinality(p_spot_ids) not between 1 and 100
      or array_position(p_spot_ids, null) is not null
      or exists(select 1 from unnest(p_spot_ids) s where s <= 0)
      or cardinality(p_spot_ids) <> (select count(distinct s) from unnest(p_spot_ids) s)
      or exists(select 1 from unnest(p_spot_ids) s where not s = any(v_spots)) then
      raise exception 'store_analytics_spots_invalid';
    end if;
    select array_agg(s order by s) into v_spots from unnest(p_spot_ids) s;
  end if;

  for v_label, v_from, v_to in
    select * from (values ('current'::text, p_from, p_to),
      ('comparison'::text, p_compare_from, p_compare_to)) w(label, date_from, date_to)
    where date_from is not null
  loop
    v_expected := (v_to - v_from + 1) * cardinality(v_spots);

    with latest as materialized (
      select distinct on (r.business_date, r.spot_id)
        r.id, r.business_date, r.spot_id, r.payed_sum_minor,
        r.product_profit_minor, r.product_profit_netto_minor, r.source_fetched_at
      from feedbackgb.foodcost_sales_runs r
      where r.status = 'completed' and r.business_date between v_from and v_to
        and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
      order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
    )
    select count(*), coalesce(sum(payed_sum_minor), 0),
      coalesce(sum(product_profit_minor), 0),
      case when count(*) filter (where product_profit_netto_minor is null) = 0
        then coalesce(sum(product_profit_netto_minor), 0) else null end,
      count(*) filter (where product_profit_netto_minor is null) = 0,
      min(source_fetched_at), max(source_fetched_at)
    into v_completed, v_revenue, v_profit, v_profit_netto,
      v_netto_complete, v_oldest, v_newest
    from latest;

    with expected as (
      select d::date business_date, s spot_id
      from generate_series(v_from, v_to, interval '1 day') d
      cross join unnest(v_spots) s
    ), latest as materialized (
      select distinct on (r.business_date, r.spot_id) r.business_date, r.spot_id
      from feedbackgb.foodcost_sales_runs r
      where r.status = 'completed' and r.business_date between v_from and v_to
        and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
      order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
    )
    select coalesce(jsonb_agg(jsonb_build_object('date', e.business_date,
      'spotId', e.spot_id) order by e.business_date, e.spot_id), '[]'::jsonb)
    into v_missing from (select e.* from expected e left join latest l using(business_date, spot_id)
      where l.business_date is null order by e.business_date, e.spot_id limit 500) e;

    if v_completed = v_expected then
      with latest as materialized (
        select distinct on (r.business_date, r.spot_id)
          r.business_date, r.spot_id, r.payed_sum_minor, r.product_profit_minor,
          r.product_profit_netto_minor
        from feedbackgb.foodcost_sales_runs r
        where r.status = 'completed' and r.business_date between v_from and v_to
          and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
        order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', business_date,
        'revenueMinor', revenue::text,
        'profitMinor', profit::text,
        'classicFoodcostPercent', case when revenue > 0
          then round((revenue - profit) * 100.0 / revenue, 2)::text else null end
      ) order by business_date), '[]'::jsonb)
      into v_trend from (select business_date, sum(payed_sum_minor)::numeric revenue,
        sum(product_profit_minor)::numeric profit from latest group by business_date) d;

      with latest as materialized (
        select distinct on (r.business_date, r.spot_id)
          r.business_date, r.spot_id, r.payed_sum_minor, r.product_profit_minor,
          r.product_profit_netto_minor
        from feedbackgb.foodcost_sales_runs r
        where r.status = 'completed' and r.business_date between v_from and v_to
          and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
        order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'spotId', x.spot_id, 'storeName', s.name,
        'revenueMinor', x.revenue::text, 'profitMinor', x.profit::text,
        'classicFoodcostPercent', case when x.revenue > 0
          then round((x.revenue - x.profit) * 100.0 / x.revenue, 2)::text else null end
      ) order by x.revenue desc, x.spot_id), '[]'::jsonb)
      into v_stores from (select spot_id, sum(payed_sum_minor)::numeric revenue,
        sum(product_profit_minor)::numeric profit from latest group by spot_id) x
      join feedbackgb.v_stores s on s.id = x.spot_id;
    else
      v_trend := '[]'::jsonb;
      v_stores := '[]'::jsonb;
    end if;

    v_receipt_expected := v_to - v_from + 1;
    with days as (select d::date business_date from generate_series(v_from, v_to, interval '1 day') d),
    day_runs as (
      select r.date_from business_date, count(*) run_count, max(r.id) run_id
      from feedbackgb.poster_receipt_import_runs r
      where r.status = 'accepted' and r.date_from = r.date_to
        and r.date_from between v_from and v_to and r.completed_at <= p_as_of
        and v_spots <@ r.source_spot_ids
      group by r.date_from
    )
    select count(*) filter (where dr.run_count = 1),
      coalesce(jsonb_agg(d.business_date order by d.business_date)
        filter (where coalesce(dr.run_count, 0) <> 1), '[]'::jsonb)
    into v_receipt_completed, v_receipt_missing
    from days d left join day_runs dr using(business_date);

    if v_receipt_completed = v_receipt_expected then
      with accepted as (
        select max(r.id) run_id from feedbackgb.poster_receipt_import_runs r
        where r.status = 'accepted' and r.date_from = r.date_to
          and r.date_from between v_from and v_to and r.completed_at <= p_as_of
          and v_spots <@ r.source_spot_ids group by r.date_from having count(*) = 1
      )
      select count(*), count(distinct (r.account_id, r.client_id)) filter (where r.client_id > 0)
      into v_receipts, v_clients from feedbackgb.poster_receipt_versions r
      where r.run_id in (select run_id from accepted) and r.spot_id = any(v_spots);
    else
      v_receipts := null;
      v_clients := null;
    end if;

    v_summary := jsonb_build_object(
      'from', v_from, 'to', v_to,
      'status', case when v_completed = v_expected then 'complete' else 'incomplete' end,
      'expectedCells', v_expected, 'completedCells', v_completed,
      'missingCount', v_expected - v_completed, 'missing', v_missing,
      'sourceFetchedOldestAt', v_oldest, 'sourceFetchedNewestAt', v_newest,
      'metrics', case when v_completed = v_expected then jsonb_build_object(
        'revenueMinor', v_revenue::text, 'profitMinor', v_profit::text,
        'profitNettoMinor', case when v_netto_complete then v_profit_netto::text else null end,
        'classicFoodcostPercent', case when v_revenue > 0
          then round((v_revenue - v_profit) * 100.0 / v_revenue, 2)::text else null end,
        'nettoFoodcostPercent', case when v_netto_complete and v_revenue > 0
          then round((v_revenue - v_profit_netto) * 100.0 / v_revenue, 2)::text else null end
      ) else null end,
      'trend', v_trend, 'stores', v_stores,
      'receipts', jsonb_build_object(
        'status', case when v_receipt_completed = v_receipt_expected then 'complete' else 'incomplete' end,
        'expectedDays', v_receipt_expected, 'completedDays', v_receipt_completed,
        'missingDates', v_receipt_missing,
        'receiptCount', v_receipts, 'identifiedClientCount', v_clients,
        'averageCheckMinor', null,
        'averageCheckReason', 'receipt_money_basis_unverified'
      )
    );
    if v_label = 'current' then v_current := v_summary; else v_comparison := v_summary; end if;
  end loop;

  return jsonb_build_object(
    'methodologyVersion', 'store-analytics-overview-v1',
    'asOf', p_as_of,
    'timezone', 'Europe/Kyiv',
    'historicalRosterVerified', false,
    'spotIds', to_jsonb(v_spots),
    'current', v_current,
    'comparison', v_comparison
  );
end;
$$;

revoke all on function feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)
  to service_role;

commit;
