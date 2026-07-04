# Personal Cabinet ("Мої заявки") Implementation Plan

## Goal

Give every seller (and admin, for their own submissions) a single page listing
**all** feedback/HR requests they personally submitted, across every
category, showing:

1. Current status (`new` / `in_progress` / `resolved` / `rejected`).
2. Who is responsible (`assigned_to` -> admin's name).
3. The comment thread attached to that request (`feedback_comments`).

This complements [IN_APP_NOTIFICATIONS_PLAN.md](IN_APP_NOTIFICATIONS_PLAN.md):
the bell is an ephemeral "something changed" ping; the cabinet is the
persistent place that answers "where does my request stand right now" after
the ping has been read and forgotten. The bell should deep-link into this
cabinet once it exists (see "Wiring into the bell" below).

## Why Not Just Extend the Bell

Two per-topic list components already exist and cover part of this need:

- `feedback-app/src/components/TransferRequests.tsx` — one seller's own
  store-transfer requests (`GET /api/hr/transfer-requests`).
- `feedback-app/src/components/HrDateRangeRequests.tsx` — one seller's own
  date-range HR requests (vacation / day-off / sick-leave), parameterized by
  `endpoint`.

Both show status but neither shows the assignee or comments, and both are
scoped to a single HR sub-type rather than "everything I've ever submitted"
(regular feedback categories — missing_item, defect, repair request, etc. —
have no such list at all). Rather than adding assignee+comments to each of
these separately, generalize into one cabinet backed by the existing
`feedback_feed` view, which already has everything needed in one row.

## Current Project Context

Relevant existing pieces (no new tables needed):

- `feedbackgb.feedback_feed` view (`feedback-admin/supabase/schema.sql`)
  already joins `assigned_full_name`, `category_title`, `category_emoji`,
  `summary`, `status`, `resolved_at`, `user_id` in one row — this is exactly
  the shape needed for a list, already used by the admin panel.
- `feedbackgb.feedback_comments` table (`010_feedback_comments.sql`) already
  stores the admin-authored comment thread per feedback row; today only
  written/read from the admin side
  (`feedback-admin/src/app/api/admin/feedback/[id]/route.ts`).
- `feedback-app/src/lib/session.ts` — `sess.uid` identifies "my" rows via
  `feedback.user_id`.
- In-app notifications (built, not yet deployed — see status note in
  `IN_APP_NOTIFICATIONS_PLAN.md`) already carry `feedback_id` in their
  payload, so a notification click can route straight into a cabinet detail
  page once one exists.

## Data Model

No migration required. `feedback_feed` and `feedback_comments` already carry
everything. The only new read pattern is: filter `feedback_feed` by
`user_id = session.uid`, and expose `feedback_comments` to the *owning*
seller (currently only exposed to admins).

## API Endpoints (new, `feedback-app`)

### List My Requests

```text
GET /api/my-feedback?limit=50
```

- Session-gated (any role — same pattern as `/api/notifications`, not
  admin-only).
- Query: `feedback_feed` where `user_id = sess.uid`, ordered by
  `created_at desc`.
- Response fields per row: `id, category, category_emoji, category_title,
  summary, status, assigned_full_name, created_at, resolved_at`.
- Deliberately excludes other sellers' rows — never trust a client-supplied
  user id, always filter server-side from the session.

### Request Detail + Comments

```text
GET /api/my-feedback/[id]
```

- Session-gated. **Ownership check is mandatory**: look up the row, confirm
  `feedback_feed.user_id === sess.uid` (or `404` if not — never `403`,
  to avoid confirming that a given id exists to someone who doesn't own it).
- Returns the full feedback row (all `fields`, `photo_urls`, `status`,
  `assigned_full_name`) plus its comment thread:
  ```json
  {
    "feedback": { "...": "..." },
    "comments": [
      { "id": "...", "body": "...", "author_full_name": "...", "created_at": "..." }
    ]
  }
  ```
- Comments query needs `feedback_comments` joined to `users(full_name)` for
  `author_id` — sellers should see "Іван (адмін)", not a raw uuid.
- Read-only in MVP: sellers view the thread but cannot reply (no comment
  compose box). Revisit if support wants two-way dialogue later.

No write endpoints in MVP — this is a read-only cabinet.

## UI (`feedback-app`)

### Entry Point

Add a small "Мої заявки" link next to the notification bell in
`Header.tsx` (same visual slot/pattern as `NotificationsBell.tsx`), so it's
reachable from every page, not just the home screen.

### List Page

```text
feedback-app/src/app/(app)/my-requests/page.tsx
feedback-app/src/components/MyRequestsList.tsx
```

Client component fetching `/api/my-feedback`, following the existing
`NotificationsList.tsx` / `TransferRequests.tsx` visual pattern:
category emoji + title, one-line summary, status pill (reuse the existing
`STATUS_META` color mapping already duplicated across
`TransferRequests.tsx` / `HrDateRangeRequests.tsx` — worth extracting to a
shared `feedbackStatusMeta.ts` while touching this), assignee name if
present, relative created time. Tapping a row navigates to the detail page.

### Detail Page

```text
feedback-app/src/app/(app)/my-requests/[id]/page.tsx
```

Shows the full submitted fields (reuse whatever renders category fields
today, e.g. the same field-label mapping `FeedbackForm.tsx` uses for
submission, in reverse/read-only mode), current status, assignee, and the
comment thread rendered oldest-first.

### Wiring Into the Bell

Update `NotificationsBell.tsx` / `NotificationsList.tsx` click handling: if
a clicked notification has a non-null `feedback_id`, navigate to
`/my-requests/<feedback_id>` instead of just marking read in place. This
fulfills the "if a feedback detail page exists, open it" fallback already
anticipated in `IN_APP_NOTIFICATIONS_PLAN.md`.

## Permissions and Security

- `/api/my-feedback*` must never accept a client-supplied `user_id` —
  always derive from the session, same rule as notifications.
- Detail endpoint must 404 (not 403) on a request id that exists but isn't
  the caller's, to avoid leaking existence of other sellers' requests.
- Comments are read-only for sellers; only admins write them (existing
  `admin.feedback.note` audit path is unchanged).

## Implementation Steps

1. **Extract shared status metadata** (small pre-req cleanup): pull the
   `STATUS_META` map duplicated in `TransferRequests.tsx` and
   `HrDateRangeRequests.tsx` into `feedback-app/src/lib/feedbackStatusMeta.ts`
   (or reuse `feedbackStatus.ts` if it already carries UI labels — check
   before adding a new file) so the new cabinet list uses the same one.
2. **`GET /api/my-feedback`** — list endpoint, session-gated, `user_id`
   filter, tested for: returns only the caller's own rows; empty list for a
   seller with no submissions.
3. **`GET /api/my-feedback/[id]`** — detail + comments endpoint, tested for:
   owner gets full data + comments; non-owner gets 404; bad/missing id gets
   400/404.
4. **`MyRequestsList.tsx` + `/my-requests` page** — list UI.
5. **`/my-requests/[id]` page** — detail UI with comment thread.
6. **Header entry point** — add the link next to the bell.
7. **Bell deep-link** — update notification click handling to route into
   the new detail page when `feedback_id` is present.
8. **Tests**: API ownership tests (step 2/3), plus a manual QA pass:
   submit a request as seller A, confirm seller B's `/my-requests` doesn't
   show it and `/api/my-feedback/<A's id>` 404s for B.

## Acceptance Criteria

1. A seller can open "Мої заявки" and see every request they've personally
   submitted, across all categories, newest first.
2. Each row shows current status and (if assigned) the responsible admin's
   name.
3. Opening a request shows the full comment thread written by admins.
4. A seller can never see another seller's requests or comments, via list
   or direct id.
5. Clicking a bell notification with a `feedback_id` opens that request's
   detail page directly.

## Rollout

Ship after (or alongside) the in-app notifications deploy, since the bell's
deep-link (step 7 above) depends on the cabinet detail route existing. See
the rollout checklist in `IN_APP_NOTIFICATIONS_PLAN.md`.
