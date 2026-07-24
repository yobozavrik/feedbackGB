# Supply App — модель даних

Схема відображає **застосовані** міграції `20260723_001` … `20260723_005`
(див. [RUNBOOK.md](./RUNBOOK.md)). Розширення потребують нової міграції та
оновлення цього документа в тому ж PR.

Скорочення:
- `PK` — первинний ключ;
- `FK` — зовнішній ключ;
- `RLS-only` — таблиця має `ENABLE + FORCE ROW LEVEL SECURITY` і жодної
  політики; доступ виключно через `service_role`.

---

## 1. Ключові сутності

```mermaid
erDiagram
  users ||--o{ user_app_access : "grants"
  users ||--o{ user_facility_memberships : "assigned to"
  facilities ||--o{ user_facility_memberships : "hosts"
  users ||--o{ feedback : "authors"
  facilities ||--o{ feedback : "on behalf of"
  feedback ||--o{ audit_log : "writes"
  feedback ||--o{ feedback_comments : "receives"
  feedback ||--o{ notifications : "triggers"
  users ||--o{ notifications : "receives"

  users {
    uuid id PK
    text full_name
    text display_label
    text role "seller · supply_worker · admin · super_admin"
    boolean is_active
    text pin_hash "bcrypt"
    timestamptz last_login
    timestamptz locked_until
    integer store_id "categories.spots.spot_id (sellers)"
  }

  facilities {
    uuid id PK
    text name
    text kind "production · warehouse"
    text crm_system
    text crm_location_id "household_chemicals.shops.id"
    integer crm_warehouse_id "household_chemicals.warehouses.id"
    boolean is_active
    timestamptz created_at
    timestamptz updated_at "touch_updated_at trigger"
  }

  user_app_access {
    uuid user_id PK,FK
    text app_key PK "seller_app · supply_app"
    boolean is_active
    uuid granted_by FK
    timestamptz granted_at
    timestamptz revoked_at "NOT NULL коли is_active=false"
  }

  user_facility_memberships {
    uuid user_id PK,FK
    uuid facility_id PK,FK
    text role "supply_worker · supply_manager · receiver · quality_controller"
    boolean is_active
    uuid granted_by FK
    timestamptz granted_at
    timestamptz revoked_at "NOT NULL коли is_active=false"
  }

  feedback {
    uuid id PK
    text category
    integer store_id "NULL для supply-рядків"
    text store_label "ім’я цеху/складу для supply"
    uuid facility_id FK "NULL для seller-рядків"
    uuid user_id FK
    jsonb fields
    jsonb cart_items "тільки consumables_request"
    text photo_url "sb:<path>"
    text summary
    text status "new · in_progress · resolved · rejected"
    uuid assigned_to FK
    uuid client_submission_id UK
    timestamptz client_created_at
    timestamptz created_at
    timestamptz updated_at
  }
```

**Правила ідентичності для supply-рядків у `feedback`:**

- `category ∈ { 'hr_question', 'consumables_request' }` (див.
  [ADR 0004](./ADR/0004-hr-and-consumables-reuse-feedback.md));
- `store_id` завжди `NULL`;
- `facility_id` — не `NULL`, вказує на `facilities`;
- `store_label` = ім’я facility (щоб існуючий `feedback_feed.store_name =
  COALESCE(spot.name, store_label)` показував правильну точку);
- `client_submission_id` = `feedback.id` для consumables (ідемпотентний ключ,
  збігається з `household_chemicals.feedbackgb_order_contributions.feedback_id`).

---

## 2. Мапінг facility → CRM

```mermaid
flowchart LR
  F["feedbackgb.facilities.id (uuid)"] -->|crm_location_id text| S["household_chemicals.shops.id (int)"]
  F -->|crm_warehouse_id int| W["household_chemicals.warehouses.id (int)"]
  S --> W
```

Дійсний seed (12 рядків, застосований міграцією `20260723_002`):

| kind | shops.id | назва |
|---|---|---|
| production | 25 | ЦЕХ "2 поверх" |
| production | 26 | ЦЕХ "Піцерія ГРАВІТОН" |
| production | 27 | ЦЕХ "Бульвар-Автовокзал" |
| production | 28 | ЦЕХ НІЧНА ЗМІНА "САДОВА" |
| production | 29 | ЦЕХ "Флорида" |
| production | 30 | ЦЕХ "Піцерія МІКРОРАЙОН" |
| warehouse | 31 | Склад витратних матеріалів (== `CONSUMABLES_WAREHOUSE_ID = 37`) |
| warehouse | 32 | Склад "Крафтова пекарня" |
| warehouse | 33 | Склад сировини "Трембіта" |
| warehouse | 34 | Склад "Кондитерка" |
| warehouse | 35 | Склад № 2 |
| warehouse | 36 | Склад "Запаси Анатолійовича" |

Свідомо **не** включені: shops.id `37 Списання ХЛІБА` (облікова корзина),
`38 Замовник` (віртуальна локація), `39 Щербанюка` (`warehouses.type='shop'`).

---

## 3. View-шар

```mermaid
flowchart LR
  V1["feedbackgb.v_supply_employees<br/>id · display_label · global_role · is_active · has_pin · has_supply_access"]
  V2["feedbackgb.v_transfer_targets<br/>kind ('store'|'facility') · id (text) · name · is_active"]
  V3["feedbackgb.feedback_feed<br/>+ facility_id · facility_name · location_kind"]

  T1["users"] --> V1
  T2["user_app_access"] --> V1
  T3["v_stores → categories.spots"] --> V2
  T4["facilities"] --> V2
  T4 --> V3
  T5["feedback"] --> V3
  T6["categories.spots"] --> V3
```

**Обмеження, зафіксоване у `20260723_004`:** нові колонки додаються винятково
в **кінець** SELECT — `CREATE OR REPLACE VIEW` заборонив
перейменування/пересортування існуючих колонок. Будь-яка правка порядку
потребує `DROP VIEW … CASCADE` + повторне надання ґрантів.

---

## 4. Ідемпотентність consumables

```mermaid
flowchart LR
  Client -->|"client_submission_id = feedback.id"| API
  API -->|"p_feedback_id = feedback.id"| RPC["household_chemicals.<br/>rpc_create_feedbackgb_supply_consumables_order"]
  RPC --> C["household_chemicals.feedbackgb_order_contributions<br/>(feedback_id FK)"]
  API --> F["feedbackgb.feedback (id UK · client_submission_id UK)"]
  C -. "duplicate → return original" .- RPC
  F -. "23505 · client_submission_id → return duplicate" .- API
```

Ретрай тієї самої заявки з тим самим `client_submission_id`:

1. RPC знаходить існуючий вклад у `feedbackgb_order_contributions` →
   повертає `duplicate: true`, того самого `order_id`, **не** створює
   другий документ у CRM.
2. Або `feedback.insert` кидає `23505` на `client_submission_id` →
   supply-роут повертає `{ ok: true, duplicate: true }`.

Обидві гілки не потребують компенсацій.

---

## 5. Права доступу

Всі supply-таблиці — `RLS-only` (політик немає навмисно):

```sql
alter table feedbackgb.facilities                enable + force row level security;
alter table feedbackgb.user_app_access           enable + force row level security;
alter table feedbackgb.user_facility_memberships enable + force row level security;
revoke all on <supply tables>, v_supply_employees from anon, authenticated;
grant  select, insert, update, delete on <supply tables>       to service_role;
grant  select on v_supply_employees, v_transfer_targets, feedback_feed to service_role;
```

Функції з `SECURITY DEFINER`:

- `feedbackgb.verify_pin_for_app(p_pin text, p_app_key text)` — виконується від
  власника, повертає `jsonb` з `id · full_name · display_label · role ·
  facility_id · facility_name`; **`update last_login`** робиться **тільки**
  після успішних перевірок app_access + membership (не оракул для чужих
  seller-акаунтів).
- `feedbackgb.set_user_pin(uuid, text)` — незмінна перевірка колізії
  6-значних PIN, ексклюзивно `service_role`.
- `household_chemicals.rpc_create_feedbackgb_supply_consumables_order(...)` —
  ексклюзивно `service_role`.
- `feedbackgb.check_rate_limit(p_key, p_limit, p_window_seconds)` — RPC
  ковзного вікна для supply/pin бакетів входу.

Клієнтські ролі `anon`, `authenticated` **не мають жодних ґрантів** на
supply-таблиці — перевіряється SQL-guard'ом у CI (див. RUNBOOK).
