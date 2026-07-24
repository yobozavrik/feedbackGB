# Supply App — статус реалізації

Знімок стану на коммит **`dd7ce47`** (ветка `feature/hr-questions-menu`).
Оновлюється в тому ж PR, що змінює статус будь-якого пункту.

## Легенда

- ✅ реалізовано, вживу відповідає, покрито тестами/перевіркою
- 🟡 частково (сам файл є, але блокери в БД/CRM/UI)
- ⛔ навмисно поза цим релізом (див. посилання)

---

## 1. Міграції БД

| # | Файл | Що приносить | Стан |
|---|---|---|---|
| 001 | `supabase/migrations/20260723_001_supply_employees.sql` | supply_worker role, `facilities`, `user_app_access`, `user_facility_memberships`, `feedback.facility_id`, `crm_warehouse_id`, `touch_updated_at` trigger, `verify_pin_for_app`, RLS+revokes | ✅ applied |
| 002 | `..._002_supply_facilities_seed.sql` | 12 facilities (6 production + 6 warehouse) + шаблон тест-працівника | ✅ applied |
| 003 | `..._003_v_transfer_targets.sql` | `v_transfer_targets` union stores + facilities | ✅ applied |
| 004 | `..._004_feedback_feed_location.sql` | `feedback_feed.facility_id`, `facility_name`, `location_kind` (в кінець SELECT) | ✅ applied |
| 005 | `..._005_rpc_supply_consumables_order.sql` | `household_chemicals.rpc_create_feedbackgb_supply_consumables_order` | ✅ applied |

---

## 2. REMEDIATION_PLAN (30 пунктів)

| Група | Пункти | Стан |
|---|---|---|
| A. Безпека 1–6 | app-scoped auth, middleware, security headers, safety of `verify_pin` side effects, session-secret single source, `/` redirect | ✅ 1–6 |
| B. Функціональні 7–11 | грід, копірайт, logout 303, `auth.logout` audit, чесний `/home/supply` | ✅ 7–11 |
| C. Стилі 12–17 | `elev2`, `fade-up`, `next/font`, viewport/`noindex`, `not-found/error/loading`, PinPad a11y | ✅ 12–17 |
| D. Код 18–26 | видалити `PinLogin`, `shared/lib` + `externalDir` + drift, vitest, ESLint, actor формат, IP валідація, `.env.example`, форматування, README/migrations | ✅ 18–24 · 25 (formatter) — прогнати prettier · 26 (README сирці) — оновлено docs, kорневий README supply ще не згадує |
| E. Міграція 27–30 | RLS явно, `updated_at` triggers, ужорсточений check, `assertSupplySchema` | ✅ 27–30 |

Реф: [REMEDIATION_PLAN.md](./REMEDIATION_PLAN.md).

---

## 3. HR + розхідні мост (епіки A–D)

### A · Shared foundation

| ID | Що | Стан |
|---|---|---|
| A1 | `experimental.externalDir` у supply-app | ✅ |
| A2 | Винесено в `shared/lib`: `hrTopics`, `feedbackValidation`, `assignment`, `consumablesCatalog`, `consumablesOrder`, `consumablesStatusMeta`, `consumablesOrderError` | ✅ |
| A3 | `scripts/check-shared-drift.sh` розширено: `COPY_FILES` + `PURE_SHARED_FILES` + окрема перевірка `warehouseCrm.ts` між supply-app і feedback-app | ✅ |

### B · HR

| ID | Що | Стан |
|---|---|---|
| B1 | `v_transfer_targets` + `GET /api/transfer-targets` | ✅ |
| B2 | `target_facility_id` у shared валідації (interface XOR store/facility) | ✅ |
| B3 | supply `POST /api/feedback` (hr_question, з резолвом facility name на сервері) | ✅ |
| B4 | 5 форм: DateRangeForm × 2 (vacation, day-off), SickLeave, Resignation, Transfer + меню + thanks | ✅ |
| B5 | 5 GET-роутів `/api/hr/{topic}-requests` + `MyHrList` компонент на кожній сторінці | ✅ |
| B6 | `resolveAssignedAdmin` в shared + виклик у supply POST | ✅ (створення пропозицій — на super_admin через `admin_directions`) |
| B7 | `feedback_feed` + `location_kind` (міграція 004) + фільтр Segmented "🏪 Магазини / 🏭 Цехи і склади" у `feedback-admin/(admin)/admin/admin-client.tsx` + іконка типу в колонці «Точка» | ✅ |

### C · Розхідні матеріали

| ID | Що | Стан |
|---|---|---|
| C0 | CRM RPC `rpc_create_feedbackgb_supply_consumables_order` (міграція 005) | ✅ |
| C1 | `CONSUMABLES_WAREHOUSE_ID` env-змінна в обох каталогах | ✅ |
| C2 | `GET /api/consumables/catalog` у supply | ✅ |
| C3 | Ветка `consumables_request` у supply `POST /api/feedback` (CRM raніше insert, ідемпотентність по `feedback.id`) | ✅ |
| C4 | UI: `ConsumablesCart` (пошук + пагінація + кошик + коментар) + сторінка `/home/feedback/consumables_request` | ✅ |
| C5 | Екран `/home/thanks` (проста версія; повний timeline — на детальній сторінці замовлення в кабінеті) | ✅ |

### D · Кабінет

| ID | Що | Стан |
|---|---|---|
| D1 | 5 роутів: `/api/my-feedback`, `/api/my-feedback/[id]`, `/api/notifications`, `/api/notifications/[id]/read`, `/api/notifications/read-all` | ✅ |
| D2 | `/home/my-requests` (Активні/Архів), `/home/my-requests/[id]` з timeline consumables, `/home/notifications`, `NotificationsBell` в шапці головної (polling 60s) | ✅ |

---

## 4. Свідомо поза релізом

| Що | Причина | Реф |
|---|---|---|
| Сирьєві document-таблиці (`supply_requests`, `raw_material_defects`, `incoming_documents`) + outbox worker | ADR 0003: CRM без idempotency key для `rpc_create_employee_order`, `rpc_create_write_off_with_items`, `rpc_create_receipt_with_items` | [ADR 0003](./ADR/0003-outbox-after-live-audit.md) |
| Заявка на ремонт (маршрут `tech_issue` під supply) | Не входить у мост; лишається карткою «скоро» | grid `SupplyHomeGrid.tsx` |
| Telegram-бот на боці supply-працівника | Не в скоупі MVP; Telegram Mini App embedding готовий (CSP frame-ancestors) | [ADR 0001](./ADR/0001-two-channel-app.md) |
| Google Drive mirror для supply | Cron живе в feedback-app і вже забирає весь bucket `feedback-photos`; окремої логіки не потрібно | shared `driveMirror.ts` |

---

## 5. Історія коммитів (мост)

| Коммит | Що |
|---|---|
| `028344d` | Auth remediation + Фаза A (shared foundation) + Фаза B core (HR) |
| `18ba9af` | HR remainder: `MyHrList`, авто-роутинг через `resolveAssignedAdmin`, migration 004 |
| `c561c1e` | Фаза C: розхідні матеріали bridge (shared consumables, migration 005, UI кошика) |
| `6ca62e9` | Fix: migration 004 — переставити нові колонки в кінець `feedback_feed` |
| `dd7ce47` | Фаза D (кабінет: мої заявки, деталі, сповіщення) + B7 (адмін-фільтр) |
| _цей коммит_ | Документація зафіксована по факту |

---

## 6. Що робити далі

1. **Прибрати grid card «скоро» для tech_issue** (або реалізувати запит).
2. **Пункт SUP-026 у кореневому README**: додати абзац про supply-app.
3. **Активувати правила `admin_directions`** для `hr_question` та
   `consumables_request` (супер-адмін вставляє рядки — див.
   [RUNBOOK](./RUNBOOK.md) §3).
4. **Розпочати сирьєвий контур** — вимагає ADR 0003 resolution з боку
   CRM-команди.
