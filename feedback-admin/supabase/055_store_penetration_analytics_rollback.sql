begin;
drop function if exists feedbackgb.read_store_penetration_analytics(date,date,bigint[],timestamptz,bigint);
commit;
