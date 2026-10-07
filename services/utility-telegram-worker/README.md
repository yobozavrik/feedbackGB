# Utility readings → Telegram from a work account

This is the **second-stage** outbox. It uses one Telegram user account through
MTProto on one VPS/Coolify instance. It does not use the Bot API. The previous
Vercel `/api/cron/utility-dispatch` remains disabled and must not run alongside
this worker. Supabase remains the source of truth; Telegram is a delivery copy.

## Why a dedicated process

Telegram can invalidate an authorization key when its main session is used in
parallel connections. A serverless cron can overlap or start multiple instances.
Keep exactly one replica and one persistent session volume. `worker.py` uses a
Linux file lock as an additional local guard. Never copy the session file into
Git, logs, an image, or a second running process.

## Required private environment values

Set these in Coolify for the service, not in a tracked file:

| Variable | Meaning |
|---|---|
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Application credentials from my.telegram.org for the work account. |
| `UTILITY_TELEGRAM_CHAT_ID` | Target group ID supplied by the owner; confirm with `--check`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Same production Supabase project as app/admin. The key is a broad secret. |
| `UTILITY_TELEGRAM_ENABLED` | Keep `false` until a test message and delivery readback pass. |
| `TELEGRAM_SESSION_PATH` | `/data/utility-account` by default; persistent protected volume. |

The Vercel admin env `TELEGRAM_UTILITY_CHAT_ID` is for the old Bot API route.
It does **not** enable this service. Leave Vercel `UTILITY_READINGS_ENABLED`
disabled until the admin status route is switched to this transport.

## Deployment sequence

1. Deploy `compose.yaml` as one replica with a persistent `/data` volume. The
   service starts disabled and does not open the account session.
2. Run `docker compose run --rm -it worker python bootstrap.py` once on the
   VPS. Enter the work-account phone, Telegram login code and optional 2FA
   password interactively. Do not paste them into this chat. Bootstrap verifies
   that the account sees the target group; it writes a protected session file
   only to `/data`.
3. Run `docker compose run --rm worker python worker.py --check`. This opens
   the session read-only and verifies it is a user account and the group ID is
   visible. Stop this check before starting an enabled worker.
4. Run `docker compose run --rm worker python worker.py --send-test` only after
   `--check` succeeds, and confirm the test text appears in the intended group.
   This sends one message but does not claim a Supabase job.
5. Inspect `utility_delivery_jobs` in Supabase. Any existing `pending` jobs
   will be sent when enabled; review the queue first. `sending`/`uncertain`
   must be reconciled manually.
6. Use a staging project and a staging group for an end-to-end packet when
   available. In production, wait for an authorized submission during the
   28th–last-day window; do not fabricate a production reading for a test.
   Enable the service and verify the text and every photo in the exact group.
   Read back `state='sent'` and all `message_ids` for the matching job. If no
   packet exists, there is nothing to synchronize yet.
7. Set the admin deployment's `UTILITY_DELIVERY_TRANSPORT=mtproto` before
   setting `UTILITY_READINGS_ENABLED=true`. The old Bot API route then skips
   jobs, and the admin delivery-status tab becomes visible. Keep the old Bot
   API cron unscheduled.

## Delivery behavior

The worker polls every 30 seconds when idle and drains one job at a time.
It preloads all 1–3 photos before sending a text and replies with photos. It
records each returned message ID in `utility_delivery_jobs`. A failure after
any send attempt becomes `uncertain`; it is **never retried automatically**,
because Telegram may have received the message despite a lost response. A
failure before sending becomes `retryable_failed` or `permanent_failed`.
If the process dies while a job is `sending`, it stays there for manual
reconciliation. The SQL claim function intentionally does not re-claim it.

Operational logs include job/submission IDs, states and safe error codes.
They do not include account credentials, session, photo bytes, comments,
chat ID or Supabase key. Watch for `uncertain`, stale `sending`, backend errors
and queue age. Assign an operator before activation.

## Source references

- `feedback-admin/supabase/056_utility_readings.sql`: queue and claim RPC.
- `feedback-admin/supabase/058_utility_initial_window.sql`: current submission
  RPC, applied by the owner in production.
- `docs/UTILITY_PHOTO_REPORT_TECHNICAL_DOCUMENTATION_2026-10-07.md`: app/admin
  route and business contract.
