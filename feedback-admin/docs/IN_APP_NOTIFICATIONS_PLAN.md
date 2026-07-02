# In-App Notifications Implementation Plan

## Goal

Build an internal notification system for admins and sellers.

MVP behavior:

1. Seller creates a request, for example "Заявка на ремонт".
2. The request gets status `new`.
3. The system assigns a responsible admin.
4. The responsible admin sees an in-app notification in the admin panel.
5. When the responsible admin changes status from `new` to `in_progress`, the seller sees an in-app notification in the seller app.

This is not Browser Web Push. Notifications are visible only inside the application/admin panel.

## Why Start With In-App Notifications

In-app notifications are the base layer for any later delivery channel.

Later, the same notification rows can be used to send:

- Telegram bot messages.
- Browser Web Push.
- Email.
- Daily digest.

If external delivery fails, the notification still remains visible inside the system.

## Current Project Context

Existing relevant pieces:

- `feedbackgb.feedback.status`
  - Existing statuses: `new`, `in_progress`, `resolved`, `rejected`.
- `feedbackgb.feedback.user_id`
  - Seller who created the request.
- `feedbackgb.feedback.assigned_to`
  - Existing assignee field in schema.
- Admin feedback status update endpoint:
  - `feedback-admin/src/app/api/admin/feedback/[id]/route.ts`
- Seller feedback creation endpoint:
  - `feedback-app/src/app/api/feedback/route.ts`
- Audit helper:
  - `feedback-admin/src/lib/audit.ts`
  - `feedback-app/src/lib/audit.ts`

Related future dependency:

- Admin responsibilities and auto-assignment plan:
  - `feedback-admin/docs/ADMIN_RESPONSIBILITIES_PLAN.md`

## Data Model

### Notifications Table

Add a table in `feedbackgb`:

```sql
create table feedbackgb.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references feedbackgb.users(id) on delete cascade,
  feedback_id uuid null references feedbackgb.feedback(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);
```

Recommended indexes:

```sql
create index notifications_recipient_created_idx
  on feedbackgb.notifications (recipient_user_id, created_at desc);

create index notifications_recipient_unread_idx
  on feedbackgb.notifications (recipient_user_id, created_at desc)
  where is_read = false;

create index notifications_feedback_idx
  on feedbackgb.notifications (feedback_id, created_at desc)
  where feedback_id is not null;
```

### Notification Types

Use stable machine-readable type names:

```text
feedback.assigned_to_admin
feedback.status_in_progress_for_seller
feedback.status_resolved_for_seller
feedback.status_rejected_for_seller
feedback.reassigned_to_admin
```

MVP requires only:

```text
feedback.assigned_to_admin
feedback.status_in_progress_for_seller
```

### Payload Shape

Store extra structured data in `payload`.

Example for admin:

```json
{
  "status": "new",
  "category": "tech_issue",
  "store_id": 18,
  "store_name": "Бульвар"
}
```

Example for seller:

```json
{
  "old_status": "new",
  "new_status": "in_progress",
  "admin_user_id": "..."
}
```

Do not put secrets or raw personal contact data in `payload`.

## Backend Service Layer

Create a small notification helper.

Recommended file:

```text
feedback-admin/src/lib/notifications.ts
feedback-app/src/lib/notifications.ts
```

If duplication becomes a problem, move shared logic to a shared package later. For MVP, keep it close to each app.

Helper responsibilities:

```ts
createNotification({
  recipientUserId,
  feedbackId,
  type,
  title,
  body,
  payload,
})
```

Rules:

- Must run only server-side.
- Must use service-role Supabase client.
- Must never throw in a way that breaks the main business action unless explicitly required.
- Should log errors to server console.

Recommendation:

- Feedback creation should still succeed even if notification insert fails.
- Status update should still succeed even if notification insert fails.
- Notification failure should be visible in logs and optionally audit later.

## API Endpoints

### List Current User Notifications

```text
GET /api/notifications
```

For seller app.

```text
GET /api/admin/notifications
```

For admin panel.

Response:

```json
{
  "notifications": [
    {
      "id": "...",
      "type": "feedback.assigned_to_admin",
      "title": "Нова заявка на ремонт",
      "body": "Магазин Бульвар створив нову заявку.",
      "feedback_id": "...",
      "payload": {},
      "is_read": false,
      "created_at": "..."
    }
  ],
  "unread_count": 3
}
```

Query params:

```text
?unread=1
?limit=50
?cursor=<created_at/id cursor>
```

MVP can use:

```text
limit=50
no cursor
```

### Mark One Notification As Read

```text
POST /api/notifications/[id]/read
POST /api/admin/notifications/[id]/read
```

Rules:

- User can mark only own notification as read.
- `read_at = now()`.
- Idempotent: reading an already-read notification returns success.

### Mark All As Read

```text
POST /api/notifications/read-all
POST /api/admin/notifications/read-all
```

MVP optional. Useful for the bell dropdown.

## Event 1: Seller Creates New Request

Trigger point:

```text
feedback-app/src/app/api/feedback/route.ts
```

Flow:

1. Validate seller session.
2. Validate feedback payload.
3. Determine category/request type.
4. Resolve responsible admin.
5. Insert feedback with:

```text
status = new
assigned_to = resolved admin id
```

6. If `assigned_to` is not null, insert notification for admin:

```text
recipient_user_id = assigned_to
feedback_id = new feedback id
type = feedback.assigned_to_admin
title = Нова заявка
body = New request summary
```

7. Return success to seller.

Important:

- Auto-assignment must be server-side.
- Notification insert happens after feedback insert.
- If no responsible admin exists, no admin notification is created.

Example notification text:

```text
Title: Нова заявка на ремонт
Body: Магазин Бульвар створив нову заявку. Статус: Нова.
```

## Event 2: Admin Changes Status New -> In Progress

Trigger point:

```text
feedback-admin/src/app/api/admin/feedback/[id]/route.ts
```

Flow:

1. Validate admin session.
2. Fetch current feedback row before update.
3. Apply status update.
4. If old status is `new` and new status is `in_progress`:
   - find `feedback.user_id`;
   - create notification for seller.
5. Return success to admin UI.

Notification:

```text
recipient_user_id = feedback.user_id
feedback_id = feedback.id
type = feedback.status_in_progress_for_seller
title = Заявку взято в роботу
body = Вашу заявку прийняли та взяли в роботу.
```

Rules:

- If `feedback.user_id` is null, skip seller notification.
- Only notify on real transition `new -> in_progress`.
- Do not send duplicate notifications when status is saved as `in_progress` again.

## UI: Admin Panel

### Header Bell

Add a notification bell in admin header.

Behavior:

- Shows unread count.
- Opens dropdown/drawer.
- Lists latest notifications.
- Clicking notification opens related feedback drawer/page.
- Mark notification as read when clicked.

Suggested states:

```text
Unread
Read
Empty
Loading
Error
```

### Notification List Item

Fields:

```text
Title
Body
Created time
Unread indicator
Optional category/store tag
```

Example:

```text
Нова заявка на ремонт
Магазин Бульвар створив нову заявку.
2 хв тому
```

### Polling

MVP delivery:

```text
poll GET /api/admin/notifications every 30 seconds
```

Also refresh:

- on page focus;
- after marking as read;
- after admin status update.

Do not start with Supabase Realtime unless needed. Polling is simpler and enough for MVP.

## UI: Seller App

Add a lightweight notification entry point.

MVP options:

1. Bell icon on home screen.
2. Inline banner after login/home load.
3. Notifications page.

Recommended MVP:

- Home screen bell with unread count.
- Notification list page or bottom sheet.

Seller notification example:

```text
Заявку взято в роботу
Вашу заявку прийняли та взяли в роботу.
```

Click behavior:

- If a feedback detail page exists, open it.
- If not, show notification details only.

## Read/Unread Rules

Unread count:

```sql
select count(*)
from feedbackgb.notifications
where recipient_user_id = <current user>
  and is_read = false;
```

Mark read:

```sql
update feedbackgb.notifications
   set is_read = true,
       read_at = coalesce(read_at, now())
 where id = <notification id>
   and recipient_user_id = <current user>;
```

Mark all read:

```sql
update feedbackgb.notifications
   set is_read = true,
       read_at = coalesce(read_at, now())
 where recipient_user_id = <current user>
   and is_read = false;
```

## Audit

Notification creation itself does not need an audit row for every message in MVP.

Audit should cover source business actions:

- feedback created;
- feedback assigned;
- feedback status changed;
- manual reassignment.

Optional later audit actions:

```text
notification.create.failed
notification.delivery.failed
```

## Error Handling

Notification creation failure:

- Log server-side.
- Do not fail feedback creation.
- Do not fail status update.

Notification list failure:

- UI shows small error state.
- Keep old notifications visible if available.

Read failure:

- UI can optimistically mark read.
- If server fails, refresh list.

## Permissions and Security

API rules:

- Seller can read only their own notifications.
- Admin can read only their own notifications.
- Super admin can read own notifications; global notification admin view is not MVP.
- Only server-side business flows create notifications.
- Client cannot create arbitrary notifications.

Backend must never trust `recipient_user_id` from client for notification creation.

## Implementation Steps

### Step 1: DB Migration

Create migration:

```text
feedback-admin/supabase/010_notifications.sql
```

Contents:

- `feedbackgb.notifications`
- indexes
- grants to `service_role`
- RLS enabled
- no anon/authenticated table policies

### Step 2: Notification Helper

Add server helper:

```text
feedback-admin/src/lib/notifications.ts
feedback-app/src/lib/notifications.ts
```

Functions:

```ts
createNotification(...)
listNotifications(...)
markNotificationRead(...)
markAllNotificationsRead(...)
```

For MVP, list/read helpers can live directly in API routes if simpler.

### Step 3: Admin Notifications API

Add:

```text
feedback-admin/src/app/api/admin/notifications/route.ts
feedback-admin/src/app/api/admin/notifications/[id]/read/route.ts
feedback-admin/src/app/api/admin/notifications/read-all/route.ts
```

Use `requireAdminSession()`.

### Step 4: Seller Notifications API

Add:

```text
feedback-app/src/app/api/notifications/route.ts
feedback-app/src/app/api/notifications/[id]/read/route.ts
feedback-app/src/app/api/notifications/read-all/route.ts
```

Use seller session validation.

### Step 5: Create Admin Notification On New Assigned Feedback

In seller feedback creation:

1. Ensure feedback insert returns inserted row id and assigned admin id.
2. Insert admin notification if assigned admin exists.

This step depends on auto-assignment existing.

Temporary MVP fallback:

- If auto-assignment is not implemented yet, create this hook but do nothing when `assigned_to` is null.

### Step 6: Create Seller Notification On Status Transition

In admin feedback patch endpoint:

1. Fetch previous feedback row.
2. Update status.
3. If transition is `new -> in_progress`, notify `feedback.user_id`.

### Step 7: Admin UI Bell

Add component:

```text
feedback-admin/src/components/admin/NotificationsBell.tsx
```

Use polling:

```text
every 30 seconds
on window focus
after mark read
```

Mount in admin shell/header.

### Step 8: Seller UI Notification Entry

Add simple notification bell or banner in seller app.

Recommended files depend on current layout:

```text
feedback-app/src/components/NotificationsBell.tsx
feedback-app/src/app/(app)/page.tsx
```

### Step 9: Tests

Backend tests:

- creating notification validates required fields;
- list returns only current user's notifications;
- read endpoint cannot mark another user's notification;
- `new -> in_progress` creates seller notification once;
- repeated `in_progress -> in_progress` does not duplicate;
- feedback with no `user_id` skips seller notification.

UI tests/manual QA:

- admin receives notification after assigned feedback is created;
- unread count updates;
- clicking notification marks read;
- seller receives notification after status change;
- polling refreshes without page reload.

### Step 10: Rollout

Rollout order:

1. Deploy DB migration.
2. Deploy backend notification APIs.
3. Deploy admin UI bell.
4. Deploy seller UI notification list.
5. Enable notification creation in business flows.

Reason:

- UI can safely show empty state before business events create notifications.
- Backend can safely write notifications before UI reads them.

## MVP Acceptance Criteria

MVP is complete when:

1. A notification row is created for the responsible admin when an assigned request is created.
2. The admin sees unread count in admin panel.
3. Admin can open and mark notification as read.
4. When admin changes request from `new` to `in_progress`, seller gets a notification.
5. Seller can view and mark notification as read.
6. Notification failures do not break feedback creation or status update.

## Future Phases

### Phase 2: Telegram Notifications

Use `feedbackgb.notifications` as source.

Add delivery fields:

```text
telegram_sent_at
telegram_error
```

or separate table:

```text
notification_deliveries
```

### Phase 3: Browser Web Push

Add:

```text
push_subscriptions
notification_deliveries
VAPID keys
service worker
```

Use existing notification rows as source.

### Phase 4: Realtime

Replace or supplement polling with Supabase Realtime.

Keep polling fallback.
