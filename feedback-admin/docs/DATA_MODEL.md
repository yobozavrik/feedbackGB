# Дані-модель FeedbackGB

> Усі об'єкти живуть у схемі **`feedbackgb`** одного Postgres-кластера
> (Supabase). Зовнішні таблиці `categories.spots` (магазини) та
> `categories.products` (POS-каталог) надає ERP — ми лише посилаємося
> через FK і `SELECT`-only view.
>
> Розширення: `pgcrypto` (для `crypt`/`gen_salt`/`gen_random_uuid`),
> `pg_trgm` (trigram пошук), `vector` (pgvector).
>
> Основа: <code>supabase/schema.sql</code> + інкрементальні міграції
> `supabase/00*.sql`.

## ER-діаграма

```mermaid
erDiagram
    USERS ||--o{ FEEDBACK : "автор (user_id)"
    USERS ||--o{ FEEDBACK : "виконавець (assigned_to)"
    USERS ||--o{ FEEDBACK : "вирішив (resolved_by)"
    SPOTS ||--o{ FEEDBACK : "store_id (FK у ERP)"
    SPOTS ||--o{ USERS    : "store_id (для seller)"
    CATEGORIES ||--o{ FEEDBACK : "category"
    PRODUCTS  ||--o{ FEEDBACK  : "product_id (FK у ERP)"
    FEEDBACK ||--o| PHOTO_MIRROR : "1:1 (тільки якщо є фото)"
    FEEDBACK ||--o{ AUDIT_LOG    : "feedback_id"
    USERS    ||--o{ AUDIT_LOG    : "actor_user_id"

    USERS {
        uuid     id PK
        text     full_name
        text     pin_hash "bcrypt; NULL поки адмін не задасть"
        text     role "seller | admin"
        int      store_id FK "categories.spots.spot_id"
        bool     is_active
        int      failed_attempts
        timestamptz locked_until
        timestamptz last_login
        timestamptz created_at
    }
    CATEGORIES {
        text  id PK
        text  emoji
        text  title
        text  short
        smallint sort_order
    }
    FEEDBACK {
        uuid id PK
        timestamptz created_at
        timestamptz updated_at
        text  category FK
        int   store_id FK
        text  store_label
        uuid  user_id FK
        bigint product_id FK
        numeric quantity
        jsonb fields
        text  photo_url
        bigint tg_user_id
        text  tg_username
        text  tg_display_name
        bool  tg_verified
        text  summary
        vector embedding
        text  status
        timestamptz resolved_at
        uuid  resolved_by FK
        uuid  assigned_to FK
    }
    PHOTO_MIRROR {
        uuid feedback_id PK_FK
        text drive_file_id
        timestamptz mirrored_at
        text error
        int  attempts
        timestamptz last_attempt
    }
    AUDIT_LOG {
        bigserial id PK
        timestamptz occurred_at
        uuid feedback_id FK
        text action
        text actor
        uuid actor_user_id FK
        uuid target_user_id FK
        text target_type
        text ip
        text user_agent
        jsonb meta
        jsonb diff
    }
    SPOTS {
        int  spot_id PK
        text name
        text address
    }
    PRODUCTS {
        bigint id PK
        text   name
        text   unit
        text   barcode
        text   photo
        text   category_id FK
    }
```

(Джерело: [`diagrams/04-erd.mmd`](./diagrams/04-erd.mmd).)

---

## Таблиці

### `feedbackgb.categories` — довідник категорій

Дзеркало `src/lib/categories.ts`. Щоб analytics могли робити join і
показувати людський заголовок, не парсячи TS-код.

| Колонка | Тип | Примітки |
|---|---|---|
| `id` | text PK | `missing_item`, `overstock`, `defect`, `supply_problem`, `store_idea`, `spotted_elsewhere`, `tech_issue`, `customer_voice` |
| `emoji` | text | для UI/звітів |
| `title` | text | повний заголовок |
| `short` | text | 1-рядковий short-label |
| `sort_order` | smallint | порядок у списках |

Seed зашитий у `schema.sql` із `on conflict (id) do update`, тобто
оновлення категорій безпечно повторювати при міграції.

### `feedbackgb.users` — внутрішні користувачі

| Колонка | Тип | Призначення |
|---|---|---|
| `id` | uuid PK (default `gen_random_uuid()`) | стабільний ідентифікатор |
| `full_name` | text not null | відображається у picker-і логіну |
| `pin_hash` | text nullable | bcrypt (`pgcrypto.crypt`); NULL — адмін ще не задав |
| `store_id` | int FK `categories.spots(spot_id)` | для `seller` — обмежує store у формі; для `admin` — інформативне |
| `role` | text `seller`\|`admin` | `admin` отримує доступ до `/admin*` і `/api/admin/*` |
| `is_active` | bool | звільнений / зник → `false` |
| `created_at` | timestamptz | створення запису |
| `last_login` | timestamptz | оновлюється `verify_pin` при успіху |
| `failed_attempts` | int | лічильник підряд невдалих спроб |
| `locked_until` | timestamptz | автоматичне блокування на 1 годину після 10 промахів |

Індекси:

- `users_active_idx (is_active)` — для login picker view
- `users_role_idx (role)` — для swap-у admin-list

### `feedbackgb.feedback` — основна таблиця

Кожен рядок — один фідбек продавчині або адміна.

Ключові колонки:

| Колонка | Тип | Призначення |
|---|---|---|
| `id` | uuid PK | використовується у photo redirect URL (`/api/r/photo/<id>`) як capability-token |
| `created_at` / `updated_at` | timestamptz | trigger `feedback_set_updated_at` оновлює `updated_at` на UPDATE |
| `category` | text FK → `categories.id` | один з 8 |
| `store_id` | int FK → `categories.spots.spot_id` | nullable; для seller — підставляється з сесії |
| `store_label` | text | fallback (наприклад, "Інший магазин") коли `store_id` NULL |
| `user_id` | uuid FK → `users.id` | автор; nullable для legacy/анонімних |
| `product_id` | bigint FK → `categories.products.id` `on delete set null` | для `missing_item`/`overstock`/`defect` |
| `quantity` | numeric | поряд з `product_id` |
| `fields` | jsonb | per-категорійні extras (titles, quotes, what_broken тощо) — структура задана `categories.ts` |
| `photo_url` | text | або `sb:<storage-path>` (Supabase Storage), або `data:image/...;base64,...` (legacy fallback) |
| `tg_*` | mixed | Telegram identity, заповнюється при валідній `initData` |
| `summary` | text not null | людино-читабельний рядок (`buildSummary`), використовується аналітикою + trigram пошуком |
| `embedding` | vector(1536) | OpenAI `text-embedding-3-small`; nullable, заповнюється або вручну, або фоновим процесом |
| `status` | text | `new` / `in_progress` / `resolved` / `rejected` (CHECK). Перехід контролюється `PATCH /api/admin/feedback/{id}`. |
| `resolved_at` | timestamptz | виставляється при переході у `resolved`; обнуляється при поверненні назад. |
| `resolved_by` | uuid FK → `users.id` | хто перевів у `resolved`. |
| `assigned_to` | uuid FK → `users.id` `on delete set null` | поточний адмін-виконавець (007). Не плутати з `resolved_by`: assigned_to — хто **зараз** працює, resolved_by — хто **закрив**. |

Індекси:

- `feedback_created_at_idx (created_at desc)` — основна сортувальна
- `feedback_category_idx (category)` — фільтри за категорією
- `feedback_store_idx (store_id)` — для звіту
- `feedback_status_idx (status)` — для "застряглих" і aging-фільтрів
- `feedback_user_idx (user_id)` — для топ-авторів і аудиту
- `feedback_assigned_idx (assigned_to) where assigned_to is not null` — для "Моя черга" (007)
- `feedback_product_idx (product_id) where product_id is not null` — повтори
- `feedback_product_store_time_idx (store_id, product_id, created_at desc) where product_id is not null` — composite для дублів і повторів
- `feedback_summary_trgm_idx using gin (summary gin_trgm_ops)` — full-text пошук
- `feedback_embedding_ivf_idx using ivfflat (embedding vector_cosine_ops)` — ANN-пошук

Тригери:

- `feedback_set_updated_at` (BEFORE UPDATE) — туди-сюди `now()`.
- `audit_feedback_*` (AFTER INSERT/UPDATE/DELETE) — пише у `audit_log` з
  семантичним `action`-кодом і `diff`-діффом. Розрізняє три типи зміни:
  - `feedback.status_change` — коли зміна включає `status`.
  - `feedback.assign` — коли зміна торкнулась тільки `assigned_to`.
  - `feedback.update` — інші зміни (наприклад, `summary_changed`).

### `feedbackgb.photo_mirror` — стан резервного дзеркала

Файл: `supabase/004_photo_mirror.sql`. 1-до-1 з `feedback`.

| Колонка | Тип | Призначення |
|---|---|---|
| `feedback_id` | uuid PK FK → `feedback.id` cascade | один feedback ↔ один Drive-файл |
| `drive_file_id` | text | id у Google Drive після успішного uploadу |
| `mirrored_at` | timestamptz | NULL поки не змірорено; при успіху — час залиття |
| `error` | text | останнє повідомлення помилки (truncated до 500 char) |
| `attempts` | int | лічильник спроб; `>= 5` → cron skip |
| `last_attempt` | timestamptz | для діагностики; коли востаннє пробували |

Індекс: PK по `feedback_id` достатньо.

### `feedbackgb.audit_log` — журнал привілейованих дій

Базова версія у `schema.sql`, розширена у `006_audit_log_full.sql`.

| Колонка | Тип | Призначення |
|---|---|---|
| `id` | bigserial PK | хронологічний індекс |
| `occurred_at` | timestamptz | за замовчуванням `now()` |
| `feedback_id` | uuid FK → `feedback.id` cascade | nullable; для feedback-related дій |
| `action` | text | `auth.login.success` / `auth.login.failure` / `auth.logout` / `feedback.insert` / `feedback.update` / `feedback.status_change` / `feedback.assign` / `feedback.delete` / `admin.user.pin_reset` / `admin.user.unlock` / `admin.send_report` / `admin.mirror_to_drive` / `admin.feedback.note` |
| `actor` | text | або UUID, або рядок `service_role` |
| `actor_user_id` | uuid FK → `users.id` set null | хто зробив (нульовий для cron/service_role) |
| `target_user_id` | uuid FK → `users.id` set null | над ким (для admin actions, як-от `pin_reset`) |
| `target_type` | text | `feedback` / `user` / `system` |
| `ip` | inet | resolved через `x-forwarded-for` |
| `user_agent` | text | truncated |
| `meta` | jsonb | довільне для action-specific даних |
| `diff` | jsonb | для feedback-update — згенерований trigger-ом diff old vs new |

Індекси:

- `audit_log_feedback_idx (feedback_id, occurred_at desc)`
- `audit_log_occurred_at_idx (occurred_at desc)` — головний "scroll-back" в адмінці
- `audit_log_actor_user_idx (actor_user_id, occurred_at desc) where actor_user_id is not null`

---

## VIEW-и (читальні джерела для API і UI)

### `v_login_users`

Підкреслено-мінімальний набір для login-picker. Видає тільки активних
користувачів і **без `pin_hash`**.

```sql
select id, full_name, role, store_id
from feedbackgb.users
where is_active
order by full_name asc;
```

Використовується у `/api/auth/users` (Mini App login picker).

### `v_stores`

Магазини, доступні для UI. Джерело — `categories.spots` (ERP). Виключає
видалені (поле `is_deleted`).

Використовується у `/api/stores`.

### `v_products`

Каталог POS, придатний для product-picker.

```sql
select p.id, p.name, p.category_id, c.category_name,
       coalesce(c.sort_order, 9999) as category_sort,
       p.unit, p.barcode, p.photo, p.cost
from categories.products p
left join categories.categories c on c.category_id = p.category_id
where coalesce(c.category_hidden, 0) = 0;
```

API `/api/products` робить трохи додатково: префіксує `photo` через
`POSTER_CDN_BASE_URL`, рерайтить `null`-категорії у "Інше" і ставить
`(unit ?? 'шт')`.

### `v_popular_products`

7-денний топ товарів per-store, для chips "Часто питають" над product
picker.

```sql
select store_id, product_id,
       count(*)::int as uses_7d,
       max(created_at) as last_used_at
from feedbackgb.feedback
where created_at >= now() - interval '7 days'
  and product_id is not null
group by 1, 2;
```

### `feedback_feed`

Денормалізований view для адмін-таблиці і всього аналізу. Це **головне**
джерело для:

- `/api/feedback` GET (admin, JSON + CSV)
- `buildAndSendDailyReport` (єдиний SELECT за 8 днів)
- `mirrorPendingPhotos` (читає `id` + `photo_url`)

Включає всі поля з `feedback` плюс:

- `category_emoji`, `category_title` — JOIN на `categories`
- `store_name = coalesce(spots.name, store_label)` — fallback логіка
- `store_address` — для деталізованих звітів
- `user_full_name`, `user_role` — JOIN на `users` (автор)
- `assigned_full_name` — JOIN на `users` (виконавець; додано у `007_feedback_lifecycle.sql`)
- `product_name`, `product_unit` — JOIN на `categories.products`

Решта `view`-ів — на категорійні дашборди:

| View | Призначення |
|---|---|
| `v_feedback_missing_items` | вузький список missing_item з product/quantity |
| `v_feedback_overstock` | те саме для overstock |
| `v_feedback_defects` | defect (брак) |
| `v_feedback_supply` | supply_problem |
| `v_feedback_ideas_internal` | store_idea |
| `v_feedback_ideas_external` | spotted_elsewhere |
| `v_feedback_tech` | tech_issue |
| `v_feedback_customer_voice` | customer_voice |
| `v_audit_log` | людино-читабельні рядки `audit_log` (емодзі-секції, переклад actions) для UI `/admin/audit` |

---

## Функції (RPC)

### `verify_pin(p_user_id uuid, p_pin text) RETURNS feedbackgb.users`

`SECURITY DEFINER`. Викликається з `/api/auth/login`.

- Гvarду формат PIN-у: `^\d{4,8}$` (4-5 — legacy; API поверх вимагає 6+).
- Якщо `pin_hash` NULL або `is_active = false` — null (так само як wrong PIN).
- Якщо `locked_until > now()` — null (бекенд віддає 423/locked).
- При збігу bcrypt:
  - `last_login = now()`
  - `failed_attempts = 0`
  - `locked_until = null`
  - повертає user-row.
- При незбігу:
  - `failed_attempts += 1`
  - якщо тепер `>= 10` → `locked_until = now() + 1 hour`
  - повертає null.

### `set_user_pin(p_user_id uuid, p_pin text) RETURNS void`

`SECURITY DEFINER`, виконує тільки `service_role` (GRANT). Перевіряє,
що PIN ≥ 6 цифр, генерує bcrypt-hash і скидає `failed_attempts`,
`locked_until` атомарно. Викликається з `/api/admin/users/<id>/pin`.

### `set_updated_at()` — тригер для `feedback`

Тривіальний `BEFORE UPDATE`, виставляє `updated_at = now()`.

### `audit_feedback()` — тригер для `feedback`

`AFTER INSERT/UPDATE/DELETE`. Дивиться у `app.actor` (per-request
`set_config('app.actor', <user-uuid>, true)` від API), або у
`request.jwt.claims->>'sub'`, або `service_role`. Записує:

- INSERT → `feedback.insert` + повний `meta`.
- UPDATE з реальним diff-ом → один з трьох action-кодів:
  - `feedback.status_change` — якщо у diff-і присутнє `status` (мають
    пріоритет над іншими полями).
  - `feedback.assign` — якщо `status` не змінився, але змінився
    `assigned_to`.
  - `feedback.update` — решта (наприклад, `summary_changed`).
  Сам `diff` jsonb — `[old, new]` для кожного зміненого поля; для
  `summary` пишемо тільки `summary_changed: true`, бо повний текст
  зайвий у журналі.
- DELETE → `feedback.delete`.

Версія тригера, що розрізняє `feedback.assign`, прийшла з міграції
`007_feedback_lifecycle.sql`.

### `refresh_stats()`

Зарезервована (placeholder для майбутньої materialized view).

### `top_missing_items(...)`, `search_feedback_by_embedding(...)`

Аналітичні RPC-функції (поки не використовуються з UI). Документуються
тут для повноти, бо існують у схемі. Кандидати на майбутні /api/admin
ендпоінти.

---

## Storage (Supabase)

### Bucket `feedback-photos`

- Приватний (без публічного URL).
- Ліміт розміру файлу — 5 MB (UI стискає до ~1600px JPEG, ~150-300 KB).
- Дозволені MIME — `image/jpeg`, `image/png`, `image/webp`.
- Поточний path layout — плоский: `YYYY-MM-DD/<feedback-uuid>.<ext>`.
- Зберігається у `feedback.photo_url` як `sb:<path>` (префікс `sb:` —
  маркер "це Supabase Storage", не legacy `data:` чи зовнішній URL).
- Доступ — server-only через `service_role`. Ні `anon`, ні
  `authenticated` нічого не бачать.

Як читається на public-side:

1. Telegram-звіт містить лінки `/api/r/photo/<feedback-id>`.
2. При кліку route `src/app/api/r/photo/[id]/route.ts` мінтить
   `createSignedUrl(path, 600)` (10 хв TTL — досить, щоб бот або користувач
   почали скачування).
3. 302-redirect на signed URL. JWT не світиться у Telegram preview, бо
   у hover видно тільки `/api/r/photo/<uuid>`.

---

## Зовнішні таблиці (read-only)

> Ці таблиці належать ERP/POS системі. Ми тільки `SELECT`. Якщо потрібно
> створити їх локально для dev — є в `categories/*.sql` (поза цим репо).

### `categories.spots`

Магазини. Поля, що нас цікавлять:

- `spot_id` (int PK) — наш FK target.
- `name` (text) — для UI.
- `address` (text) — для деталізованого звіту.
- `is_deleted` (bool) — фільтруємо у `v_stores`.

### `categories.products`

POS-каталог. Поля:

- `id` (bigint PK) — наш FK target.
- `name`, `unit`, `barcode`, `photo`, `cost`.
- `category_id` → `categories.categories(category_id)`.

### `categories.categories`

Категорії товарів (НЕ наші 8 фідбек-категорій, а POS-категорії).
Поля: `category_id`, `category_name`, `sort_order`, `category_hidden`.

---

## Міграції

| Файл | Що додає |
|---|---|
| `supabase/schema.sql` | base — таблиці `categories`, `users`, `feedback`, `audit_log`, тригери, RPC, `v_login_users`, `feedback_feed` |
| `supabase/002_security_hardening.sql` | RLS-енейбл, ужорсточення політик, `verify_pin` як `SECURITY DEFINER` |
| `supabase/003_v1_priority_flow.sql` | v1 product/quantity flow → `feedback.product_id`, `feedback.quantity`; розширює `feedback_feed`; додає `v_products`, `v_popular_products` |
| `supabase/004_photo_mirror.sql` | таблиця `photo_mirror` (Drive backup state) |
| `supabase/005_per_category_views.sql` | категорійні `v_feedback_*` view-и для admin UI |
| `supabase/006_audit_log_full.sql` | розширення `audit_log` (actor_user_id, target_user_id, ip, user_agent, meta), `v_audit_log` |
| `supabase/007_feedback_lifecycle.sql` | `feedback.assigned_to` + `feedback_assigned_idx`; розширює `feedback_feed` (assigned_to, assigned_full_name); тригер `audit_feedback` починає писати `feedback.assign`. |

Apply порядок: завжди `schema.sql` → 002 → 003 → 004 → 005 → 006 → 007.
Усі ідемпотентні (`if not exists`, `or replace`, seed-and-update).
