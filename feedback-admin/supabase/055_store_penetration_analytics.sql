-- Store/network receipt penetration over the verified S-11 purchase population.
-- Forward-only. No raw receipt or customer fields are exposed.
begin;

do $$
begin
  if to_regclass('feedbackgb.poster_receipt_analytics_runs') is null
    or to_regclass('feedbackgb.poster_receipt_analytics_facts') is null
    or to_regclass('feedbackgb.poster_receipt_line_analytics_facts') is null
    or to_regprocedure('feedbackgb._store_analytics_latest_facts(date,date,bigint[],timestamp with time zone)') is null
  then raise exception 'store_penetration_source_missing'; end if;
  if to_regprocedure('feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamp with time zone,bigint)') is not null
  then raise exception 'store_penetration_reader_already_exists'; end if;
end $$;

create function feedbackgb.read_store_penetration_analytics(
  p_from date,
  p_to date,
  p_spot_ids bigint[] default null,
  p_as_of timestamptz default clock_timestamp(),
  p_category_id bigint default null
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
  v_missing jsonb;
  v_denominator bigint := 0;
  v_mapping jsonb := jsonb_build_object('status','unavailable','bridgeRows',0,'mappedRows',0,'unmappedRows',0);
  v_categories jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_stores jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_mapping_complete boolean := false;
begin
  if p_from is null or p_to is null or p_from>p_to or p_from<date '2026-01-01'
    or p_to>=v_today or p_to-p_from>365 or p_as_of is null
    or p_as_of>clock_timestamp()+interval '1 minute'
    or (p_category_id is not null and p_category_id<=0)
  then raise exception 'store_penetration_arguments_invalid'; end if;

  if p_spot_ids is null then
    select array_agg(id::bigint order by id) into v_spots
    from feedbackgb.v_stores where is_active is true;
  else
    select array_agg(distinct value order by value) into v_spots from unnest(p_spot_ids) value;
    if cardinality(v_spots)<>cardinality(p_spot_ids) then
      raise exception 'store_penetration_scope_invalid'; end if;
  end if;
  if v_spots is null or cardinality(v_spots)=0 or cardinality(v_spots)>100
    or array_position(v_spots,null) is not null
    or exists(select 1 from unnest(v_spots) value where value<=0)
    or exists(select 1 from unnest(v_spots) value
      where not exists(select 1 from feedbackgb.v_stores s where s.id=value and s.is_active is true))
  then raise exception 'store_penetration_scope_invalid'; end if;

  v_expected := p_to-p_from+1;
  with days as (
    select value::date business_date from generate_series(p_from,p_to,interval '1 day') value
  ), day_runs as (
    select r.date_from business_date,count(*) run_count
    from feedbackgb.poster_receipt_import_runs r
    join feedbackgb.poster_receipt_analytics_runs a on a.run_id=r.id
      and a.methodology_version='poster-receipt-purchase-v1'
    where r.status='accepted' and r.date_from=r.date_to
      and r.date_from between p_from and p_to
      and r.completed_at<=p_as_of and a.projected_at<=p_as_of
      and v_spots<@r.source_spot_ids
    group by r.date_from
  )
  select count(*) filter(where coalesce(r.run_count,0)=1),
    coalesce(jsonb_agg(d.business_date order by d.business_date)
      filter(where coalesce(r.run_count,0)<>1),'[]'::jsonb)
  into v_completed,v_missing
  from days d left join day_runs r using(business_date);

  if v_completed=v_expected then
    with selected_runs as materialized (
      select min(r.id::text)::uuid run_id,r.date_from business_date
      from feedbackgb.poster_receipt_import_runs r
      join feedbackgb.poster_receipt_analytics_runs a on a.run_id=r.id
      where r.status='accepted' and r.date_from=r.date_to
        and r.date_from between p_from and p_to
        and r.completed_at<=p_as_of and a.projected_at<=p_as_of
        and v_spots<@r.source_spot_ids
      group by r.date_from having count(*)=1
    ), receipts as materialized (
      select f.receipt_version_id,f.business_date,f.spot_id
      from feedbackgb.poster_receipt_analytics_facts f
      join selected_runs r on r.run_id=f.run_id
      where f.spot_id=any(v_spots) and f.eligibility_status='eligible'
    ), lines as materialized (
      select l.receipt_version_id,l.business_date,l.spot_id,l.product_id,l.modification_id
      from feedbackgb.poster_receipt_line_analytics_facts l
      join selected_runs r on r.run_id=l.run_id
      where l.spot_id=any(v_spots) and l.eligible_purchase
    ), catalog as materialized (
      select business_date,spot_id,product_id,modification_id,
        case when count(*) filter(where category_id is null)=0
          and count(distinct category_id)=1 then min(category_id) end category_id,
        case when count(distinct product_name)=1 then min(product_name) end product_name
      from feedbackgb._store_analytics_latest_facts(p_from,p_to,v_spots,p_as_of)
      group by business_date,spot_id,product_id,modification_id
    ), bridge as materialized (
      select distinct receipt_version_id,business_date,spot_id,product_id,modification_id
      from lines
    ), mapped as materialized (
      select b.*,c.category_id,c.product_name
      from bridge b left join catalog c using(business_date,spot_id,product_id,modification_id)
    ), category_links as materialized (
      select distinct receipt_version_id,business_date,spot_id,category_id
      from mapped where category_id is not null
    ), product_links as materialized (
      select distinct receipt_version_id,business_date,spot_id,product_id,modification_id,
        category_id,product_name from mapped
    )
    select
      (select count(*) from receipts),
      jsonb_build_object(
        'status',case when (select count(*) from mapped where category_id is null)=0
          then 'complete' else 'incomplete' end,
        'bridgeRows',(select count(*) from mapped),
        'mappedRows',(select count(*) from mapped where category_id is not null),
        'unmappedRows',(select count(*) from mapped where category_id is null)
      ),
      case when (select count(*) from mapped where category_id is null)=0 then
        coalesce((select jsonb_agg(jsonb_build_object(
          'categoryId',x.category_id,'receiptCount',x.receipt_count,
          'penetrationPercent',case when (select count(*) from receipts)>0
            then round(x.receipt_count*100.0/(select count(*) from receipts),2)::text else null end,
          'storeCount',x.store_count
        ) order by x.receipt_count desc,x.category_id)
        from (select category_id,count(distinct receipt_version_id) receipt_count,
          count(distinct spot_id) store_count from category_links group by category_id) x),'[]'::jsonb)
      else '[]'::jsonb end,
      case when (select count(*) from mapped where category_id is null)=0 then
        coalesce((select jsonb_agg(jsonb_build_object(
          'productId',x.product_id,'modificationId',x.modification_id,
          'categoryId',x.category_id,'productName',x.product_name,
          'receiptCount',x.receipt_count,
          'penetrationPercent',case when (select count(*) from receipts)>0
            then round(x.receipt_count*100.0/(select count(*) from receipts),2)::text else null end,
          'storeCount',x.store_count
        ) order by x.receipt_count desc,x.product_id,x.modification_id)
        from (select product_id,modification_id,min(category_id) category_id,
          case when count(distinct product_name)=1 then min(product_name) end product_name,
          count(distinct receipt_version_id) receipt_count,count(distinct spot_id) store_count
          from product_links
          where p_category_id is null or category_id=p_category_id
          group by product_id,modification_id order by receipt_count desc limit 100) x),'[]'::jsonb)
      else '[]'::jsonb end,
      case when p_category_id is not null
        and (select count(*) from mapped where category_id is null)=0 then
        coalesce((select jsonb_agg(jsonb_build_object(
          'spotId',s.spot_id,'eligibleReceipts',s.denominator,
          'categoryReceipts',s.numerator,
          'penetrationPercent',case when s.denominator>0
            then round(s.numerator*100.0/s.denominator,2)::text else null end
        ) order by s.spot_id)
        from (select spot spot_id,
          (select count(*) from receipts r where r.spot_id=spot) denominator,
          (select count(distinct c.receipt_version_id) from category_links c
            where c.spot_id=spot and c.category_id=p_category_id) numerator
          from unnest(v_spots) spot) s),'[]'::jsonb)
      else '[]'::jsonb end,
      case when p_category_id is not null
        and (select count(*) from mapped where category_id is null)=0 then
        coalesce((select jsonb_agg(jsonb_build_object(
          'date',d.business_date,'eligibleReceipts',d.denominator,
          'categoryReceipts',d.numerator,
          'penetrationPercent',case when d.denominator>0
            then round(d.numerator*100.0/d.denominator,2)::text else null end
        ) order by d.business_date)
        from (select value::date business_date,
          (select count(*) from receipts r where r.business_date=value::date) denominator,
          (select count(distinct c.receipt_version_id) from category_links c
            where c.business_date=value::date and c.category_id=p_category_id) numerator
          from generate_series(p_from,p_to,interval '1 day') value) d),'[]'::jsonb)
      else '[]'::jsonb end
    into v_denominator,v_mapping,v_categories,v_products,v_stores,v_trend;
    v_mapping_complete := v_mapping->>'status'='complete';
  end if;

  return jsonb_build_object(
    'methodologyVersion','store-penetration-v1',
    'asOf',p_as_of,'timezone','Europe/Kyiv','spotIds',to_jsonb(v_spots),
    'status',case when v_completed<>v_expected then 'incomplete'
      when not v_mapping_complete then 'mapping_incomplete' else 'complete' end,
    'coverage',jsonb_build_object('from',p_from,'to',p_to,'expectedDays',v_expected,
      'completedDays',v_completed,'missingDates',v_missing),
    'denominator',jsonb_build_object('eligibleReceipts',
      case when v_completed=v_expected then v_denominator else null end,
      'definition','distinct eligible purchase receipts in selected network scope'),
    'mapping',v_mapping,'selectedCategoryId',p_category_id,
    'categories',v_categories,'products',v_products,'stores',v_stores,'trend',v_trend,
    'historicalRosterVerified',false
  );
end;
$$;

revoke all on function feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamptz,bigint)
  from public,anon,authenticated,service_role;
grant execute on function feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamptz,bigint)
  to service_role;

commit;
