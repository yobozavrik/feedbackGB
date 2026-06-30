-- Migration: 014_offline_support_hardening.sql
-- Add client_submission_id and client_created_at for offline-first support in feedback table and feedback_feed view.

-- 1. Add columns to feedback table
alter table feedbackgb.feedback
  add column if not exists client_submission_id uuid,
  add column if not exists client_created_at timestamptz;

-- 2. Create partial unique index to enforce idempotency without breaking rows with NULL client_submission_id
create unique index if not exists feedback_client_submission_id_uniq
  on feedbackgb.feedback (client_submission_id)
  where client_submission_id is not null;

-- 3. Recreate the feedback_feed view to expose new offline columns and photo_urls array
create or replace view feedbackgb.feedback_feed as
  select
    f.id,
    f.created_at,
    f.updated_at,
    f.category,
    c.emoji        as category_emoji,
    c.title        as category_title,
    f.store_id,
    coalesce(s.name, f.store_label)         as store_name,
    s.address                               as store_address,
    f.user_id,
    u.full_name    as user_full_name,
    u.role         as user_role,
    f.fields,
    f.product_id,
    p.name         as product_name,
    p.unit         as product_unit,
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
    a.full_name    as assigned_full_name,
    -- Offline columns
    f.client_created_at,
    f.client_submission_id,
    f.fields -> 'photo_urls' as photo_urls
  from feedbackgb.feedback f
  left join feedbackgb.categories c on c.id = f.category
  left join categories.spots      s on s.spot_id = f.store_id
  left join feedbackgb.users      u on u.id = f.user_id
  left join feedbackgb.users      a on a.id = f.assigned_to
  left join categories.products   p on p.id = f.product_id;
