# Supply App — робочі процеси

Всі діаграми в цьому документі відповідають **фактично реалізованим** flow
(епіки A–D моста, коммит `dd7ce47`). Стан-машини для контуру сировини
(замовлення сировини, брак, прихідні накладні) поки не імплементовані — див.
[ADR 0004](./ADR/0004-hr-and-consumables-reuse-feedback.md); коли вони
з’являться, буде розділ §7.

---

## 1. Вхід (app-scoped auth)

```mermaid
sequenceDiagram
  autonumber
  participant U as Працівник
  participant PP as PinPad (client)
  participant R as POST /api/auth/pin
  participant RL as check_rate_limit RPC
  participant Fn as verify_pin_for_app(p_pin, 'supply_app')
  participant Cookie as HttpOnly cookie<br/>supply_session

  U->>PP: 6 цифр
  PP->>R: {"pin":"NNNNNN"}
  R->>RL: supply:ip:<ip>
  R->>RL: supply:pin:<hmac(pin)>
  alt Rate limit
    RL-->>R: !ok
    R-->>PP: 429 · Retry-After
  else
    R->>Fn: SECURITY DEFINER
    alt PIN не збігся / не активний / без access / без membership
      Fn-->>R: null
      R-->>PP: 401 (нейтральний текст)
      Note over R: audit_log · auth.login.failure
    else успіх
      Fn-->>R: {id, full_name, display_label, role,<br/>facility_id, facility_name}
      Note over Fn: last_login оновлюється тільки тут
      R->>Cookie: set (12 год TTL)
      R-->>PP: 200
      Note over R: audit_log · auth.login.success
      PP->>PP: window.location = /home
    end
  end
```

**Гарантії, зафіксовані [SECURITY.md](./SECURITY.md):**

- Введення PIN продавця в supply-app **не міняє** `last_login`,
  `failed_attempts`, `locked_until` жертви — `verify_pin_for_app` виконує ці
  update тільки після перевірки `user_app_access` + `user_facility_memberships`.
- Відповідь 401 не відрізняється між «немає користувача», «немає доступу», «PIN
  неправильний» — щоб не витікала інформація про існування облікового запису.

---

## 2. Middleware guard

```mermaid
flowchart TB
  Req(("HTTP request")) --> M["src/middleware.ts"]
  M -->|"/, /api/auth/*, /api/health,<br/>/_next, /favicon.ico, /icons/*"| Next["→ handler"]
  M -->|"інше"| V{"verifySupplySession<br/>(cookie)?"}
  V -->|"ok"| Next
  V -->|"немає / бита"| Path{"/api/*"?}
  Path -->|"так"| J401["401 JSON<br/>{error: unauthenticated}"]
  Path -->|"ні"| Redirect["307 → /?next=<pathname><br/>+ Set-Cookie supply_session=; Max-Age=0"]
```

Роут-рівень захисту: **всі** `page.tsx` під `/home/*` викликають
`requireSupplyUser()`; всі API-роути — `getSupplyApiUser()`. Ці два хелпери
перечитують `is_active + user_app_access + memberships` з БД, а не довіряють
cookie на слово (cookie — лише підказка).

---

## 3. HR-заявка (5 тем)

### 3.1 Загальний lifecycle

```mermaid
stateDiagram-v2
  [*] --> Draft
  Draft --> Submitted : POST /api/feedback<br/>category=hr_question
  Submitted --> InProgress : admin коментує / бере в роботу
  Submitted --> Rejected : admin відхиляє
  InProgress --> Resolved : admin закриває
  InProgress --> Rejected
  Resolved --> [*]
  Rejected --> [*]
```

Значення `status` ідентичне seller-фідбеку (`new · in_progress · resolved ·
rejected`). Всі переходи виконує адмін через `feedback-admin`; supply-працівник
тільки створює й читає власні заявки.

### 3.2 Валідація по темах (shared/lib/feedbackValidation.ts)

| topic | обов’язкові поля | правила |
|---|---|---|
| `vacation` | `date_from`, `date_to` | `date_to ≥ date_from`; `date_from ≥ сьогодні + 7 днів` |
| `day-off` | `date_from`, `date_to` | те саме, що vacation |
| `sick-leave` | `date_from` | `date_to` необов’язковий; якщо є — `≥ date_from`; фото довідки в приватний bucket |
| `resignation` | `date_from` | `date_from ≥ сьогодні` (правило 2 тижнів — м'яке, тільки UI) |
| `transfer` | одне з `target_store_id` (int) **АБО** `target_facility_id` (uuid) | сервер резолвить `target_*_name` з БД; клієнтський label ігнорується |

Помилка → `400` з людським текстом, ніякої записи в `feedback`.

### 3.3 Sequence — переведення (гілка з facility)

```mermaid
sequenceDiagram
  autonumber
  participant UI as TransferForm
  participant TT as GET /api/transfer-targets
  participant P as POST /api/feedback
  participant Val as validateFeedbackPayload
  participant DB as feedbackgb.facilities
  participant IN as feedback.insert
  participant AS as resolveAssignedAdmin
  participant AU as audit_log update

  UI->>TT: fetch список
  TT-->>UI: [{kind:'facility'|'store', id, name}]
  UI->>P: {category:'hr_question', fields:{hr_topic:'transfer',<br/>target_facility_id: '<uuid>'}}
  P->>Val: перевірка правил
  Val-->>P: ok
  P->>DB: SELECT name WHERE id=? AND is_active
  DB-->>P: name
  Note over P: cleanFields.target_facility_name := name
  P->>AS: (category, store_id=null)
  AS-->>P: admin_id | null
  P->>IN: INSERT feedback (facility_id, store_label, assigned_to, ...)
  IN-->>P: {id}
  P->>AU: UPDATE audit_log SET actor=user.id WHERE feedback_id=<new>
  P-->>UI: 200 {ok:true}
```

---

## 4. Замовлення розхідних матеріалів

### 4.1 Стан на боці CRM (для працівника)

```mermaid
stateDiagram-v2
  [*] --> Accepted : після успішної RPC
  Accepted --> Picking : transfer створено на складі
  Picking --> Shipped : transfer completed
  Accepted --> Shipped : order.status='shipped' минаючи transfer
```

Джерело — `shared/lib/consumablesStatusMeta.ts` + `deriveStatus` у
`shared/lib/consumablesOrder.ts`. Labels: `Заявка прийнята → Збирається на
складі → Сформоване та відправлене`. Для працівника ці статуси відображаються
на `/home/my-requests/[id]` як 3-крокова timeline.

### 4.2 Створення заявки (з ідемпотентністю)

```mermaid
sequenceDiagram
  autonumber
  participant UI as ConsumablesCart
  participant P as POST /api/feedback<br/>category=consumables_request
  participant Val as validateFeedbackPayload
  participant Fac as feedbackgb.facilities<br/>SELECT crm_location_id
  participant RPC as household_chemicals.<br/>rpc_create_feedbackgb_supply_consumables_order
  participant Ord as household_chemicals.orders
  participant IN as feedbackgb.feedback INSERT

  UI->>P: {cart_items, client_submission_id (=UUID)}
  P->>Val: cart_items[] несе { product_id, quantity }
  Val-->>P: ok
  P->>Fac: id = session.facility_id
  Fac-->>P: crm_location_id (shops.id)
  alt Facility без crm_location_id
    P-->>UI: 400 "Твій цех/склад не має CRM-прив'язки"
    Note over P: feedback НЕ створюється
  else
    Note over P: feedback.id := client_submission_id
    P->>RPC: p_feedback_id · p_crm_shop_id · p_items
    RPC->>Ord: merge into open submitted<br/>advisory_xact_lock(shop_id)
    alt duplicate по feedback_id
      RPC-->>P: {success:true, duplicate:true, order_id}
    else помилка / неактивна точка
      RPC-->>P: {success:false, error:...}
      P-->>UI: 400/503 (classifyConsumablesCrmFailure)
      Note over P: feedback НЕ створюється
    else
      RPC-->>P: {success:true, order_id, order_number}
    end
    P->>IN: INSERT feedback (id, cart_items, ...)
    alt 23505 · client_submission_id вже існує
      IN-->>P: unique violation
      P-->>UI: 200 {ok, duplicate: true}
    else
      IN-->>P: {id}
      P-->>UI: 200 {ok, id}
    end
  end
```

**Гарантії:** порядок «CRM → feedback» означає, що користувач ніколи не бачить
успіх заявки, яку склад не прийняв. Ретрай з тим же `client_submission_id` не
створить другий документ ні в CRM, ні в journal.

---

## 5. Кабінет та сповіщення

```mermaid
sequenceDiagram
  autonumber
  participant U as /home/my-requests
  participant L as GET /api/my-feedback?limit=100
  participant DB as feedback_feed WHERE user_id=uid
  participant CO as getConsumablesSummaries<br/>(household_chemicals)
  participant D as /home/my-requests/[id]
  participant Det as GET /api/my-feedback/[id]
  participant CD as getConsumablesOrderDetail

  U->>L: fetch
  L->>DB: 20-100 останніх власних
  L->>CO: batch summary для consumables id[]
  CO-->>L: Map<feedback_id, {status, itemCount}>
  L-->>U: rows + item_count + consumables_status
  U->>D: клік по картці
  D->>Det: fetch(id)
  Det->>DB: SELECT * FROM feedback_feed WHERE id=?
  Det->>CD: якщо category=consumables_request
  CD-->>Det: {status, items, timeline}
  Det-->>D: {feedback, comments, consumables}
```

Уведомлення (`shared/lib/notifications.ts`):

```mermaid
sequenceDiagram
  autonumber
  participant Bell as NotificationsBell<br/>(polling 60s)
  participant N as GET /api/notifications?unread=1
  participant List as /home/notifications
  participant RA as POST /api/notifications/read-all
  participant R as POST /api/notifications/[id]/read

  Bell->>N: fetch(count)
  N-->>Bell: {unread_count}
  Bell-->>Bell: badge 1..9+ або приховати
  List->>N: fetch(full)
  List->>R: click item → mark read (optimistic)
  List->>RA: "Прочитати все"
```

---

## 6. Auto-assignment та адмін-фід

```mermaid
flowchart LR
  Post["POST /api/feedback"] --> RA["resolveAssignedAdmin(supabase, category, store_id=null)"]
  RA -->|exact match| A1["1 admin_id → assigned_to"]
  RA -->|none/ambiguous| A2["null → shows as unassigned in feed"]
  A1 --> Feed["feedback_feed"]
  A2 --> Feed
  Feed --> AdminUI["feedback-admin overview<br/>+ Segmented 🏪 Магазини / 🏭 Цехи і склади"]
```

Правила `admin_directions` для supply — рядки з `store_id IS NULL`. Якщо їх
немає, всі supply-заявки залишаються `assigned_to = null` (видно в фіді, але
не в «Моя черга» жодного адміна) — це поточна поведінка seller-flow.

---

## 7. Контур сировини (не реалізовано)

Плановані flow (замовлення сировини, брак, прихідні накладні) описані на
рівні state-машин у [SUPPLY_APP_IMPLEMENTATION_PLAN.md](../SUPPLY_APP_IMPLEMENTATION_PLAN.md).
Вони живуть **поза** таблицею `feedback` (за ADR 0004), у окремих
document-таблицях зі status_history, outbox та workers. Гейт по ADR 0003
(відсутність idempotency у CRM RPC) блокує імплементацію.

Схеми з’являться в цьому розділі одночасно з першою міграцією
`supply_requests` та її worker'ом.
