-- Use only before application code depends on migration 052.
begin;
drop function if exists feedbackgb.read_store_category_product_analytics(
  date,date,bigint[],date,date,timestamptz,bigint,boolean,bigint,bigint,text,text,text,integer,integer
);
drop function if exists feedbackgb._store_analytics_latest_facts(date,date,bigint[],timestamptz);
commit;
