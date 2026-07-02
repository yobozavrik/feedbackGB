# HR Questions Feature Implementation Plan

## Goal

Add a new seller Web App button:

```text
Питання по HR
```

Inside it, show four choices:

```text
Хочу у відпустку
Треба вихідний
Хочу звільнитись
Лікарняний
```

Each choice creates a normal feedback/request row and must appear in the admin panel with category, subtype, status, store, seller, details, comments, assignee, audit, and future notification support.

## Recommended Model

Use one feedback category:

```text
category = hr_question
```

Store the inner button as a structured field:

```text
fields.hr_topic = vacation | day_off | resignation | sick_leave
```

Do not create four separate top-level categories unless reporting later proves that HR topics must behave as completely independent categories.

Why one category is better:

- Admin filtering can show all HR requests together.
- Responsibilities can assign one HR admin to all HR topics or split by `hr_topic` later.
- The Web App can have a clean nested menu.
- The feedback schema does not need a new table.
- Existing admin feed already renders category + fields.

## User-Facing Labels

Use stable machine codes and Ukrainian labels.

```ts
const HR_TOPICS = [
  {
    id: "vacation",
    title: "Хочу у відпустку",
    short: "Планова відпустка або кілька днів",
  },
  {
    id: "day_off",
    title: "Треба вихідний",
    short: "Один вихідний або зміна графіка",
  },
  {
    id: "resignation",
    title: "Хочу звільнитись",
    short: "Заява або розмова про звільнення",
  },
  {
    id: "sick_leave",
    title: "Лікарняний",
    short: "Хвороба, довідка, лікарняний період",
  },
];
```

## Existing Code Context

Current category source of truth:

```text
shared/lib/categories.ts
```

Both apps re-export it:

```text
feedback-app/src/lib/categories.ts
feedback-admin/src/lib/categories.ts
```

Current Web App home grid:

```text
feedback-app/src/components/CategoryGrid.tsx
```

Current product nested menu pattern:

```text
feedback-app/src/app/(app)/products-menu/page.tsx
```

Current dynamic feedback page:

```text
feedback-app/src/app/(app)/feedback/[category]/page.tsx
```

Current seller submit API:

```text
feedback-app/src/app/api/feedback/route.ts
```

Current payload validation:

```text
feedback-app/src/lib/feedbackValidation.ts
```

Current admin feedback UI:

```text
feedback-admin/src/app/(admin)/admin/page.tsx
feedback-admin/src/app/(admin)/admin/admin-client.tsx
feedback-admin/src/components/admin/feed/FeedDrawer.tsx
feedback-admin/src/lib/feedFormat.ts
```

Current schema/migrations:

```text
feedback-admin/supabase/schema.sql
feedback-admin/supabase/00*.sql
```

Current docs to update:

```text
feedback-admin/docs/DATA_MODEL.md
feedback-admin/docs/FEATURES.md
feedback-admin/docs/ARCHITECTURE.md
```

## Data Shape

Example submitted payload:

```json
{
  "category": "hr_question",
  "store_id": 18,
  "fields": {
    "hr_topic": "vacation",
    "preferred_dates": "2026-07-20 - 2026-07-25",
    "comment": "Планую сімейну поїздку"
  },
  "client_submission_id": "...",
  "client_created_at": "..."
}
```

Example DB row:

```text
feedback.category = hr_question
feedback.status = new
feedback.fields.hr_topic = vacation
feedback.summary = Питання по HR / Хочу у відпустку ...
```

## Step 1: Add HR Category To Shared Category Source

File:

```text
shared/lib/categories.ts
```

Changes:

1. Add `hr_question` to `CategoryId`.
2. Add `hr` to `Category.tint` union, or reuse an existing tint if avoiding CSS changes.
3. Add category object:

```ts
{
  id: "hr_question",
  emoji: "🧑‍💼",
  title: "Питання по HR",
  short: "Відпустка, вихідний, звільнення, лікарняний",
  description: "Оберіть HR-питання та залиште деталі для відповідального адміністратора.",
  gradient: "bg-cat-hr/40",
  accent: "text-brand-600",
  tint: "hr",
  priority: true,
  fields: [
    {
      id: "hr_topic",
      label: "Тип питання",
      kind: "text",
      required: true,
    },
    {
      id: "preferred_dates",
      label: "Бажані дати / період",
      placeholder: "Наприклад: 20.07-25.07 або наступна пʼятниця",
      kind: "text",
    },
    {
      id: "comment",
      label: "Коментар",
      placeholder: "Опишіть деталі",
      kind: "textarea",
    },
    {
      id: "photo",
      label: "Фото документа (за потреби)",
      kind: "photo",
    },
  ],
}
```

Important:

- The current form system supports `text`, `textarea`, `number`, and `photo`.
- There is no `select` field kind yet.
- Therefore MVP should pass `hr_topic` from the nested HR menu into the existing text field, not add a generic select system immediately.

## Step 2: Add HR Menu Page In Web App

Add page:

```text
feedback-app/src/app/(app)/hr-menu/page.tsx
```

Behavior:

- Shows header: `Питання по HR`.
- Shows four large cards.
- Each card opens the `hr_question` feedback form with selected topic.

Recommended URL:

```text
/feedback/hr_question?topic=vacation
/feedback/hr_question?topic=day_off
/feedback/hr_question?topic=resignation
/feedback/hr_question?topic=sick_leave
```

Reason:

- Keeps one dynamic feedback page.
- Keeps topic visible in URL for refresh/back navigation.
- Avoids four duplicated category pages.

## Step 3: Add HR Button To Home Screen

File:

```text
feedback-app/src/components/CategoryGrid.tsx
```

Current primary cards:

```text
1. Продукція магазину
2. Заявка на ремонт
3. Заявка на розхідні матеріали
4. Secondary grid
```

Add new primary card:

```text
Питання по HR
```

Recommended placement:

```text
after Заявка на розхідні матеріали
before secondary categories
```

Track analytics:

```ts
track("home_category_open", {
  category: "hr_question",
  section: "priority",
});
```

## Step 4: Pre-Fill HR Topic In Feedback Form

Files to inspect and modify:

```text
feedback-app/src/app/(app)/feedback/[category]/page.tsx
feedback-app/src/components/FeedbackForm.tsx
```

Required behavior:

- Read `searchParams.topic`.
- Validate it is one of:

```text
vacation
day_off
resignation
sick_leave
```

- Pass it into the form.
- Form submits:

```text
fields.hr_topic = selected topic id
```

UI behavior:

- Show selected topic label at the top of the form.
- Do not force seller to type the topic again.
- Allow seller to add dates/comment/photo.

If current `FeedbackForm` cannot accept initial fields:

- Add prop:

```ts
initialFields?: Record<string, string | number | null>
```

- Merge `initialFields` into submitted `fields`.

## Step 5: Validate HR Topic Server-Side

File:

```text
feedback-app/src/lib/feedbackValidation.ts
```

Add category-specific validation:

```text
if category.id === "hr_question":
  fields.hr_topic must be one of allowed HR topics
```

Reasons:

- URL/query params can be manipulated.
- UI-only validation is not enough.
- Admin reporting depends on clean subtype values.

Error:

```text
Invalid HR topic
```

Do not accept arbitrary HR topic strings.

## Step 6: Update Summary Formatting

File:

```text
shared/lib/summary.ts
```

Goal:

- Admin feed and reports should show friendly HR labels, not raw `vacation`.

Example summary:

```text
Питання по HR: Хочу у відпустку
Бажані дати: 20.07-25.07
Коментар: Планую сімейну поїздку
```

Add mapping:

```ts
vacation -> Хочу у відпустку
day_off -> Треба вихідний
resignation -> Хочу звільнитись
sick_leave -> Лікарняний
```

Keep raw codes in DB fields. Only display labels should be translated.

## Step 7: Update Offline Queue Labels

File:

```text
feedback-app/src/components/OfflineQueueBanner.tsx
```

Add:

```text
hr_question -> Питання по HR
emoji -> 🧑‍💼 or 👥
```

If `hr_topic` is available in queued fields, show:

```text
Питання по HR / Хочу у відпустку
```

MVP can show only category-level label.

## Step 8: Update Admin Category Formatting

Files:

```text
feedback-admin/src/lib/feedFormat.ts
feedback-admin/src/components/admin/feed/FeedDrawer.tsx
```

Add HR tint:

```ts
hr: "green"
```

In drawer details:

- Current drawer renders raw field keys and values.
- MVP can keep that.
- Better version maps:

```text
hr_topic -> Тип питання
preferred_dates -> Бажані дати / період
comment -> Коментар
```

And maps topic code to label.

Recommended improvement:

- Add shared field label helper later.
- For MVP, add small local mapping in `FeedDrawer`.

## Step 9: Update Admin Filters / Reports

Admin feed already receives `category`, `category_title`, `category_emoji` from `feedback_feed`.

Need to verify:

- `feedbackgb.categories` has the new row.
- `feedback_feed` joins category title/emoji from DB.
- Admin category filters pick it up automatically.

If filters are built from live rows, no UI change needed.

If there are hardcoded category lists, add `hr_question`.

Search targets:

```text
rg "tech_issue|consumables_request|defect|missing_item|overstock|category" feedback-admin/src
```

## Step 10: DB Migration

Create migration:

```text
feedback-admin/supabase/010_hr_question_category.sql
```

or next available migration number if `010` is already used.

Migration should insert/update category row:

```sql
insert into feedbackgb.categories
  (id, emoji, title, description, is_active)
values
  (
    'hr_question',
    '👥',
    'Питання по HR',
    'Відпустка, вихідний, звільнення, лікарняний',
    true
  )
on conflict (id) do update
set emoji = excluded.emoji,
    title = excluded.title,
    description = excluded.description,
    is_active = true;
```

Also update:

```text
feedback-admin/supabase/schema.sql
feedback-app/supabase/schema.sql
```

only if this repo keeps full schema snapshots in sync.

## Step 11: Admin Responsibilities Integration

Future plan already exists:

```text
feedback-admin/docs/ADMIN_RESPONSIBILITIES_PLAN.md
```

For HR, responsibilities should support:

```text
permission_code = hr_question
```

or more detailed:

```text
hr_question.vacation
hr_question.day_off
hr_question.resignation
hr_question.sick_leave
```

Recommended MVP:

```text
permission_code = hr_question
```

Assign one HR responsible admin to all HR requests.

Recommended later:

```text
permission_code = hr_question.<topic>
```

Then different admins can own vacation, sick leave, resignation, etc.

Auto-assignment rule:

```text
category = hr_question
topic = vacation
-> permission_code = hr_question.vacation
-> fallback permission_code = hr_question
```

## Step 12: In-App Notifications Integration

Future plan already exists:

```text
feedback-admin/docs/IN_APP_NOTIFICATIONS_PLAN.md
```

When HR request is created and assigned:

```text
type = feedback.assigned_to_admin
title = Нове питання по HR
body = Магазин <store> створив заявку: <topic label>
```

When admin changes status from `new` to `in_progress`:

```text
type = feedback.status_in_progress_for_seller
title = HR-заявку взято в роботу
body = Ваше питання по HR прийняли та взяли в роботу.
```

Do not block HR feature on notifications if notifications are not implemented yet.

## Step 13: Daily Report / Telegram Report

File:

```text
shared/lib/dailyReport.ts
```

Check if category lists are hardcoded.

Known hardcoded areas:

- category emoji map;
- operational categories;
- report sections.

Need to decide whether HR belongs in operational daily report.

Recommendation:

- Include HR requests in total feedback count.
- Do not include HR details in public/shared Telegram operational report unless HR privacy is acceptable.
- If daily report goes to broad group, HR should be summarized only:

```text
HR-питання: 3 нові
```

not full details.

This is important because HR topics can be sensitive.

## Step 14: Privacy And Access

HR requests are more sensitive than product/repair requests.

Recommended access rule:

- Super admin can see all HR requests.
- Assigned HR admin can see assigned HR requests.
- Other admins should not see HR details unless explicitly allowed.

MVP risk:

- Current admin feed likely shows all feedback rows to all admins.

Decision needed before implementation:

```text
Should ordinary admins see HR requests?
```

Recommended answer:

```text
No. Hide HR requests from ordinary admins unless they are assigned or have HR permission.
```

This requires backend filtering in admin feed APIs/server components, not only UI hiding.

If implementing privacy in MVP is too large:

- Add HR category but do not collect sensitive free text yet.
- Or make HR visible only after permission filtering is implemented.

## Step 15: Tests

### Shared Category Tests

Add or update tests to verify:

- `hr_question` exists in `CATEGORIES`.
- `getCategory("hr_question")` works.
- `getPriorityCategories()` includes HR if it is a primary card.

### Validation Tests

Add tests in:

```text
feedback-app/src/lib/__tests__/feedback-route.test.ts
```

or a dedicated validation test file.

Cases:

- accepts `hr_question` with valid `hr_topic`;
- rejects unknown `hr_topic`;
- rejects missing required `hr_topic`;
- accepts optional dates/comment/photo;
- keeps normal categories unaffected.

### Web App Manual QA

Check:

1. Home screen shows `Питання по HR`.
2. Tapping it opens HR menu.
3. Each of four buttons opens form with correct selected topic.
4. Submit creates feedback.
5. Offline queue still works.
6. Back navigation works.
7. Text fits on mobile.

### Admin Manual QA

Check:

1. HR request appears in feed.
2. Category label and emoji are correct.
3. Drawer shows HR topic label.
4. Status can change.
5. Assignee can change.
6. Comments work.
7. Filters/search include HR category.

### DB QA

Run after migration:

```sql
select id, title, emoji, is_active
from feedbackgb.categories
where id = 'hr_question';
```

Create one request and verify:

```sql
select category, status, fields, summary
from feedbackgb.feedback
where category = 'hr_question'
order by created_at desc
limit 5;
```

## Implementation Order

1. Add DB category migration.
2. Add `hr_question` to `shared/lib/categories.ts`.
3. Add HR topic constants/helper in shared code.
4. Add server-side validation for `fields.hr_topic`.
5. Add HR menu page in Web App.
6. Add HR card to home screen.
7. Pre-fill/submit `hr_topic` from URL topic.
8. Update summary formatting.
9. Update offline queue labels.
10. Update admin category/tint formatting.
11. Update admin drawer field labels for HR.
12. Update daily report handling with privacy decision.
13. Add tests.
14. Run typecheck/tests.
15. Manual QA on mobile viewport and admin panel.

## MVP Acceptance Criteria

MVP is complete when:

1. Seller sees `Питання по HR` on the home screen.
2. Seller sees four inner buttons.
3. Each button creates a `hr_question` request with correct `fields.hr_topic`.
4. API rejects invalid HR topic.
5. Admin panel shows the HR request with readable category and topic.
6. Admin can change status and assignee.
7. Existing product/repair/consumables flows still work.
8. Typecheck and relevant tests pass.

## Open Product Decision Before Coding

The main decision:

```text
Who can see HR requests in admin panel?
```

Recommended:

```text
Only super_admin and assigned HR admins.
```

If this is approved, HR feature should be implemented together with backend filtering/permissions for HR rows.

If not approved, HR requests will be visible to all current admins, which is simpler but risky because resignation/sick leave data can be sensitive.
