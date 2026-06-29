-- 010_feedback_comments.sql
-- Create table for comments on feedback rows to allow dialogue between admins and sellers.

set search_path = feedbackgb, public;

-- 1. Create table feedback_comments
create table if not exists feedbackgb.feedback_comments (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedbackgb.feedback(id) on delete cascade,
  author_id   uuid not null references feedbackgb.users(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- Index for fast ordering by created_at per feedback
create index if not exists feedback_comments_feedback_id_idx
  on feedbackgb.feedback_comments (feedback_id, created_at asc);

-- Enable RLS
alter table feedbackgb.feedback_comments enable row level security;

-- Grant permissions to service_role (App server acts as service_role)
grant select, insert, delete on feedbackgb.feedback_comments to service_role;

-- 2. Enable Realtime subscription for the feedback table
-- First, ensure the publication exists (Supabase typically has 'supabase_realtime')
-- and publish the feedback table to it.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    -- Check if it is already in publication to avoid duplicate errors
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'feedbackgb'
         and tablename = 'feedback'
    ) then
      alter publication supabase_realtime add table feedbackgb.feedback;
    end if;
  end if;
end $$;
