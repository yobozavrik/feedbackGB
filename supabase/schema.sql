-- FeedbackGB schema
--
-- Apply via Supabase SQL editor or `supabase db push` (CLI).
-- Re-runnable: uses IF NOT EXISTS / OR REPLACE where possible.

create extension if not exists "pgcrypto";

create table if not exists public.feedback (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  category        text not null,
  store           text,

  -- structured per-category answers
  fields          jsonb not null default '{}'::jsonb,

  -- public URL or data: URL fallback
  photo_url       text,

  -- telegram identity
  tg_user_id      bigint,
  tg_username     text,
  tg_display_name text,
  tg_verified     boolean not null default false,

  -- human/AI-readable single-line description for fast scanning + embedding
  summary         text not null
);

create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);

create index if not exists feedback_category_idx
  on public.feedback (category);

create index if not exists feedback_store_idx
  on public.feedback (store);

-- Optional: full text search on summary (Ukrainian/Russian/English)
create index if not exists feedback_summary_trgm_idx
  on public.feedback using gin (summary gin_trgm_ops);

create extension if not exists pg_trgm;

-- Storage bucket for compressed photos.
-- Run this in the Storage dashboard or via the API:
-- insert into storage.buckets (id, name, public) values
--   ('feedback-photos', 'feedback-photos', true)
-- on conflict (id) do nothing;

-- Row Level Security:
-- The Next.js API uses the service role key, which bypasses RLS.
-- Enable RLS so anon clients cannot read/write directly.
alter table public.feedback enable row level security;

-- (intentionally no anon policies)
