-- Read-only verification after the project owner applies 057.
select p.proname, p.prosecdef as security_definer,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  position('jsonb_array_length(p_upload_ids) > 3' in pg_get_functiondef(p.oid)) > 0 as max_three,
  position('utility_verified_revision_requires_admin' in pg_get_functiondef(p.oid)) = 0 as verified_can_resubmit,
  position('if v_prior.id is null then' in pg_get_functiondef(p.oid)) > 0 as deadline_first_only,
  position('utility_initial_period_not_current' in pg_get_functiondef(p.oid)) > 0 as initial_current_only
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'feedbackgb' and p.proname = 'submit_utility_photos';
