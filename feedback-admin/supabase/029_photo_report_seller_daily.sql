-- 029_photo_report_seller_daily.sql
--
-- Durable daily attribution of sellers who submitted photo reports.
-- This records a PIN-authenticated report sender, not an independently
-- verified work shift. It deliberately does not change feedback_feed.

begin;

create table if not exists feedbackgb.photo_report_seller_daily (
  local_date date not null,
  store_id integer not null references categories.spots(spot_id),
  seller_id uuid not null references feedbackgb.users(id),
  seller_full_name text not null,
  report_count integer not null default 0 check (report_count >= 0),
  photo_count integer not null default 0 check (photo_count >= 0),
  first_report_at timestamptz not null,
  last_report_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (local_date, store_id, seller_id)
);

comment on table feedbackgb.photo_report_seller_daily is
  'Daily aggregate of PIN-authenticated sellers who submitted photo reports; not a full attendance register.';

comment on column feedbackgb.photo_report_seller_daily.seller_full_name is
  'Seller name snapshot at the time the daily row was first created.';

alter table feedbackgb.photo_report_seller_daily enable row level security;
revoke all on feedbackgb.photo_report_seller_daily from public, anon, authenticated;
grant select, insert, update, delete on feedbackgb.photo_report_seller_daily to service_role;

create index if not exists photo_report_seller_daily_store_date_idx
  on feedbackgb.photo_report_seller_daily (store_id, local_date desc);

create or replace function feedbackgb.capture_photo_report_seller_daily()
returns trigger
language plpgsql
security definer
set search_path = feedbackgb, public
as $$
declare
  v_seller_name text;
  v_photo_count integer;
  v_local_date date;
begin
  if new.category <> 'photo_report' or new.user_id is null or new.store_id is null then
    return new;
  end if;

  select coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.display_label), ''), 'Невідомий продавець')
    into v_seller_name
    from feedbackgb.users u
   where u.id = new.user_id;

  -- Preserve the feedback insert even if a legacy row no longer has a user.
  if v_seller_name is null then
    return new;
  end if;

  v_photo_count := case
    when jsonb_typeof(new.fields -> 'photo_urls') = 'array'
      then jsonb_array_length(new.fields -> 'photo_urls')
    when new.photo_url is not null then 1
    else 0
  end;
  v_local_date := timezone('Europe/Kyiv', new.created_at)::date;

  insert into feedbackgb.photo_report_seller_daily (
    local_date, store_id, seller_id, seller_full_name,
    report_count, photo_count, first_report_at, last_report_at
  ) values (
    v_local_date, new.store_id, new.user_id, v_seller_name,
    1, v_photo_count, new.created_at, new.created_at
  )
  on conflict (local_date, store_id, seller_id) do update
    set seller_full_name = excluded.seller_full_name,
        report_count = feedbackgb.photo_report_seller_daily.report_count + 1,
        photo_count = feedbackgb.photo_report_seller_daily.photo_count + excluded.photo_count,
        first_report_at = least(feedbackgb.photo_report_seller_daily.first_report_at, excluded.first_report_at),
        last_report_at = greatest(feedbackgb.photo_report_seller_daily.last_report_at, excluded.last_report_at),
        updated_at = now();

  return new;
end;
$$;

revoke all on function feedbackgb.capture_photo_report_seller_daily() from public, anon, authenticated;
grant execute on function feedbackgb.capture_photo_report_seller_daily() to service_role;

drop trigger if exists feedback_capture_photo_report_seller_daily on feedbackgb.feedback;
create trigger feedback_capture_photo_report_seller_daily
  after insert on feedbackgb.feedback
  for each row execute function feedbackgb.capture_photo_report_seller_daily();

-- Backfill is idempotent: it replaces a daily aggregate with the complete
-- history currently in feedback rather than adding to it.
insert into feedbackgb.photo_report_seller_daily (
  local_date, store_id, seller_id, seller_full_name,
  report_count, photo_count, first_report_at, last_report_at
)
select
  timezone('Europe/Kyiv', f.created_at)::date as local_date,
  f.store_id,
  f.user_id,
  coalesce(nullif(trim(u.full_name), ''), nullif(trim(u.display_label), ''), 'Невідомий продавець') as seller_full_name,
  count(*)::integer as report_count,
  sum(case
    when jsonb_typeof(f.fields -> 'photo_urls') = 'array' then jsonb_array_length(f.fields -> 'photo_urls')
    when f.photo_url is not null then 1
    else 0
  end)::integer as photo_count,
  min(f.created_at) as first_report_at,
  max(f.created_at) as last_report_at
from feedbackgb.feedback f
join feedbackgb.users u on u.id = f.user_id
where f.category = 'photo_report'
  and f.store_id is not null
group by timezone('Europe/Kyiv', f.created_at)::date, f.store_id, f.user_id, u.full_name, u.display_label
on conflict (local_date, store_id, seller_id) do update
  set seller_full_name = excluded.seller_full_name,
      report_count = excluded.report_count,
      photo_count = excluded.photo_count,
      first_report_at = excluded.first_report_at,
      last_report_at = excluded.last_report_at,
      updated_at = now();

commit;

-- Readback after applying:
-- select local_date, seller_full_name, store_id, report_count, photo_count
-- from feedbackgb.photo_report_seller_daily
-- order by local_date desc, store_id, seller_full_name;
