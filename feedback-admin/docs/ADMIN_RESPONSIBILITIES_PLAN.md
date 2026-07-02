# Admin Responsibilities and Auto Assignment Plan

## Goal

When a seller creates a feedback/request, the admin panel should automatically assign the responsible admin based on the request type, store, and configured responsibility rules.

This separates three concepts:

- Role: `admin` or `super_admin`.
- Permission: what an admin may see or do.
- Responsibility: what request types an admin is accountable for.

## Core Model

### Permissions

Permissions describe concrete app actions or request types.

Examples for "Продукція мережі":

```text
network_products.many_goods
network_products.low_goods
network_products.defective_goods
```

Suggested table:

```sql
create table feedbackgb.admin_permission_codes (
  code text primary key,
  section text not null,
  title text not null,
  is_active boolean not null default true
);
```

### Responsibilities

Responsibilities describe which admin is responsible for which permission/request type.

Suggested table:

```sql
create table feedbackgb.admin_responsibilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references feedbackgb.users(id) on delete cascade,
  permission_code text not null references feedbackgb.admin_permission_codes(code),
  store_id int null,
  priority int not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Rules:

- `store_id = null` means all stores.
- Lower `priority` wins.
- Only active admin users should be assignable.
- `super_admin` does not automatically own all requests unless a rule explicitly assigns them.

### Request Assignment

Add the assigned admin to feedback rows:

```sql
alter table feedbackgb.feedback
  add column if not exists assigned_admin_id uuid null references feedbackgb.users(id);
```

Optional audit/history table:

```sql
create table feedbackgb.feedback_assignment_log (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references feedbackgb.feedback(id) on delete cascade,
  old_admin_id uuid null references feedbackgb.users(id),
  new_admin_id uuid null references feedbackgb.users(id),
  reason text not null,
  actor_user_id uuid null references feedbackgb.users(id),
  created_at timestamptz not null default now()
);
```

## Auto Assignment Logic

Map every request subtype to a permission code.

Example:

```text
Продукція мережі / Багато товару -> network_products.many_goods
Продукція мережі / Мало товару   -> network_products.low_goods
Продукція мережі / Брак товару   -> network_products.defective_goods
```

Resolution order:

1. Find active responsibility for `permission_code` and exact `store_id`.
2. If multiple rows match, use the lowest `priority`.
3. If none match, find active responsibility for `permission_code` and `store_id is null`.
4. If multiple rows match, use the lowest `priority`.
5. If none match, leave `assigned_admin_id = null`.

Backend helper:

```ts
resolveAssignedAdmin({
  permissionCode,
  storeId,
}): Promise<string | null>
```

This helper must run on the server when feedback is created. Assignment must not be frontend-only.

## Backend Work

Add API/server logic:

- Map feedback category/subtype to `permission_code`.
- Resolve assignee before inserting feedback.
- Write `assigned_admin_id` into `feedbackgb.feedback`.
- Support manual reassignment.
- Write audit events.

Suggested audit actions:

```text
admin.assignment.auto
admin.assignment.manual
admin.responsibility.create
admin.responsibility.update
admin.responsibility.deactivate
```

Suggested endpoints:

```text
GET    /api/admin/responsibilities
POST   /api/admin/responsibilities
PATCH  /api/admin/responsibilities/[id]
DELETE /api/admin/responsibilities/[id]
PATCH  /api/admin/feedback/[id]/assignee
```

Deletion should be soft-delete by setting `is_active = false`.

## Admin UI Work

Add a management screen:

```text
Admin -> Settings -> Responsibilities
```

or inside the users section:

```text
Admin -> Users -> Admin card -> Responsibilities
```

Minimum fields:

```text
Admin
Function / request type
Store: all stores or one store
Priority
Active
```

Example row:

```text
Оля | Продукція мережі / Брак товару | Всі магазини | priority 10 | active
```

Super admin:

- Can view all responsibility rules.
- Can create, edit, and deactivate rules.
- Can manually reassign feedback.

Regular admin:

- Can view assigned feedback.
- May view own responsibilities read-only.

## Feedback UI Work

Add an assignee column to feedback tables:

```text
Responsible admin
```

Add filters:

```text
My requests
Unassigned
Responsible = ...
Category = ...
```

In the feedback drawer/card:

```text
Responsible: Оля
[Reassign]
```

Manual reassignment must write an audit event and, if implemented, an assignment history row.

## Security Rules

- Hiding buttons in UI is not enough.
- Backend must enforce permission checks.
- Ordinary admins must not be able to assign privileged responsibilities unless explicitly allowed.
- `service_role` writes remain server-only.
- Audit must record who changed responsibilities and who reassigned feedback.

## Implementation Order

1. Add DB migration for `assigned_admin_id`, `admin_permission_codes`, and `admin_responsibilities`.
2. Seed current app functions/request types.
3. Add `resolveAssignedAdmin`.
4. Connect auto assignment to feedback creation.
5. Show responsible admin in feedback lists and drawer.
6. Add manual reassignment endpoint and UI.
7. Add responsibilities management UI.
8. Add audit events.
9. Add tests for assignment priority, store-specific rules, fallback rules, unassigned requests, and manual reassignment.

## MVP Scope

Fast MVP:

- `assigned_admin_id` on feedback.
- `admin_responsibilities`.
- Auto assignment on feedback creation.
- "Responsible admin" column.
- Manual reassignment.

Permissions can be expanded in a second phase, but responsibilities should be modeled in the DB from the start.
