-- Guard: every active seller must map to an active CRM shop, or their
-- consumables orders fail at submit time with "store is not mapped".
--
-- Root cause context: the consumables flow resolves the seller's store via
--   household_chemicals.shops.poster_spot_id = feedbackgb.users.store_id
-- (see rpc_create_feedbackgb_consumables_order). A seller whose store_id has
-- no matching, active shop can log in and build a cart, but the order is
-- rejected. This was true for "Щербанюка" (spot_id=25 / shops.id=39, whose
-- poster_spot_id was NULL).
--
-- HOW TO USE: run in the Supabase SQL Editor (service_role). Expect ZERO
-- rows. Any row is a store whose sellers cannot order — fix by setting the
-- shop's poster_spot_id, e.g.:
--   update household_chemicals.shops set poster_spot_id = 25 where id = 39;
--
-- Re-run after adding a new store or onboarding new sellers.

select
  u.store_id                as feedbackgb_spot_id,
  u.display_label           as seller_label,
  s.name                    as matched_shop_name  -- NULL = the gap
from feedbackgb.users u
left join household_chemicals.shops s
  on s.poster_spot_id = u.store_id
 and s.is_active = true
where u.is_active = true
  and u.role = 'seller'
  and u.store_id is not null
  and s.id is null
order by u.store_id;
