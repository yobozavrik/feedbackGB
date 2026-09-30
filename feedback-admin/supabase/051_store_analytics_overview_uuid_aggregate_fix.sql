-- Forward-only repair for applied 050.
-- PostgreSQL 15 has ordering for uuid but no built-in max(uuid) aggregate.
-- Replace both single-run selectors with a text aggregate cast back to uuid.
begin;

do $$
declare
  v_signature regprocedure := to_regprocedure(
    'feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz)'
  );
  v_definition text;
  v_occurrences integer;
begin
  if v_signature is null then
    raise exception 'store_analytics_overview_missing';
  end if;

  select pg_get_functiondef(v_signature) into strict v_definition;
  v_occurrences := (
    length(v_definition) - length(replace(v_definition, 'max(r.id)', ''))
  ) / length('max(r.id)');

  if v_occurrences <> 2 then
    raise exception 'store_analytics_uuid_fix_unexpected_definition';
  end if;

  v_definition := replace(v_definition, 'max(r.id)', 'min(r.id::text)::uuid');
  execute v_definition;

  select pg_get_functiondef(v_signature) into strict v_definition;
  if position('max(r.id)' in v_definition) > 0
    or (length(v_definition) - length(replace(v_definition,
      'min(r.id::text)::uuid', ''))) / length('min(r.id::text)::uuid') <> 2 then
    raise exception 'store_analytics_uuid_fix_failed';
  end if;
end;
$$;

commit;
