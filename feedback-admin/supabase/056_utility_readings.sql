-- Photo submissions for four utility categories. Apply to the intended feedbackgb project only.
-- No stores, Telegram destinations or user data are seeded.
begin;

create table feedbackgb.utility_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  unique(period_start, period_end),
  exclude using gist (daterange(period_start, period_end, '[]') with &&),
  check (period_end >= period_start)
);

create or replace function feedbackgb.ensure_current_utility_period()
returns uuid language plpgsql security invoker
set search_path = feedbackgb, public, pg_catalog as $$
declare v_start date; v_end date; v_due timestamptz; v_id uuid;
begin
  v_start := date_trunc('month', now() at time zone 'Europe/Kyiv')::date;
  v_end := (v_start + interval '1 month - 1 day')::date;
  v_due := ((v_start + interval '1 month')::timestamp at time zone 'Europe/Kyiv')
    - interval '1 millisecond';
  perform pg_advisory_xact_lock(hashtextextended('utility-period:' || v_start::text, 0));
  select id into v_id from feedbackgb.utility_periods
    where period_start = v_start and period_end = v_end;
  if v_id is null then
    insert into feedbackgb.utility_periods(period_start, period_end, due_at)
    values(v_start, v_end, v_due) returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function feedbackgb.ensure_current_utility_period() from public, anon, authenticated;
grant execute on function feedbackgb.ensure_current_utility_period() to service_role;

create table feedbackgb.utility_submissions (
  id uuid primary key default gen_random_uuid(),
  store_id integer not null references categories.spots(spot_id),
  period_id uuid not null references feedbackgb.utility_periods(id),
  category text not null check (category in ('electricity','water','heating','other')),
  submitted_by uuid not null references feedbackgb.users(id),
  source text not null check (source in ('home_store','replacement_permission','admin')),
  comment text check (comment is null or length(comment) <= 1000),
  client_submission_id uuid not null unique,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  revision integer not null check (revision > 0),
  supersedes_id uuid references feedbackgb.utility_submissions(id),
  superseded_at timestamptz,
  review_status text not null default 'submitted'
    check (review_status in ('submitted','needs_correction','verified')),
  reviewed_by uuid references feedbackgb.users(id),
  reviewed_at timestamptz,
  review_note text,
  submitted_at timestamptz not null default now(),
  unique(store_id, period_id, category, revision),
  check ((reviewed_by is null and reviewed_at is null)
      or (reviewed_by is not null and reviewed_at is not null))
);
create unique index utility_submissions_one_current_idx
  on feedbackgb.utility_submissions(store_id, period_id, category)
  where superseded_at is null;
create index utility_submissions_period_store_idx
  on feedbackgb.utility_submissions(period_id, store_id, category, submitted_at desc);

create table feedbackgb.utility_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references feedbackgb.users(id),
  store_id integer not null references categories.spots(spot_id),
  period_id uuid not null references feedbackgb.utility_periods(id),
  category text not null check (category in ('electricity','water','heating','other')),
  storage_path text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  bytes integer not null check (bytes > 0 and bytes <= 2097152),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  claimed_by uuid references feedbackgb.utility_submissions(id),
  check (storage_path like 'utility/%')
);
create index utility_uploads_expiry_idx
  on feedbackgb.utility_uploads(expires_at) where claimed_by is null;

create table feedbackgb.utility_photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references feedbackgb.utility_submissions(id) on delete restrict,
  upload_id uuid not null unique references feedbackgb.utility_uploads(id) on delete restrict,
  sort_order smallint not null check (sort_order between 0 and 14),
  unique(submission_id, sort_order)
);

create table feedbackgb.utility_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references feedbackgb.utility_submissions(id),
  destination text not null default 'accounting_telegram'
    check (destination = 'accounting_telegram'),
  state text not null default 'pending'
    check (state in ('pending','sending','sent','retryable_failed','permanent_failed','uncertain')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  chat_id_snapshot text,
  message_ids jsonb not null default '[]'::jsonb,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index utility_delivery_due_idx
  on feedbackgb.utility_delivery_jobs(state, next_attempt_at);

create table feedbackgb.utility_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references feedbackgb.utility_submissions(id),
  actor_id uuid references feedbackgb.users(id),
  event text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function feedbackgb.submit_utility_photos(
  p_store_id integer, p_period_id uuid, p_category text, p_user_id uuid,
  p_client_submission_id uuid, p_payload_sha256 text, p_comment text,
  p_upload_ids jsonb
) returns uuid language plpgsql security invoker
set search_path = feedbackgb, public, pg_catalog as $$
declare
  v_user feedbackgb.users%rowtype;
  v_period feedbackgb.utility_periods%rowtype;
  v_prior feedbackgb.utility_submissions%rowtype;
  v_submission_id uuid;
  v_source text;
  v_photo jsonb;
  v_upload feedbackgb.utility_uploads%rowtype;
  v_order smallint := 0;
begin
  if p_store_id is null or p_period_id is null or p_user_id is null
    or p_client_submission_id is null or p_category not in ('electricity','water','heating','other')
    or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$'
    or p_upload_ids is null or jsonb_typeof(p_upload_ids) <> 'array'
    or (p_comment is not null and length(p_comment) > 1000) then
    raise exception 'invalid_utility_packet';
  end if;
  if jsonb_array_length(p_upload_ids) < 1 or jsonb_array_length(p_upload_ids) > 15 then
    raise exception 'utility_photo_count_out_of_range';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_store_id::text || ':' || p_period_id::text || ':' || p_category, 0));
  select * into v_prior from feedbackgb.utility_submissions
    where client_submission_id = p_client_submission_id;
  if found then
    if v_prior.submitted_by = p_user_id and v_prior.payload_sha256 = p_payload_sha256
      then return v_prior.id; end if;
    raise exception 'utility_idempotency_conflict';
  end if;
  select * into v_user from feedbackgb.users where id = p_user_id and is_active;
  if not found then raise exception 'utility_user_forbidden'; end if;
  if v_user.role = 'seller' then
    if v_user.store_id = p_store_id then v_source := 'home_store';
    elsif exists (select 1 from feedbackgb.seller_store_permissions
      where seller_id = p_user_id and store_id = p_store_id and revoked_at is null)
      then v_source := 'replacement_permission';
    else raise exception 'utility_store_forbidden'; end if;
  elsif v_user.role in ('admin','super_admin') then v_source := 'admin';
  else raise exception 'utility_role_forbidden'; end if;
  select * into v_period from feedbackgb.utility_periods
    where id = p_period_id and status = 'open';
  if not found then raise exception 'utility_period_closed'; end if;
  if now() > v_period.due_at then raise exception 'utility_deadline_passed'; end if;
  select * into v_prior from feedbackgb.utility_submissions
    where store_id = p_store_id and period_id = p_period_id and category = p_category
      and superseded_at is null for update;
  if found and v_prior.review_status = 'verified' and v_user.role = 'seller' then
    raise exception 'utility_verified_revision_requires_admin';
  end if;
  if found then update feedbackgb.utility_submissions
    set superseded_at = now() where id = v_prior.id; end if;
  insert into feedbackgb.utility_submissions(
    store_id, period_id, category, submitted_by, source, comment,
    client_submission_id, payload_sha256, revision, supersedes_id)
  values(p_store_id, p_period_id, p_category, p_user_id, v_source,
    nullif(btrim(p_comment), ''), p_client_submission_id, p_payload_sha256,
    coalesce(v_prior.revision, 0) + 1, v_prior.id)
  returning id into v_submission_id;
  for v_photo in select value from jsonb_array_elements(p_upload_ids) loop
    select * into v_upload from feedbackgb.utility_uploads
      where id = (v_photo #>> '{}')::uuid and user_id = p_user_id
        and store_id = p_store_id and period_id = p_period_id and category = p_category
        and claimed_by is null and expires_at > now() for update;
    if not found then raise exception 'utility_upload_not_owned'; end if;
    update feedbackgb.utility_uploads set claimed_by = v_submission_id where id = v_upload.id;
    insert into feedbackgb.utility_photos(submission_id, upload_id, sort_order)
      values(v_submission_id, v_upload.id, v_order);
    v_order := v_order + 1;
  end loop;
  insert into feedbackgb.utility_delivery_jobs(submission_id) values(v_submission_id);
  insert into feedbackgb.utility_events(submission_id, actor_id, event)
    values(v_submission_id, p_user_id, 'submitted');
  return v_submission_id;
end $$;
revoke all on function feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function feedbackgb.submit_utility_photos(integer,uuid,text,uuid,uuid,text,text,jsonb)
  to service_role;

create or replace function feedbackgb.review_utility_submission(
  p_submission_id uuid, p_actor_id uuid, p_status text, p_note text
) returns void language plpgsql security invoker
set search_path = feedbackgb, public, pg_catalog as $$
declare v_role text;
begin
  select role into v_role from feedbackgb.users where id = p_actor_id and is_active;
  if v_role is null or v_role not in ('admin','super_admin')
    then raise exception 'utility_reviewer_forbidden'; end if;
  if p_status is null or p_status not in ('verified','needs_correction')
    then raise exception 'utility_review_status_invalid'; end if;
  if p_status = 'needs_correction' and nullif(btrim(p_note), '') is null
    then raise exception 'utility_review_note_required'; end if;
  update feedbackgb.utility_submissions
    set review_status = p_status, reviewed_by = p_actor_id, reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
    where id = p_submission_id and superseded_at is null and review_status = 'submitted';
  if not found then raise exception 'utility_review_conflict'; end if;
  insert into feedbackgb.utility_events(submission_id, actor_id, event, details)
    values(p_submission_id, p_actor_id, p_status,
      jsonb_build_object('note', nullif(btrim(p_note), '')));
end $$;
revoke all on function feedbackgb.review_utility_submission(uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function feedbackgb.review_utility_submission(uuid,uuid,text,text)
  to service_role;

create or replace function feedbackgb.claim_utility_delivery_job(p_chat_id text)
returns uuid language plpgsql security invoker
set search_path = feedbackgb, public, pg_catalog as $$
declare v_job_id uuid;
begin
  if nullif(btrim(p_chat_id), '') is null then raise exception 'utility_chat_missing'; end if;
  select id into v_job_id from feedbackgb.utility_delivery_jobs
    where state in ('pending','retryable_failed') and next_attempt_at <= now()
    order by created_at for update skip locked limit 1;
  if v_job_id is null then return null; end if;
  update feedbackgb.utility_delivery_jobs
    set state = 'sending', attempts = attempts + 1,
      locked_until = now() + interval '10 minutes', chat_id_snapshot = p_chat_id
    where id = v_job_id;
  return v_job_id;
end $$;
revoke all on function feedbackgb.claim_utility_delivery_job(text)
  from public, anon, authenticated;
grant execute on function feedbackgb.claim_utility_delivery_job(text) to service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array['utility_periods','utility_submissions','utility_uploads',
    'utility_photos','utility_delivery_jobs','utility_events'] loop
    execute format('alter table feedbackgb.%I enable row level security', v_table);
    execute format('revoke all on feedbackgb.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on feedbackgb.%I to service_role', v_table);
  end loop;
end $$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('utility-reading-photos', 'utility-reading-photos', false, 2097152,
  array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
commit;
