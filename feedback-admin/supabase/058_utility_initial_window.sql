-- Forward-only change after 057_utility_resubmission_and_three_photos.sql.
-- The project owner applies this migration; do not rerun 056 or 057 in production.
-- First submission opens at 00:00 Europe/Kyiv on the 28th of the current month
-- and closes at its existing due_at. Existing submissions can be replaced at any time.
begin;

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
  if jsonb_array_length(p_upload_ids) < 1 or jsonb_array_length(p_upload_ids) > 3 then
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
  select * into v_period from feedbackgb.utility_periods where id = p_period_id;
  if not found then raise exception 'utility_period_missing'; end if;
  select * into v_prior from feedbackgb.utility_submissions
    where store_id = p_store_id and period_id = p_period_id and category = p_category
      and superseded_at is null for update;
  if v_prior.id is null then
    if v_period.status <> 'open' then raise exception 'utility_period_closed'; end if;
    if v_period.period_start <> date_trunc('month', now() at time zone 'Europe/Kyiv')::date
      then raise exception 'utility_initial_period_not_current'; end if;
    if (now() at time zone 'Europe/Kyiv')::date < v_period.period_start + 27
      then raise exception 'utility_initial_window_not_open'; end if;
    if now() > v_period.due_at then raise exception 'utility_deadline_passed'; end if;
  else
    update feedbackgb.utility_submissions
      set superseded_at = now() where id = v_prior.id;
  end if;
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
commit;
