# Supply App runbook

Deploy `supply-app` as a separate Vercel project with Root Directory
`supply-app`. Do not copy production secrets between projects.

Monitor login failures, API errors, outbox lag, retry count, DLQ size, CRM
mismatches and attachment scan failures. Alert when DLQ is non-empty or CRM
failures are sustained.

To stop external writes, disable the worker/feature flag. Do not delete local
documents or outbox rows. Requeue only after the cause and idempotency key are
known. Rotate secrets and invalidate sessions after suspected exposure.
