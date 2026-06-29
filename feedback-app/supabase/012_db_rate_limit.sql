-- Create rate limits table
create table if not exists feedbackgb.rate_limits (
  key         text primary key,
  hits        timestamptz[] not null,
  expire_at   timestamptz not null
);

create index if not exists rate_limits_expire_at_idx on feedbackgb.rate_limits(expire_at);

-- Enable RLS for the table
alter table feedbackgb.rate_limits enable row level security;
grant select, insert, update, delete on feedbackgb.rate_limits to service_role;

-- Stored procedure check_rate_limit
create or replace function feedbackgb.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns jsonb as $$
declare
  v_now timestamptz := now();
  v_window_interval interval := (p_window_seconds || ' seconds')::interval;
  v_hits timestamptz[];
  v_clean_hits timestamptz[];
  v_remaining integer;
  v_reset_seconds integer;
  v_ok boolean;
begin
  -- Delete expired records
  delete from feedbackgb.rate_limits where expire_at < v_now;

  -- Insert/update record atomically using custom window filter
  insert into feedbackgb.rate_limits (key, hits, expire_at)
  values (p_key, array[v_now], v_now + v_window_interval)
  on conflict (key) do update
  set hits = array_append(
    array(
      select h
      from unnest(feedbackgb.rate_limits.hits) h
      where h > v_now - v_window_interval
    ),
    v_now
  ),
  expire_at = (
    select max(h) + v_window_interval
    from unnest(array_append(feedbackgb.rate_limits.hits, v_now)) h
    where h > v_now - v_window_interval
  )
  returning hits into v_hits;

  -- Clean list of active hits
  v_clean_hits := array(
    select h
    from unnest(v_hits) h
    where h > v_now - v_window_interval
  );

  v_ok := array_length(v_clean_hits, 1) <= p_limit;
  v_remaining := p_limit - array_length(v_clean_hits, 1);
  if v_remaining < 0 then
    v_remaining := 0;
  end if;

  if array_length(v_clean_hits, 1) > 0 then
    v_reset_seconds := extract(epoch from (v_clean_hits[1] + v_window_interval - v_now))::integer;
  else
    v_reset_seconds := 0;
  end if;

  if v_reset_seconds < 0 then
    v_reset_seconds := 0;
  end if;

  return jsonb_build_object(
    'ok', v_ok,
    'remaining', v_remaining,
    'reset_ms', v_reset_seconds * 1000
  );
end;
$$ language plpgsql
security definer
set search_path = feedbackgb, public;

-- Revoke all execute rights from public roles and grant to service_role only
revoke execute on function feedbackgb.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function feedbackgb.check_rate_limit(text, integer, integer) to service_role;
