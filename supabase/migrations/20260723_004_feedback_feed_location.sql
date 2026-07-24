-- Feedback feed exposes facility identity alongside store identity so the
-- admin UI can list supply requests with the цех/склад name and filter by
-- location kind, without changing existing consumers.
--
-- Applied manually by super_admin after 20260723_001 (which added
-- feedback.facility_id).
--
-- Added fields (backwards-compatible append — CREATE OR REPLACE VIEW cannot
-- reorder or rename existing columns, so the three new ones sit at the tail):
--   facility_id     — direct reference (uuid or null)
--   facility_name   — resolved from feedbackgb.facilities.name (null for stores)
--   location_kind   — 'store' | 'facility' | 'none'
--
-- store_name keeps its existing COALESCE(spot.name, store_label) behaviour, so
-- supply rows (store_id IS NULL) already surface the facility name via
-- current admin views. The explicit facility_* + location_kind columns let
-- the admin UI add a proper filter and iconography without parsing store_label.

set search_path = feedbackgb, public, pg_catalog;

create or replace view feedbackgb.feedback_feed as
select
  f.id,
  f.created_at,
  f.updated_at,
  f.category,
  c.emoji as category_emoji,
  c.title as category_title,
  f.store_id,
  coalesce(s.name, f.store_label) as store_name,
  s.address as store_address,
  f.user_id,
  u.full_name as user_full_name,
  u.role as user_role,
  f.fields,
  f.product_id,
  p.name as product_name,
  p.unit as product_unit,
  f.quantity,
  f.photo_url,
  f.tg_user_id,
  f.tg_username,
  f.tg_display_name,
  f.tg_verified,
  f.summary,
  f.status,
  f.resolved_at,
  f.resolved_by,
  f.assigned_to,
  a.full_name as assigned_full_name,
  f.client_created_at,
  f.client_submission_id,
  f.fields -> 'photo_urls' as photo_urls,
  -- Appended, per CREATE OR REPLACE VIEW rules (no reordering allowed):
  f.facility_id,
  fac.name as facility_name,
  case
    when f.store_id is not null then 'store'
    when f.facility_id is not null then 'facility'
    else 'none'
  end as location_kind
from feedbackgb.feedback f
  left join feedbackgb.categories c on c.id = f.category
  left join categories.spots s on s.spot_id = f.store_id
  left join feedbackgb.facilities fac on fac.id = f.facility_id
  left join feedbackgb.users u on u.id = f.user_id
  left join feedbackgb.users a on a.id = f.assigned_to
  left join categories.products p on p.id = f.product_id;

grant select on feedbackgb.feedback_feed to service_role;
