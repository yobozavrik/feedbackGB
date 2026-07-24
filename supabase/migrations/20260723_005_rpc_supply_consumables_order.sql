-- Supply-side sibling of household_chemicals.rpc_create_feedbackgb_consumables_order.
--
-- Applied manually by super_admin after 20260723_004.
--
-- Why: the seller RPC resolves the shop via `shops.poster_spot_id = p_feedback_store_id`.
-- Every physical цех/склад in household_chemicals.shops has
-- `poster_spot_id IS NULL` (Poster spots only exist for seller stores), so a
-- supply worker order always fails with "FeedbackGB store is not mapped to a
-- CRM shop". This sibling accepts `p_crm_shop_id` (= household_chemicals.shops.id)
-- directly — the same value we store as facilities.crm_location_id.
--
-- Everything else is byte-identical to the seller function:
--   * duplicate detection via feedbackgb_order_contributions (idempotent by feedback_id)
--   * pg_advisory_xact_lock(shop_id) + merge into open 'submitted' order
--   * warehouse_id = 37 (Склад витратних матеріалів), source = 'feedbackgb'
--
-- Not gated by ADR 0003: this bridge is idempotent by feedback_id via
-- feedbackgb_order_contributions with get-or-create semantics. The ADR 0003
-- gate stays in effect for rpc_create_employee_order,
-- rpc_create_write_off_with_items and rpc_create_receipt_with_items.

set search_path = household_chemicals, public, pg_catalog;

create or replace function household_chemicals.rpc_create_feedbackgb_supply_consumables_order(
  p_feedback_id      uuid,
  p_feedback_user_id uuid,
  p_crm_shop_id      integer,
  p_notes            text default null,
  p_items            jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'household_chemicals', 'pg_temp'
as $function$
declare
  v_shop_id integer;
  v_order_id uuid;
  v_order_number text;
  v_order_item_id uuid;
  v_item record;
  v_notes text := nullif(btrim(p_notes), '');
  v_supply_warehouse_id constant integer := 37;
  v_merged boolean := false;
begin
  if p_feedback_id is null or p_feedback_user_id is null or p_crm_shop_id is null then
    return jsonb_build_object('success', false, 'error', 'Missing supply request identity');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cart is empty');
  end if;

  -- Direct shop id (facility.crm_location_id); no poster_spot_id lookup.
  select id into v_shop_id
  from household_chemicals.shops
  where id = p_crm_shop_id and is_active = true
  limit 1;
  if v_shop_id is null then
    return jsonb_build_object('success', false, 'error', 'CRM shop not found or inactive');
  end if;

  -- Idempotent: same feedback_id returns the original order, never creates a second.
  if exists (
    select 1 from household_chemicals.feedbackgb_order_contributions
    where feedback_id = p_feedback_id
  ) then
    select order_id into v_order_id
    from household_chemicals.feedbackgb_order_contributions
    where feedback_id = p_feedback_id
    limit 1;
    select order_number into v_order_number from household_chemicals.orders where id = v_order_id;
    return jsonb_build_object('success', true, 'duplicate', true, 'order_id', v_order_id, 'order_number', v_order_number);
  end if;

  -- Merge every supply request from the same facility in the same open batch
  -- into one warehouse order (matches the seller flow semantics).
  perform pg_advisory_xact_lock(v_shop_id);
  select id, order_number into v_order_id, v_order_number
  from household_chemicals.orders
  where source = 'feedbackgb' and shop_id = v_shop_id
    and warehouse_id = v_supply_warehouse_id and status = 'submitted'
  order by created_at desc limit 1 for update;

  if v_order_id is null then
    v_order_number := household_chemicals.next_document_number('ЗМ');
    insert into household_chemicals.orders(order_number, shop_id, warehouse_id, status, source, notes, submitted_at, source_feedback_id)
    values (v_order_number, v_shop_id, v_supply_warehouse_id, 'submitted', 'feedbackgb', v_notes, now(), p_feedback_id)
    returning id into v_order_id;
  else
    v_merged := true;
    if v_notes is not null then
      update household_chemicals.orders
      set notes = concat_ws(E'\n\n', notes, 'FeedbackGB: ' || v_notes), updated_at = now()
      where id = v_order_id;
    end if;
  end if;

  for v_item in
    select (value->>'product_id')::integer as product_id, (value->>'quantity')::numeric as quantity
    from jsonb_array_elements(p_items)
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0
      or not exists (select 1 from household_chemicals.products where id = v_item.product_id and is_active = true) then
      raise exception 'Invalid FeedbackGB cart item';
    end if;
    select id into v_order_item_id
    from household_chemicals.order_items
    where order_id = v_order_id and product_id = v_item.product_id
    limit 1 for update;
    if v_order_item_id is null then
      insert into household_chemicals.order_items(order_id, product_id, quantity_requested)
      values (v_order_id, v_item.product_id, v_item.quantity)
      returning id into v_order_item_id;
    else
      update household_chemicals.order_items
      set quantity_requested = quantity_requested + v_item.quantity, updated_at = now()
      where id = v_order_item_id;
    end if;
    insert into household_chemicals.feedbackgb_order_contributions(
      order_id, feedback_id, feedback_user_id, product_id, quantity_requested, comment
    ) values (v_order_id, p_feedback_id, p_feedback_user_id, v_item.product_id, v_item.quantity, v_notes);
  end loop;

  return jsonb_build_object('success', true, 'merged', v_merged, 'order_id', v_order_id, 'order_number', v_order_number);
end;
$function$;

revoke all on function household_chemicals.rpc_create_feedbackgb_supply_consumables_order(uuid, uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function household_chemicals.rpc_create_feedbackgb_supply_consumables_order(uuid, uuid, integer, text, jsonb) to service_role;
