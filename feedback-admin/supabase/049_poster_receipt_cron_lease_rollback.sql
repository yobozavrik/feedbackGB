-- Manual rollback only. Remove/disable /api/cron/poster-receipts before running.
-- Refuses to discard an operational journal after the first claimed day.
begin;

lock table feedbackgb.poster_receipt_cron_days in access exclusive mode;

do $$
begin
  if exists (select 1 from feedbackgb.poster_receipt_cron_days) then
    raise exception 'receipt_cron_rollback_refused_nonempty';
  end if;
end;
$$;

drop function feedbackgb.fail_poster_receipt_cron_day(text, date, uuid, text);
drop function feedbackgb.complete_poster_receipt_cron_day(text, date, uuid, uuid, bigint, bigint, bigint);
drop function feedbackgb.claim_poster_receipt_cron_day(text, date, uuid, integer);
drop table feedbackgb.poster_receipt_cron_days;

commit;
