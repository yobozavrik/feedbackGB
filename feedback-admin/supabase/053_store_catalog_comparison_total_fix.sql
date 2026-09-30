-- Forward-only repair for applied 052.
-- A complete comparison window was labelled complete but kept its initialized
-- totalRevenueMinor=0 whenever the current window was incomplete.
begin;

do $$
declare
  v_signature regprocedure := to_regprocedure(
    'feedbackgb.read_store_category_product_analytics(date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer)'
  );
  v_definition text;
  v_old text := $old$
  if v_current_complete then
    select coalesce(sum(revenue_minor), 0) into v_total_revenue
    from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of);
    if v_compare_complete then
      select coalesce(sum(revenue_minor), 0) into v_compare_total_revenue
      from feedbackgb._store_analytics_latest_facts(p_compare_from, p_compare_to, v_spots, p_as_of);
    end if;

    select count(*) into v_product_count$old$;
  v_new text := $new$
  if v_compare_complete then
    select coalesce(sum(revenue_minor), 0) into v_compare_total_revenue
    from feedbackgb._store_analytics_latest_facts(p_compare_from, p_compare_to, v_spots, p_as_of);
  end if;

  if v_current_complete then
    select coalesce(sum(revenue_minor), 0) into v_total_revenue
    from feedbackgb._store_analytics_latest_facts(p_from, p_to, v_spots, p_as_of);

    select count(*) into v_product_count$new$;
begin
  if v_signature is null then
    raise exception 'store_category_product_reader_missing';
  end if;
  select pg_get_functiondef(v_signature) into strict v_definition;
  if (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'store_catalog_comparison_fix_unexpected_definition';
  end if;
  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
  select pg_get_functiondef(v_signature) into strict v_definition;
  if position(v_old in v_definition) > 0 or position(v_new in v_definition) = 0 then
    raise exception 'store_catalog_comparison_fix_failed';
  end if;
end;
$$;

commit;
