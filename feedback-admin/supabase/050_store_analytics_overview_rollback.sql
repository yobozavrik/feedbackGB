-- Safe only while no deployed application depends on this function.
begin;
drop function if exists feedbackgb.read_store_analytics_overview(date,date,bigint[],date,date,timestamptz);
commit;
