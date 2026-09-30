-- Read-only post-migration check. Expected: all *_denied = true,
-- service_execute = true, missing_day.status = 'missing'.
select jsonb_build_object(
  'function_exists', to_regprocedure('feedbackgb.audit_poster_receipt_day(date,uuid)') is not null,
  'service_execute', has_function_privilege('service_role',
    'feedbackgb.audit_poster_receipt_day(date,uuid)', 'EXECUTE'),
  'anon_execute_denied', not has_function_privilege('anon',
    'feedbackgb.audit_poster_receipt_day(date,uuid)', 'EXECUTE'),
  'authenticated_execute_denied', not has_function_privilege('authenticated',
    'feedbackgb.audit_poster_receipt_day(date,uuid)', 'EXECUTE'),
  'missing_day', feedbackgb.audit_poster_receipt_day(date '2026-08-19')
) as receipt_day_audit_readback;
