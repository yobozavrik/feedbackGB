-- Supply facilities seed.
--
-- Applied manually by super_admin in the Supabase SQL Editor, AFTER
-- 20260723_001_supply_employees.sql.
--
-- Source of truth: household_chemicals.shops joined to warehouses, taken from
-- the live read-only audit. Only real physical workshops/warehouses are seeded:
--   * shops.id 25-30  -> ЦЕХ  (kind = 'production')
--   * shops.id 31-36  -> Склад (kind = 'warehouse')
-- Deliberately EXCLUDED (not places a supply worker orders from):
--   * 37 "Списання ХЛІБА"  — accounting write-off bucket
--   * 38 "Замовник"        — virtual customer location
--   * 39 "Щербанюка"       — a seller shop (warehouses.type = 'shop'), not a facility
--
-- Mapping contract (see 20260723_001 column comments):
--   crm_location_id  = household_chemicals.shops.id      (text)
--   crm_warehouse_id = household_chemicals.warehouses.id (integer)
--
-- Idempotent: re-running keeps names/warehouse ids in sync via the
-- (crm_system, crm_location_id) unique key.

set search_path = feedbackgb, public, pg_catalog;

insert into feedbackgb.facilities (name, kind, crm_system, crm_location_id, crm_warehouse_id)
values
  ('ЦЕХ "2 поверх"',              'production', 'household_chemicals', '25', 13),
  ('ЦЕХ "Піцерія ГРАВІТОН"',      'production', 'household_chemicals', '26', 15),
  ('ЦЕХ "Бульвар-Автовокзал"',    'production', 'household_chemicals', '27', 22),
  ('ЦЕХ НІЧНА ЗМІНА "САДОВА"',    'production', 'household_chemicals', '28', 35),
  ('ЦЕХ "Флорида"',               'production', 'household_chemicals', '29', 41),
  ('ЦЕХ "Піцерія МІКРОРАЙОН"',    'production', 'household_chemicals', '30', 49),
  ('Склад витратних матеріалів',  'warehouse',  'household_chemicals', '31', 37),
  ('Склад "Крафтова пекарня"',    'warehouse',  'household_chemicals', '32', 42),
  ('Склад сировини "Трембіта"',   'warehouse',  'household_chemicals', '33', 46),
  ('Склад "Кондитерка"',          'warehouse',  'household_chemicals', '34', 48),
  ('Склад № 2',                   'warehouse',  'household_chemicals', '35', 50),
  ('Склад "Запаси Анатолійовича"','warehouse',  'household_chemicals', '36', 51)
on conflict (crm_system, crm_location_id) do update
  set name = excluded.name,
      kind = excluded.kind,
      crm_warehouse_id = excluded.crm_warehouse_id,
      is_active = true;

-- Verify: expect 12 rows, 6 production + 6 warehouse.
--   select kind, count(*) from feedbackgb.facilities group by kind order by kind;


-- ===========================================================================
-- TEST WORKER TEMPLATE — NOT executed automatically.
-- Uncomment, fill the three placeholders, run once to enable a login smoke
-- test. Delete/deactivate the row afterwards if it was only for testing.
-- ===========================================================================
--
-- do $$
-- declare
--   v_user_id    uuid;
--   v_facility   uuid;
--   v_full_name  text := 'ТЕСТ Працівник цеху';   -- <-- change
-- begin
--   -- 1. Pick the facility to attach the worker to (here: consumables warehouse).
--   select id into v_facility
--     from feedbackgb.facilities
--    where crm_system = 'household_chemicals' and crm_location_id = '31';
--
--   -- 2. Create (or reuse) a supply_worker user row.
--   insert into feedbackgb.users (full_name, display_label, role, is_active)
--   values (v_full_name, v_full_name, 'supply_worker', true)
--   returning id into v_user_id;
--
--   -- 3. Grant app access + facility membership.
--   insert into feedbackgb.user_app_access (user_id, app_key, is_active)
--   values (v_user_id, 'supply_app', true);
--
--   insert into feedbackgb.user_facility_memberships (user_id, facility_id, role, is_active)
--   values (v_user_id, v_facility, 'supply_worker', true);
--
--   raise notice 'Test worker %; now set a PIN:', v_user_id;
--   raise notice 'select feedbackgb.set_user_pin(''%'', ''NNNNNN'');', v_user_id;
-- end $$;
--
-- 4. Issue a 6-digit PIN out-of-band (replace the uuid + NNNNNN):
--    select feedbackgb.set_user_pin('00000000-0000-0000-0000-000000000000', 'NNNNNN');
