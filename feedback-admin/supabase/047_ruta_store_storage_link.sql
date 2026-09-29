-- 047_ruta_store_storage_link.sql
-- Data-only correction in the existing categories schema. No public objects.
-- Source: current Poster access.getSpots confirms spot_id=26 -> storage_id=59.
-- Apply once to the shared database, then run 047_ruta_store_storage_readback.sql.
-- Re-running after success is a no-op; unexpected state aborts the transaction.

begin;
set local lock_timeout = '5s';

do $$
begin
  if not exists (
    select 1 from categories.spots
    where spot_id = 26 and name = 'Рута' and is_deleted = false
  ) then
    raise exception 'ruta_spot_preflight_failed';
  end if;

  if not exists (
    select 1 from categories.storages
    where storage_id = 59 and storage_name = 'Магазин "Рута"'
      and is_deleted = false and (spot_id is null or spot_id = 26)
  ) then
    raise exception 'ruta_storage_preflight_failed';
  end if;

  if exists (
    select 1 from categories.storages
    where spot_id = 26 and storage_id <> 59 and is_deleted = false
  ) then
    raise exception 'ruta_other_storage_link_exists';
  end if;
end;
$$;

update categories.storages
set spot_id = 26
where storage_id = 59 and spot_id is null and is_deleted = false;

do $$
begin
  if (select count(*) from categories.storages
      where spot_id = 26 and storage_id = 59 and is_deleted = false) <> 1
     or (select count(*) from categories.storages
      where spot_id = 26 and is_deleted = false) <> 1 then
    raise exception 'ruta_storage_postcheck_failed';
  end if;
end;
$$;

commit;
