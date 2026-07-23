-- Transfer targets for the HR "перевестися" topic.
--
-- Applied manually by super_admin after 20260723_002.
--
-- Sellers transfer to a store; supply workers transfer to a facility (цех/
-- склад). This view unions both into one pick list. `id` is text so the two
-- id spaces (integer store id, uuid facility id) coexist; `kind` tells the
-- caller which field to submit (target_store_id vs target_facility_id).

set search_path = feedbackgb, public, pg_catalog;

create or replace view feedbackgb.v_transfer_targets as
select 'store'::text    as kind, s.id::text as id, s.name, true as is_active
  from feedbackgb.v_stores s
union all
select 'facility'::text as kind, f.id::text as id, f.name, f.is_active
  from feedbackgb.facilities f
 where f.is_active;

revoke all on feedbackgb.v_transfer_targets from anon, authenticated;
grant select on feedbackgb.v_transfer_targets to service_role;
