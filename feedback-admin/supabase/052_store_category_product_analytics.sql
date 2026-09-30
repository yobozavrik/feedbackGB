-- Category and product analytics over verified foodcost sales snapshots.
-- Forward-only. Does not expose receipt payloads or customer data.
begin;

create function feedbackgb._store_analytics_latest_facts(
  p_from date,
  p_to date,
  p_spot_ids bigint[],
  p_as_of timestamptz
) returns table (
  business_date date,
  spot_id bigint,
  source_row_no integer,
  product_id bigint,
  modification_id bigint,
  category_id bigint,
  product_name text,
  category_name text,
  quantity numeric,
  unit text,
  weight_based boolean,
  revenue_minor bigint,
  profit_minor bigint
)
language sql
stable
security definer
set search_path = feedbackgb, pg_temp
as $$
  with latest as materialized (
    select distinct on (r.business_date, r.spot_id)
      r.id, r.business_date, r.spot_id
    from feedbackgb.foodcost_sales_runs r
    where r.status = 'completed'
      and r.business_date between p_from and p_to
      and r.spot_id = any(p_spot_ids)
      and r.completed_at <= p_as_of
    order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
  )
  select l.business_date, l.spot_id, f.source_row_no, f.product_id,
    f.modification_id, f.category_id_snapshot, f.product_name_snapshot,
    nullif(btrim(f.category_name_snapshot), ''), f.quantity, nullif(btrim(f.unit), ''),
    f.weight_based, f.payed_sum_minor, f.product_profit_minor
  from latest l
  join feedbackgb.foodcost_sales_facts f on f.run_id = l.id
$$;

revoke all on function feedbackgb._store_analytics_latest_facts(date,date,bigint[],timestamptz)
  from public, anon, authenticated, service_role;

create function feedbackgb.read_store_category_product_analytics(
  p_from date,
  p_to date,
  p_spot_ids bigint[] default null,
  p_compare_from date default null,
  p_compare_to date default null,
  p_as_of timestamptz default clock_timestamp(),
  p_category_id bigint default null,
  p_category_unknown boolean default false,
  p_product_id bigint default null,
  p_modification_id bigint default null,
  p_search text default '',
  p_sort text default 'revenue',
  p_direction text default 'desc',
  p_limit integer default 25,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = feedbackgb, pg_temp
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Kyiv')::date;
  v_spots bigint[];
  v_expected integer;
  v_completed integer;
  v_compare_expected integer := 0;
  v_compare_completed integer := 0;
  v_current_complete boolean;
  v_compare_complete boolean := false;
  v_missing jsonb;
  v_compare_missing jsonb := '[]'::jsonb;
  v_total_revenue numeric := 0;
  v_compare_total_revenue numeric := 0;
  v_categories jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_product_count integer := 0;
  v_trend jsonb := '[]'::jsonb;
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
  if p_category_id is not null and (p_category_id <= 0 or p_category_unknown) then
    raise exception 'store_analytics_filter_invalid';
  end if;
  if p_product_id is not null and p_product_id <= 0
    or p_modification_id is not null and (p_modification_id < 0 or p_product_id is null) then
    raise exception 'store_analytics_filter_invalid';
  end if;
  if p_search is null or length(p_search) > 80 or p_search ~ '[[:cntrl:]]'
    or p_sort not in ('revenue', 'change', 'name')
    or p_direction not in ('asc', 'desc')
    or p_limit not between 1 and 100 or p_offset not between 0 and 999999 then
    raise exception 'store_analytics_filter_invalid';
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

  v_expected := (p_to - p_from + 1) * cardinality(v_spots);
  select count(*) into v_completed from (
    select distinct on (r.business_date, r.spot_id) r.business_date, r.spot_id
    from feedbackgb.foodcost_sales_runs r
    where r.status = 'completed' and r.business_date between p_from and p_to
      and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
    order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
  ) x;
  v_current_complete := v_completed = v_expected;

  with expected as (
    select d::date business_date, s spot_id
    from generate_series(p_from, p_to, interval '1 day') d cross join unnest(v_spots) s
  ), available as (
    select distinct r.business_date, r.spot_id
    from feedbackgb.foodcost_sales_runs r
    where r.status = 'completed' and r.business_date between p_from and p_to
      and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
  )
  select coalesce(jsonb_agg(jsonb_build_object('date', e.business_date, 'spotId', e.spot_id)
    order by e.business_date, e.spot_id), '[]'::jsonb)
  into v_missing from (
    select e.* from expected e left join available a using (business_date, spot_id)
    where a.business_date is null order by e.business_date, e.spot_id limit 500
  ) e;

  if p_compare_from is not null then
    v_compare_expected := (p_compare_to - p_compare_from + 1) * cardinality(v_spots);
    select count(*) into v_compare_completed from (
      select distinct on (r.business_date, r.spot_id) r.business_date, r.spot_id
      from feedbackgb.foodcost_sales_runs r
      where r.status = 'completed' and r.business_date between p_compare_from and p_compare_to
        and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
      order by r.business_date, r.spot_id, r.completed_at desc, r.id desc
    ) x;
    v_compare_complete := v_compare_completed = v_compare_expected;
    with expected as (
      select d::date business_date, s spot_id
      from generate_series(p_compare_from, p_compare_to, interval '1 day') d cross join unnest(v_spots) s
    ), available as (
      select distinct r.business_date, r.spot_id
      from feedbackgb.foodcost_sales_runs r
      where r.status = 'completed' and r.business_date between p_compare_from and p_compare_to
        and r.spot_id = any(v_spots) and r.completed_at <= p_as_of
    )
    select coalesce(jsonb_agg(jsonb_build_object('date', e.business_date, 'spotId', e.spot_id)
      order by e.business_date, e.spot_id), '[]'::jsonb)
    into v_compare_missing from (
      select e.* from expected e left join available a using (business_date, spot_id)
      where a.business_date is null order by e.business_date, e.spot_id limit 500
    ) e;
  end if;

  if v_current_complete then
    select coalesce(sum(revenue_minor), 0) into v_total_revenue
    from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of);
    if v_compare_complete then
      select coalesce(sum(revenue_minor), 0) into v_compare_total_revenue
      from feedbackgb._store_analytics_latest_facts(p_compare_from, p_compare_to, v_spots, p_as_of);
    end if;

    select count(*) into v_product_count from (
      select product_id, modification_id, category_id, unit, weight_based
      from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of)
      where (p_category_id is null and not p_category_unknown
          or p_category_unknown and category_id is null
          or p_category_id is not null and category_id = p_category_id)
        and (p_product_id is null or product_id = p_product_id)
        and (p_modification_id is null or modification_id = p_modification_id)
        and (p_search = '' or position(lower(p_search) in lower(product_name)) > 0)
      group by product_id, modification_id, category_id, unit, weight_based
    ) product_identities;

    with current_rows as materialized (
      select category_id,
        min(coalesce(category_name, 'Без категорії')) category_name,
        count(distinct category_name) filter (where category_name is not null) > 1 name_conflict,
        sum(revenue_minor)::numeric revenue,
        sum(profit_minor)::numeric profit,
        count(distinct spot_id) filter (where quantity > 0) store_coverage,
        count(distinct product_id) distinct_products
      from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of)
      group by category_id
    ), previous_rows as materialized (
      select category_id, sum(revenue_minor)::numeric revenue
      from feedbackgb._store_analytics_latest_facts(p_compare_from, p_compare_to, v_spots, p_as_of)
      where v_compare_complete
      group by category_id
    ), joined as (
      select c.*, p.revenue previous_revenue
      from current_rows c left join previous_rows p on p.category_id is not distinct from c.category_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'categoryId', category_id, 'categoryName', category_name, 'categoryNameConflict', name_conflict,
      'revenueMinor', revenue::text,
      'revenueSharePercent', case when v_total_revenue > 0 then round(revenue * 100.0 / v_total_revenue, 2)::text else null end,
      'profitMinor', profit::text,
      'classicFoodcostPercent', case when revenue > 0 then round((revenue - profit) * 100.0 / revenue, 2)::text else null end,
      'storeCoverageCount', store_coverage, 'selectedStoreCount', cardinality(v_spots),
      'distinctProductCount', distinct_products,
      'previousRevenueMinor', case when v_compare_complete then coalesce(previous_revenue, 0)::text else null end,
      'deltaRevenueMinor', case when v_compare_complete then (revenue - coalesce(previous_revenue, 0))::text else null end,
      'deltaRevenuePercent', case when v_compare_complete and previous_revenue > 0
        then round((revenue - previous_revenue) * 100.0 / previous_revenue, 2)::text else null end,
      'deltaSharePoints', case when v_compare_complete and v_compare_total_revenue > 0 and v_total_revenue > 0
        then round(revenue * 100.0 / v_total_revenue - coalesce(previous_revenue, 0) * 100.0 / v_compare_total_revenue, 2)::text else null end
    ) order by revenue desc, category_id nulls last), '[]'::jsonb)
    into v_categories from joined;

    with current_rows as materialized (
      select product_id, modification_id, category_id, unit, weight_based,
        min(product_name) product_name, count(distinct product_name) > 1 name_conflict,
        min(coalesce(category_name, 'Без категорії')) category_name,
        count(distinct category_name) filter (where category_name is not null) > 1 category_name_conflict,
        sum(quantity)::numeric quantity, sum(revenue_minor)::numeric revenue,
        sum(profit_minor)::numeric profit,
        count(distinct spot_id) filter (where quantity > 0) store_coverage
      from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of)
      group by product_id, modification_id, category_id, unit, weight_based
    ), previous_rows as materialized (
      select product_id, modification_id, category_id, unit, weight_based,
        sum(quantity)::numeric quantity, sum(revenue_minor)::numeric revenue
      from feedbackgb._store_analytics_latest_facts(p_compare_from, p_compare_to, v_spots, p_as_of)
      where v_compare_complete
      group by product_id, modification_id, category_id, unit, weight_based
    ), joined as (
      select c.*, p.quantity previous_quantity, p.revenue previous_revenue
      from current_rows c left join previous_rows p
        on p.product_id = c.product_id and p.modification_id = c.modification_id
        and p.category_id is not distinct from c.category_id
        and p.unit is not distinct from c.unit and p.weight_based = c.weight_based
      where (p_category_id is null and not p_category_unknown
          or p_category_unknown and c.category_id is null
          or p_category_id is not null and c.category_id = p_category_id)
        and (p_product_id is null or c.product_id = p_product_id)
        and (p_modification_id is null or c.modification_id = p_modification_id)
        and (p_search = '' or position(lower(p_search) in lower(c.product_name)) > 0)
    ), counted as (
      select j.*,
        case when v_compare_complete then j.revenue - coalesce(j.previous_revenue, 0) else null end delta_revenue
      from joined j
    ), paged as (
      select * from counted
      order by
        case when p_sort = 'revenue' and p_direction = 'desc' then revenue end desc,
        case when p_sort = 'revenue' and p_direction = 'asc' then revenue end asc,
        case when p_sort = 'change' and p_direction = 'desc' then delta_revenue end desc nulls last,
        case when p_sort = 'change' and p_direction = 'asc' then delta_revenue end asc nulls last,
        case when p_sort = 'name' and p_direction = 'asc' then lower(product_name) end asc,
        case when p_sort = 'name' and p_direction = 'desc' then lower(product_name) end desc,
        product_id, modification_id, category_id nulls last, unit nulls last
      limit p_limit offset p_offset
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'productId', product_id, 'modificationId', modification_id,
      'productName', product_name, 'productNameConflict', name_conflict,
      'categoryId', category_id, 'categoryName', category_name,
      'categoryNameConflict', category_name_conflict,
      'unit', unit, 'weightBased', weight_based, 'quantity', quantity::text,
      'revenueMinor', revenue::text,
      'revenueSharePercent', case when v_total_revenue > 0 then round(revenue * 100.0 / v_total_revenue, 4)::text else null end,
      'profitMinor', profit::text,
      'classicFoodcostPercent', case when revenue > 0 then round((revenue - profit) * 100.0 / revenue, 2)::text else null end,
      'effectivePriceMinor', case when quantity > 0 then round(revenue / quantity, 4)::text else null end,
      'storeCoverageCount', store_coverage, 'selectedStoreCount', cardinality(v_spots),
      'previousQuantity', case when v_compare_complete then coalesce(previous_quantity, 0)::text else null end,
      'previousRevenueMinor', case when v_compare_complete then coalesce(previous_revenue, 0)::text else null end,
      'deltaRevenueMinor', case when v_compare_complete then delta_revenue::text else null end,
      'deltaRevenuePercent', case when v_compare_complete and previous_revenue > 0
        then round(delta_revenue * 100.0 / previous_revenue, 2)::text else null end
    ) order by
      case when p_sort = 'revenue' and p_direction = 'desc' then revenue end desc,
      case when p_sort = 'revenue' and p_direction = 'asc' then revenue end asc,
      case when p_sort = 'change' and p_direction = 'desc' then delta_revenue end desc nulls last,
      case when p_sort = 'change' and p_direction = 'asc' then delta_revenue end asc nulls last,
      case when p_sort = 'name' and p_direction = 'asc' then lower(product_name) end asc,
      case when p_sort = 'name' and p_direction = 'desc' then lower(product_name) end desc,
      product_id, modification_id), '[]'::jsonb)
    into v_products from paged;

    if p_category_id is not null or p_category_unknown or p_product_id is not null then
      with per_unit as (
        select business_date, unit, sum(revenue_minor)::numeric revenue,
          sum(quantity)::numeric quantity
        from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of)
        where (p_category_id is null and not p_category_unknown
            or p_category_unknown and category_id is null
            or p_category_id is not null and category_id = p_category_id)
          and (p_product_id is null or product_id = p_product_id)
          and (p_modification_id is null or modification_id = p_modification_id)
        group by business_date, unit
      ), per_day as (
        select business_date, sum(revenue) revenue,
          case when count(*) = 1 then sum(quantity) else null end quantity,
          case when count(*) = 1 then min(unit) else null end unit,
          count(*) > 1 unit_conflict
        from per_unit group by business_date
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'date', business_date, 'revenueMinor', revenue::text,
        'quantity', quantity::text, 'unit', unit, 'unitConflict', unit_conflict
      ) order by business_date), '[]'::jsonb)
      into v_trend from per_day;
    end if;
  end if;

  return jsonb_build_object(
    'methodologyVersion', 'store-category-product-v1',
    'asOf', p_as_of, 'timezone', 'Europe/Kyiv',
    'historicalRosterVerified', false, 'spotIds', to_jsonb(v_spots),
    'current', jsonb_build_object(
      'from', p_from, 'to', p_to,
      'status', case when v_current_complete then 'complete' else 'incomplete' end,
      'expectedCells', v_expected, 'completedCells', v_completed,
      'missingCount', v_expected - v_completed, 'missing', v_missing,
      'totalRevenueMinor', case when v_current_complete then v_total_revenue::text else null end
    ),
    'comparison', case when p_compare_from is null then null else jsonb_build_object(
      'from', p_compare_from, 'to', p_compare_to,
      'status', case when v_compare_complete then 'complete' else 'incomplete' end,
      'expectedCells', v_compare_expected, 'completedCells', v_compare_completed,
      'missingCount', v_compare_expected - v_compare_completed, 'missing', v_compare_missing,
      'totalRevenueMinor', case when v_compare_complete then v_compare_total_revenue::text else null end
    ) end,
    'categories', v_categories,
    'products', jsonb_build_object('total', v_product_count, 'limit', p_limit,
      'offset', p_offset, 'rows', v_products),
    'trend', v_trend,
    'penetration', jsonb_build_object('status', 'unavailable',
      'reason', 'receipt_line_quantity_and_money_basis_unverified')
  );
end;
$$;

revoke all on function feedbackgb.read_store_category_product_analytics(
  date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer
) from public, anon, authenticated, service_role;
grant execute on function feedbackgb.read_store_category_product_analytics(
  date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer
) to service_role;

commit;
