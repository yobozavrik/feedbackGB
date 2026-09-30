select jsonb_build_object(
  'table_exists', to_regclass('feedbackgb.poster_receipt_cron_days') is not null,
  'rls_enabled', coalesce((
    select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'feedbackgb' and c.relname = 'poster_receipt_cron_days'
  ), false),
  'claim_exists', to_regprocedure(
    'feedbackgb.claim_poster_receipt_cron_day(text,date,uuid,integer)'
  ) is not null,
  'complete_exists', to_regprocedure(
    'feedbackgb.complete_poster_receipt_cron_day(text,date,uuid,uuid,bigint,bigint,bigint)'
  ) is not null,
  'fail_exists', to_regprocedure(
    'feedbackgb.fail_poster_receipt_cron_day(text,date,uuid,text)'
  ) is not null,
  'service_claim_execute', has_function_privilege(
    'service_role',
    'feedbackgb.claim_poster_receipt_cron_day(text,date,uuid,integer)',
    'execute'
  ),
  'service_complete_execute', has_function_privilege(
    'service_role',
    'feedbackgb.complete_poster_receipt_cron_day(text,date,uuid,uuid,bigint,bigint,bigint)',
    'execute'
  ),
  'service_fail_execute', has_function_privilege(
    'service_role',
    'feedbackgb.fail_poster_receipt_cron_day(text,date,uuid,text)',
    'execute'
  ),
  'anon_claim_denied', not has_function_privilege(
    'anon',
    'feedbackgb.claim_poster_receipt_cron_day(text,date,uuid,integer)',
    'execute'
  ),
  'authenticated_claim_denied', not has_function_privilege(
    'authenticated',
    'feedbackgb.claim_poster_receipt_cron_day(text,date,uuid,integer)',
    'execute'
  ),
  'service_direct_table_denied', not has_table_privilege(
    'service_role', 'feedbackgb.poster_receipt_cron_days', 'select'
  ) and not has_table_privilege(
    'service_role', 'feedbackgb.poster_receipt_cron_days', 'insert'
  ) and not has_table_privilege(
    'service_role', 'feedbackgb.poster_receipt_cron_days', 'update'
  )
) as receipt_cron_lease_readback;
