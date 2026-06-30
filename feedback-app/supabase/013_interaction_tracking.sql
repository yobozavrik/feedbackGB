-- 013_interaction_tracking.sql
-- Migration to support click/heatmap tracking for users.

-- 1. Create user_interactions table
create table if not exists feedbackgb.user_interactions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid references feedbackgb.users(id) on delete cascade,
  page_path     text not null,
  element_tag   text,
  element_id    text,
  element_text  text,
  x_ratio       numeric(4,3) check (x_ratio >= 0.0 and x_ratio <= 1.0),
  y_ratio       numeric(4,3) check (y_ratio >= 0.0 and y_ratio <= 1.0),
  viewport_w    integer,
  viewport_h    integer
);

-- 2. Indexes for fast analytics queries
create index if not exists user_interactions_user_idx on feedbackgb.user_interactions(user_id);
create index if not exists user_interactions_page_idx on feedbackgb.user_interactions(page_path);
create index if not exists user_interactions_created_at_idx on feedbackgb.user_interactions(created_at desc);

-- 3. Grants
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    grant insert, select on feedbackgb.user_interactions to anon;
    grant insert, select on feedbackgb.user_interactions to authenticated;
    grant all privileges on feedbackgb.user_interactions to service_role;
  end if;
end $$;
