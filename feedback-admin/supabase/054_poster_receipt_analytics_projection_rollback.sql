-- Safe only before any derived projection was written.
begin;
do $$ begin
  if exists(select 1 from feedbackgb.poster_receipt_analytics_runs)
    or exists(select 1 from feedbackgb.poster_receipt_analytics_facts)
    or exists(select 1 from feedbackgb.poster_receipt_line_analytics_facts)
  then raise exception 'receipt_analytics_projection_not_empty'; end if;
end $$;
drop trigger if exists poster_receipt_capture_analytics_projection on feedbackgb.poster_receipt_import_runs;
drop function if exists feedbackgb.capture_poster_receipt_analytics_projection();
drop function if exists feedbackgb.audit_poster_receipt_analytics_day(date);
drop function if exists feedbackgb.project_poster_receipt_analytics_day(date);
drop function if exists feedbackgb._project_poster_receipt_analytics_run(uuid);
drop view if exists feedbackgb.v_poster_receipt_product_bridge;
drop table if exists feedbackgb.poster_receipt_line_analytics_facts;
drop table if exists feedbackgb.poster_receipt_analytics_facts;
drop table if exists feedbackgb.poster_receipt_analytics_runs;
drop function if exists feedbackgb._poster_receipt_quantity(text);
drop function if exists feedbackgb._poster_receipt_major_to_minor(text);
commit;
