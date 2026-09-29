-- Read-only check after 047. Expected: all true, 26 active stores, 26 unique links.
with active_stores as (
  select id from feedbackgb.v_stores where is_active = true
), links as (
  select s.id as spot_id, count(st.storage_id) as storage_count
  from active_stores s
  left join categories.storages st on st.spot_id = s.id and st.is_deleted = false
  group by s.id
)
select jsonb_build_object(
  'ruta_spot_active', exists(select 1 from categories.spots where spot_id=26 and is_deleted=false),
  'ruta_storage_linked', exists(select 1 from categories.storages where storage_id=59 and spot_id=26 and is_deleted=false),
  'active_store_count', (select count(*) from active_stores),
  'stores_with_one_storage', (select count(*) from links where storage_count=1),
  'stores_missing_storage', (select count(*) from links where storage_count=0),
  'stores_with_multiple_storages', (select count(*) from links where storage_count>1)
) as ruta_store_storage_readback;
