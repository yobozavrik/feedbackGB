# Admin Directions & Auto-Assignment Plan

> **Status (2026-07): implemented.** Migration `015_admin_directions.sql`
> applied to the live DB. `resolveAssignedAdmin()`, the `/api/feedback`
> wiring, `/api/admin/directions*` CRUD, and the "Напрямки" drawer in
> `users-client.tsx` are all in place and covered by automated tests
> (`assignment.test.ts`, `feedback-route.test.ts`,
> `admin-directions.test.ts`). Not yet done: a live authenticated
> browser click-through of the drawer (skipped by request — verification
> relied on tsc + full test suite + production build instead).

> Supersedes `ADMIN_RESPONSIBILITIES_PLAN.md`. That plan assumed a schema
> that does not exist (`assigned_admin_id`, `admin_permission_codes`,
> dotted permission codes like `network_products.many_goods`, a `priority`
> field). This plan is verified line-by-line against the actual schema in
> `feedback-admin/supabase/schema.sql` + migrations `002`–`014` as of
> 2026-07. `ADMIN_RESPONSIBILITIES_PLAN.md` should be deleted once this
> plan is reviewed and accepted.

## Goal

When a seller submits a request via the Web App, the request must land in
the admin panel already assigned to the admin responsible for that
category ("напрямок"). Responsibility is defined per admin, per category
— sourced from the same 9 categories the seller app already shows — with
optional per-store scoping.

## Verified current state (do not re-derive, this is checked)

- `feedbackgb.categories` (`schema.sql:107-123`, extended by
  `011_new_categories.sql`) already mirrors `shared/lib/categories.ts` and
  is the canonical list of 9 request types: `missing_item`, `overstock`,
  `defect`, `supply_problem`, `store_idea`, `spotted_elsewhere`,
  `tech_issue`, `customer_voice`, `consumables_request`.
  `feedback.category` already has `references feedbackgb.categories(id)`
  (`schema.sql:258`). **No new taxonomy table is needed.**
- `feedbackgb.feedback.assigned_to` already exists (added by
  `007_feedback_lifecycle.sql`), with:
  - a partial index (`feedback_assigned_idx`, non-null only),
  - a join into `feedback_feed` as `assigned_full_name`
    (`007_feedback_lifecycle.sql:60-61`),
  - a DB trigger (`audit_feedback()`) that automatically writes an
    `feedback.assign` audit row whenever `assigned_to` changes
    (`007_feedback_lifecycle.sql:100-116`).
  **No new assignee column is needed — reuse `assigned_to`.**
- `feedbackgb.users` has `role` (`seller | admin | super_admin`, widened
  by `009_pin_only_auth.sql:32-36`), `is_active` (`schema.sql:143`,
  indexed), and `store_id`. Currently seeded with 4 generic admin rows
  (`Адмін 1/2/3`, `Супер-адмін`) plus 23 per-store seller rows
  (`009_pin_only_auth.sql:253-273`) — real admin names will need to
  replace these placeholders before directions are meaningful, but that's
  an operator task, not part of this migration.
- Authorization is app-level only. RLS is enabled on `feedback`, `users`,
  `audit_log`, `categories` but **no policies exist** for anon/authenticated
  — the app always talks to Postgres as `service_role`
  (`schema.sql:587-589`, comment is explicit about this). All access
  control must be enforced in Next.js route handlers, via
  `requireAdminSession()` (`feedback-admin/src/lib/adminAuth.ts:20-27`),
  exactly like the existing PATCH endpoint does.
- `feedback-admin/src/app/api/admin/feedback/[id]/route.ts:118-131`
  already validates a manually-assigned admin: must exist, must be
  `isAdminTier(role)`, must be `is_active`. This is the pattern to reuse
  for validating rows in the new directions table.
- `feedback-app/src/app/api/feedback/route.ts` (POST, lines 82-201)
  already resolves `effectiveStoreId` server-side (lines 83-88) before
  building the `record` object that gets inserted (lines 162-181). This is
  the exact point to hook auto-assignment into.
- `feedback-admin/src/lib/audit.ts:10-22` — `AuditAction` is a **closed**
  TypeScript string-literal union. Any new audit action must be added to
  this type or the build fails.
- `shared/lib/session.ts` (single-sourced, shared between both apps) holds
  `isAdminTier` / `isSuperAdmin`. `supabase.ts` is **not** shared — each
  app (`feedback-app`, `feedback-admin`) has its own client instance per
  the project's drift-check convention. The auto-assignment resolver must
  live in `feedback-app` (it runs at creation time, in the seller app's
  API route), using `feedback-app`'s own Supabase client.
- Admin feed UI lives in
  `feedback-admin/src/app/(admin)/admin/admin-client.tsx`. Admin
  management UI lives in
  `feedback-admin/src/app/(admin)/admin/users/{page.tsx,users-client.tsx}`.

## Data model — one new table, zero changes to `feedback`

```sql
create table feedbackgb.admin_directions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references feedbackgb.users(id) on delete cascade,
  category    text not null references feedbackgb.categories(id),
  store_id    integer references categories.spots(spot_id), -- null = all stores
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index admin_directions_admin_idx
  on feedbackgb.admin_directions (admin_id)
  where is_active;

-- Exactly one active admin per (category, store-scope). No priority field
-- needed: the unique index makes the resolution deterministic by
-- construction instead of by a runtime tie-break rule.
create unique index admin_directions_scope_uidx
  on feedbackgb.admin_directions (category, coalesce(store_id, -1))
  where is_active;
```

Notes:

- `coalesce(store_id, -1)` sentinel is safe because `categories.spots.spot_id`
  is a positive serial PK (confirmed in schema — no negative/zero ids in use).
- RLS: enable it and add **no policies** (mirrors the existing
  `categories` table), since the app reaches Postgres as `service_role`
  from both apps. Do not add anon/authenticated policies — that would be
  new attack surface not present anywhere else in the schema.
- `admin_id` is not FK-constrained to `role in ('admin','super_admin')` at
  the DB level (Postgres can't express that without a trigger). Enforce it
  in the API layer, same as the existing `assigned_to` validation at
  `feedback-admin/src/app/api/admin/feedback/[id]/route.ts:118-131`.

## Resolution logic

```ts
// feedback-app/src/lib/assignment.ts (new file, feedback-app-local —
// mirrors the per-app supabase.ts drift convention)
export async function resolveAssignedAdmin(
  supabase: SupabaseClient,
  category: string,
  storeId: number | null,
): Promise<string | null> {
  const { data } = await supabase
    .from("admin_directions")
    .select("admin_id, store_id")
    .eq("category", category)
    .eq("is_active", true)
    .or(storeId != null ? `store_id.eq.${storeId},store_id.is.null` : "store_id.is.null")
    .order("store_id", { ascending: false, nullsFirst: false }) // exact store first
    .limit(1)
    .maybeSingle();
  return data?.admin_id ?? null;
}
```

Resolution order (deterministic, backed by the unique index, no
priority arithmetic):

1. Active row for `(category, store_id = effectiveStoreId)`.
2. Else active row for `(category, store_id is null)` — "all stores".
3. Else `null` — request stays unassigned, same as today.

## Backend work

1. **Migration** `015_admin_directions.sql`: create the table + indexes
   above, enable RLS with no policies.
2. **`feedback-app/src/lib/assignment.ts`**: `resolveAssignedAdmin()` as
   above.
3. **Wire into `feedback-app/src/app/api/feedback/route.ts`**: after line
   88 (`effectiveStoreId` resolved) and before building `record` (line
   162), call `resolveAssignedAdmin(supabase, category.id, effectiveStoreId)`
   and add `assigned_to: resolvedAdminId` to the `record` object at line
   162-181. The existing DB trigger logs `feedback.assign` automatically
   the moment the row is inserted with a non-null `assigned_to` — no new
   audit call needed here.
4. **CRUD endpoints** in `feedback-admin` (new
   `feedback-admin/src/app/api/admin/directions/route.ts` and
   `feedback-admin/src/app/api/admin/directions/[id]/route.ts`):
   ```text
   GET    /api/admin/directions            list all (super_admin only)
   POST   /api/admin/directions            create a rule
   PATCH  /api/admin/directions/[id]       edit / soft-delete (is_active=false)
   ```
   Every handler: `requireAdminSession("super_admin")` (regular admins do
   not manage directions — matches the existing tier split, e.g.
   `feedback-admin/src/app/(admin)/admin/users/page.tsx` gating pattern).
   On create/update, validate `admin_id` exactly like
   `feedback/[id]/route.ts:118-131` (`isAdminTier` + `is_active`), and
   surface the unique-index violation (Postgres error `23505`) as a 409
   with a clear message ("this category/store already has a responsible
   admin — edit or deactivate the existing rule first") rather than a raw
   500.
5. **No new endpoint for manual reassignment** — `PATCH
   /api/admin/feedback/[id]` already supports `assigned_to` and already
   validates + audits it. Reuse it as-is.
6. **Audit**: extend `AuditAction` in `feedback-admin/src/lib/audit.ts:10-22`
   with:
   ```text
   admin.direction.create
   admin.direction.update
   admin.direction.deactivate
   ```
   These cover *managing rules*. They do not duplicate `feedback.assign`,
   which the DB trigger already writes whenever a feedback row's
   `assigned_to` changes (auto at creation, or manual via the existing
   PATCH endpoint) — do not add a parallel `admin.assignment.auto` action,
   it would double-log the same fact.

## Admin UI work

- **`feedback-admin/src/app/(admin)/admin/users/users-client.tsx`**: add
  a "Напрямки" section to each admin's card — multi-row list of
  `{ category (select, from `feedbackgb.categories`), store scope
  (toggle: "Всі магазини" / pick one store), active }`. Editable only when
  viewer is `super_admin` (mirror the existing role gating already used
  on this page). Regular admins can view their own rules read-only.
- **`feedback-admin/src/app/(admin)/admin/admin-client.tsx`** (the main
  feed): **already done, no changes needed.** Verified during
  implementation (2026-07): the "Призначено" column
  (`admin-client.tsx:302-328`), the "— не призначено" filter option
  (`admin-client.tsx:224`), and the "Моя черга" toggle
  (`admin-client.tsx:120,179-183,448-460`) already exist, built alongside
  manual assignment in `007_feedback_lifecycle.sql`. They render whatever
  is in `assigned_to`/`assigned_full_name` regardless of whether it was
  set manually or by the new auto-assignment — nothing to build here.
- Feedback drawer/card: show "Відповідальний: {assigned_full_name}" +
  reassign control, calling the existing PATCH endpoint (already the
  case for status changes; extend to assignee if not already exposed
  there — verify current drawer component before assuming a new control
  is needed).

## Security rules

- Hiding the "Напрямки" UI from regular admins is not sufficient — every
  write endpoint enforces `requireAdminSession("super_admin")` server-side.
- `admin_directions` is `service_role`-only (no RLS policies), same
  posture as `categories`, `feedback`, `users`, `audit_log` today.
- `resolveAssignedAdmin` is a read-only lookup executed server-side inside
  the existing POST handler — never accepts a client-supplied assignee for
  auto-assignment (the client cannot influence `assigned_to` at creation
  time, same as it cannot influence `store_id` for sellers today, per
  `route.ts:83-88`).

## Non-goals / explicitly out of scope for this MVP

- **No backfill** of `assigned_to` on existing feedback rows. Auto
  assignment only applies to rows created after this ships. A backfill
  script is a separate, optional follow-up if needed later.
- **No priority/weighting/round-robin** between multiple admins for the
  same category — the unique index intentionally forces exactly one
  active responsible admin per (category, store-scope) so there is
  nothing to arbitrate at read time. If load-balancing across several
  admins per category is wanted later, that's a distinct feature built on
  top of this table, not part of this plan.
- **No new `admin_permission_codes` taxonomy** — categories are already
  the stable identifier (`feedbackgb.categories.id` / `CategoryId`);
  introducing a second parallel code space would only add drift risk.

## Implementation order

1. Migration `015_admin_directions.sql` (table, indexes, RLS enable).
2. `feedback-app/src/lib/assignment.ts` — `resolveAssignedAdmin()`.
3. Wire into `feedback-app/src/app/api/feedback/route.ts` POST.
4. "Відповідальний" column + "Мої заявки" / "Без відповідального" filters
   in `admin-client.tsx` (data already present via `feedback_feed`).
5. CRUD endpoints `/api/admin/directions*` in `feedback-admin`, gated
   `super_admin`.
6. "Напрямки" UI in `users-client.tsx`.
7. Extend `AuditAction` with the three `admin.direction.*` values; wire
   `logAudit()` calls into the CRUD endpoints.
8. Tests: category with no rule → `assigned_to` stays null; store-specific
   rule wins over "all stores" rule for the same category; deactivated
   rule is excluded from resolution; unique-index conflict on create
   returns 409, not 500; regular admin gets 403 on directions write
   endpoints.

## MVP scope

- `admin_directions` table + unique-scope index.
- `resolveAssignedAdmin()` wired into feedback creation.
- Reused `assigned_to` column, reused manual-reassignment endpoint.
- "Відповідальний" column + two filters in the admin feed.
- "Напрямки" management UI restricted to `super_admin`.
- Three new audit actions for rule management.

Everything above fits the existing schema and code paths with one
migration, one new small table, one new client-side lookup function, and
one new admin-only CRUD surface — no changes to `feedback`, no new
assignee column, no parallel permission taxonomy.
