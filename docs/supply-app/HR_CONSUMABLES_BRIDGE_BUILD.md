# Build-план моста: HR + розхідні матеріали в supply-app

Версия 1.0 · 2026-07-23 · статус: **к исполнению**

Это исполнительный план (файл за файлом, PR за PR). Дизайн и обоснования — в
[HR_CONSUMABLES_BRIDGE_PLAN.md](./HR_CONSUMABLES_BRIDGE_PLAN.md); границы —
в [ADR 0004](./ADR/0004-hr-and-consumables-reuse-feedback.md). Здесь — что
именно кодить, в каком порядке и как принимать, с учётом уже применённой
миграции.

---

## 0. Базовое состояние на старте

Подтверждено на живой БД (2026-07-23):

- ✅ `20260723_001_supply_employees.sql` применена: `verify_pin_for_app`,
  `feedback.facility_id`, `facilities.crm_warehouse_id`, усиленные constraints.
- 🟡 `20260723_002_supply_facilities_seed.sql` — готов, применяется super_admin
  (12 facilities). До сида вход не работает.
- ✅ Сессия supply уже несёт `facility_id`; `requireSupplyUser()` возвращает
  `facilityId`/`facilityName`.
- ❌ В supply-app **нет** ни одного маршрута моста, нет `shared/lib`-подключения.

Живые константы, на которые опирается план:

| Что | Значение |
|---|---|
| Склад-источник розхідних | `household_chemicals.warehouses.id = 37` (`shops.id = 31`) |
| `facilities.crm_location_id` | = `household_chemicals.shops.id` (text) |
| `facilities.crm_warehouse_id` | = `household_chemicals.warehouses.id` (int) |
| HR-хранение | `feedback.category='hr_question'`, тема в `fields->>'hr_topic'` |
| Категория розхідних | `feedback.category='consumables_request'`, `cart_items jsonb` |

Решения ADR 0004, которые план НЕ переоткрывает: HR и розхідні живут в
`feedback`; вызов CRM для розхідних — **синхронный**, до записи журнала;
идентичность supply-строки — `facility_id` (а `store_id` остаётся `NULL`).

---

## Фаза A. Общий фундамент (блокирует HR и розхідні)

Это по сути SUP-019 из плана исправлений — без него мост породит третью копию
валидации и каталога.

### A1. Включить `externalDir` и подключить `shared/lib`
- `supply-app/next.config.mjs`: `experimental: { externalDir: true }`.
- Проверить, что `tsconfig` alias `@/*` уже есть (есть).

### A2. Вынести в `shared/lib` то, что нужно мосту
Файлы, которые обе фичи переиспользуют (сейчас лежат только в feedback-app):
```
shared/lib/feedbackValidation.ts   (сейчас feedback-app/src/lib)
shared/lib/hrTopics.ts
shared/lib/consumablesCatalog.ts
shared/lib/consumablesOrder.ts
shared/lib/consumablesStatusMeta.ts
shared/lib/consumablesOrderError.ts
shared/lib/warehouseCrm.ts
shared/lib/feedbackStatusMeta.ts
```
`categories.ts`, `session.ts`, `rateLimit.ts`, `types.ts`, `validation.ts` уже
в `shared/lib`. В feedback-app оставить тонкие `export *`-стабы (как
`categories.ts`), сам код — в shared.

**Внимание:** `warehouseCrm.ts` и `feedbackValidation.ts` импортируют
`@/lib/...` — alias резолвится в компилирующем приложении, это ок для обоих.

### A3. Расширить drift-хук на три приложения
`scripts/check-shared-drift.sh`: матрица `файл × {feedback-app, feedback-admin, supply-app}`
с пометкой намеренно отсутствующих копий (в supply-app нет Telegram/PostHog).

**Критерии приёмки фазы A:**
- `npm run build` зелёный во всех трёх пакетах.
- `npm run test` в feedback-app зелёный (регресс seller-потока).
- Правка `shared/lib/feedbackValidation.ts` ломает pre-commit, пока не
  синхронизированы стабы.

---

## Фаза B. HR (внешних блокеров нет — делать первой)

### B1. Цели перевода (view + API)
Миграция `20260723_003_v_transfer_targets.sql`:
```sql
create or replace view feedbackgb.v_transfer_targets as
select 'store'::text as kind, s.id::text as id, s.name, true as is_active
  from feedbackgb.v_stores s
union all
select 'facility'::text, f.id::text, f.name, f.is_active
  from feedbackgb.facilities f
 where f.is_active;
grant select on feedbackgb.v_transfer_targets to service_role;
```
Роут `supply-app/src/app/api/transfer-targets/route.ts` (GET, за middleware).

### B2. Поле `target_facility_id` в валидации
`shared/lib/feedbackValidation.ts`, ветка `hr_topic === 'transfer'`:
- принять `target_facility_id` (uuid) **или** `target_store_id` (int);
- ровно одно из двух → иначе `400`;
- имя (`target_facility_name` / `target_store_name`) резолвит **сервер**, а не
  клиент (правило уже действует для магазинов).

Сервер (в POST-роуте, см. B4): если `target_facility_id` — прочитать
`facilities.name` по id, отклонить неизвестный/неактивный.

### B3. POST /api/feedback (supply-версия)
`supply-app/src/app/api/feedback/route.ts`. Отличия от seller-версии:
- сессия supply, не seller;
- `facility_id = session.facilityId`, `store_id = null`, `store_label = facilityName`;
- для `hr_question` фото (лікарняний) — тот же путь загрузки в приватный бакет;
- назначение админа: `resolveAssignedAdmin(supabase, 'hr_question', null)` →
  правило `store_id IS NULL` (см. B6);
- запись `audit_log.actor = uid` после вставки (как в seller-роуте).

### B4. UI: меню HR + 5 форм
Перенести из feedback-app в supply-app:
```
src/app/home/hr-menu/page.tsx
src/app/home/hr-menu/{vacation,day-off,sick-leave,resignation,transfer}/page.tsx
src/components/{HrDateRangeRequestForm,SickLeaveRequestForm,ResignationRequestForm,TransferRequestForm}.tsx
```
Формы используют shared-валидацию. В `TransferRequestForm` источник целей —
`/api/transfer-targets` (магазины + цехи/склады), поле `target_facility_id`.
Убрать seller-копирайт.

### B5. Self-service чтение своих заявок
5 роутов `src/app/api/hr/{topic}-requests/route.ts` — копии из feedback-app,
фильтр `user_id = session.uid`, `category='hr_question'`, `fields->>hr_topic`.

### B6. admin_directions для supply
Data-миграция/скрипт: активные строки `admin_directions (category='hr_question', store_id=NULL, admin_id=…)`,
иначе все HR-заявки цехов уйдут в `assigned_to = NULL`.

### B7. Админка: показать имя facility
`feedback_feed` даёт `store_name` из `store_id` (у supply — NULL). Добавить в
фид `location_name = coalesce(store_name, store_label)` и `location_kind`
(`store`/`facility`); фильтр «Цехи і склади».

**Критерии приёмки фазы B:**
- Работник цеха подаёт все 5 типов HR-заявок.
- Заявка: `store_id IS NULL`, `facility_id` = цех, `store_label` = имя цеха.
- Перевод с двумя целями (`target_store_id` + `target_facility_id`) → `400`.
- Подделанное `target_facility_name` в теле игнорируется, имя берётся из БД.
- Отпуск с датой начала < 7 дней → `400`.
- Заявка видна в админке с именем цеха и в «своих» у работника.

---

## Фаза C. Розхідні матеріали (нужен шаг CRM-команды)

### C0. CRM-функция (репозиторий CRM, вне supply-app)
`household_chemicals.rpc_create_feedbackgb_supply_consumables_order(
  p_feedback_id uuid, p_feedback_user_id uuid, p_crm_shop_id int,
  p_notes text, p_items jsonb) returns jsonb` — копия рабочей
`rpc_create_feedbackgb_consumables_order` с ЕДИНСТВЕННОЙ заменой резолва точки:
```sql
select id into v_shop_id from household_chemicals.shops
 where id = p_crm_shop_id and is_active = true;
```
Всё остальное — байт-в-байт: проверка дубля по `feedbackgb_order_contributions`,
`pg_advisory_xact_lock`, слияние в открытый `submitted`, `warehouse_id = 37`,
`source='feedbackgb'`. Гранты `execute` только `service_role`.

Причина: у цехов/складов `shops.poster_spot_id IS NULL`, а рабочая функция
резолвит точку именно по `poster_spot_id` → заказ цеха всегда падает
`FeedbackGB store is not mapped`. `p_crm_shop_id` — это `facilities.crm_location_id`.

Тесты CRM (до включения): двойной вызов с одним `p_feedback_id`, таймаут после
коммита, конкурентные вызовы одного цеха, неактивная точка.

**Важно (INTEGRATIONS.md):** этот мост НЕ подпадает под гейт ADR 0003 — он
идемпотентен по `feedback_id`. Гейт остаётся для `rpc_create_employee_order`,
`rpc_create_write_off_with_items`, `rpc_create_receipt_with_items`.

### C1. Каталог без хардкода склада
- `CONSUMABLES_WAREHOUSE_ID` из env (дефолт 37) — в `warehouseCrm`/каталоге.
- `supply-app/src/app/api/consumables/catalog/route.ts` — прокси
  `rpc_product_catalog(p_warehouse_id = env)`, за middleware.

### C2. Ветка `consumables_request` в POST /api/feedback (supply)
В `supply-app/src/app/api/feedback/route.ts`:
- валидация корзины через shared `feedbackValidation`;
- `crm_shop_id = facility.crm_location_id` (прочитать по `session.facilityId`);
  если `facility.crm_location_id IS NULL` → `400` c внятным текстом, ноль записей;
- вызвать `rpc_create_feedbackgb_supply_consumables_order` **до** вставки в `feedback`;
- `client_submission_id = feedback.id` (идемпотентность ретрая);
- CRM `503`/ошибка → в `feedback` ничего не пишем.

### C3. UI корзины
Перенести `ConsumablesCartForm`, `ConsumablesTabBar`, `QuantityStepper`,
`ProductPicker`, `PhotoInput` (что нужно). Точка входа —
`src/app/home/feedback/consumables_request/page.tsx`.

### C4. Экран успеха со стадией
`src/app/home/thanks/page.tsx` + `getConsumablesSuccessStage(feedbackId)` из
shared `consumablesOrder`.

**Критерии приёмки фазы C:**
- Заказ цеха → `orders.shop_id = facilities.crm_location_id`, `warehouse_id=37`, `source='feedbackgb'`.
- Повтор того же `feedback_id` → `duplicate:true`, число `orders` не растёт.
- Два цеха в смену → два разных заказа; один цех, две заявки → один заказ, суммы позиций сложены.
- `facility.crm_location_id IS NULL` → `400`, ноль строк в `feedback`.
- CRM `503` → в `feedback` ничего.

---

## Фаза D. Кабинет (после B и C)

`src/app/home/my-requests/page.tsx` (Активні/Архів), `[id]` с timeline,
`src/app/home/notifications/page.tsx` + колокольчик. Роуты `/api/my-feedback`,
`/api/notifications` — переносы из feedback-app. После этого вернуть в шапку
`home/page.tsx` иконки «Мої заявки»/«Сповіщення» (сейчас убраны, чтобы не 404).

---

## Порядок и оценки (человеко-дни, без ревью и ожидания CRM)

| Фаза | Задачи | Дни | Блокер |
|---|---|---|---|
| A. Shared | A1–A3 | 2 | — |
| B. HR | B1–B7 | 8 | A |
| C. Розхідні | C1–C4 | 6 | A + CRM C0 |
| D. Кабинет | — | 4.5 | B, C |

**Итого ~20.5 д** нашей части + работа CRM-команды (C0). HR (B) поставляется и
релизится независимо от CRM — поэтому идёт раньше.

---

## Тест-матрица (сводно)

**Юнит (vitest, node):** shared `feedbackValidation` — 5 HR-тем × граничные
даты, `transfer` с 0/1/2 целями, корзина (пустая, >100, дубль, дробные);
резолв facility (без `crm_location_id`, неактивна, чужая).

**Интеграционные (моки Supabase):** порядок «CRM раньше insert»; `503` ⇒
`insert` не вызван; `duplicate` ⇒ `200` без второго insert; `transfer` ⇒ сервер
перезаписывает `target_*_name`; аноним ⇒ `401` до БД.

**CRM (репозиторий CRM):** двойной вызов, таймаут после коммита, конкуренция,
неактивная точка.

**Ручной прогон staging:** работник цеха → 5 HR-заявок → заказ розхідних →
«Мої заявки» → статус после `confirm` на складе → уведомление админу; отдельно
полный регресс seller-потока в feedback-app.

---

## Что взять из плана исправлений параллельно

Мост опирается на незакрытые пункты REMEDIATION: **SUP-019** (shared) — это
фаза A выше; **SUP-007** (сетка главной) закрывается по мере появления
маршрутов — карточки «скоро» заменяются рабочими ссылками ровно тогда, когда
соответствующая страница появилась.
