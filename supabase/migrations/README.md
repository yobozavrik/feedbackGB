# Shared database migration ledger

This directory is the canonical ledger for **new** shared FeedbackGB database
migrations. Existing historical migrations remain in the application folders
and must not be replayed from here.

Before applying any migration, record the live migration state and verify the
target schema with a read-only audit. Every new migration must link to:

- `docs/supply-app/DATA_MODEL.md`;
- its RLS/grant design;
- a rollback or forward-fix procedure in `docs/supply-app/RUNBOOK.md`.
