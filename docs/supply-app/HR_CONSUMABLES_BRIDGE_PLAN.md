# План: подключение supply-app к HR и «Замовлення розхідних матеріалів»

Дата: 2026-07-23. Основано на живом чтении схем `feedbackgb`, `categories`,
`household_chemicals` (только SELECT, без записей) и на коде `feedback-app`.

---

## 0. Краткий вывод

**HR** переносится почти целиком: это чистый FeedbackGB-поток без CRM.
Единственная реальная доработка — список целей для темы «переведення», потому
что он сейчас строится из `feedbackgb.v_stores`, где цехов нет.

**Розхідні матеріали** переносятся **не** «как есть»: живая CRM-функция
`rpc_create_feedbackgb_consumables_order` резолвит точку через
`shops.poster_spot_id = p_feedback_store_id`, а у всех цехов и складов в
`household_chemicals.shops` поле `poster_spot_id IS NULL`. Для supply нужен
новый вход в CRM (одна функция-сестра), иначе любой заказ цеха вернёт
`FeedbackGB store is not mapped to a CRM shop`.

Обе фичи блокируются задачами 1–3 из плана исправлений: сессия supply сейчас
не несёт ни facility, ни проверки `user_app_access`, а без этого некуда
привязать заявку.

---

## 1. Что именно есть в проде сегодня (факты, не предположения)

### 1.1 HR

| Слой | Файл / объект | Суть |
|---|---|---|
| Темы | `feedback-app/src/lib/hrTopics.ts` | 5 тем: `vacation`, `day-off`, `sick-leave`, `resignation`, `transfer` |
| Хранение | `feedbackgb.feedback` | `category = 'hr_question'`, тема в `fields->>'hr_topic'` |
| Валидация | `feedback-app/src/lib/feedbackValidation.ts` | ≥7 дней предупреждения для `vacation`/`day-off`; `date_to` опционален для `sick-leave`; дата увольнения не в прошлом; `target_store_id` обязателен для `transfer` |
| Приём | `POST /api/feedback` | общая ручка на все категории |
| Чтение | `GET /api/hr/{vacation,day-off,sick-leave,resignation,transfer}-requests` | свои заявки, фильтр `user_id` + `category` + `fields->>hr_topic`, limit 20 |
| UI | `(app)/hr-menu/page.tsx` + 5 страниц тем + `HrDateRangeRequestForm`, `SickLeaveRequestForm`, `ResignationRequestForm`, `TransferRequestForm` | |
| Цели перевода | `feedbackgb.v_stores` → `categories.spots` | **25 строк, только магазины** |

`feedbackgb.feedback.category` — свободный `text`, CHECK-constraint нет.
Добавление supply-категорий миграции схемы не требует.

### 1.2 Розхідні матеріали

| Слой | Объект | Суть |
|---|---|---|
| Каталог | `GET /api/consumables/catalog` → `rpc_product_catalog(p_category_id, p_search, p_warehouse_id, p_page, p_page_size)` | `p_warehouse_id` захардкожен константой `SUPPLY_WAREHOUSE_ID = 37` |
| Склад-источник | `household_chemicals.warehouses.id = 37` | «Склад витратних матеріалів» |
| Создание | `rpc_create_feedbackgb_consumables_order(p_feedback_id, p_feedback_user_id, p_feedback_store_id, p_notes, p_items)` | SECURITY DEFINER, возвращает `jsonb` |
| Идемпотентность | `household_chemicals.feedbackgb_order_contributions` по `feedback_id` | повтор → `{success:true, duplicate:true}` без второго документа |
| Слияние | ключ `(source='feedbackgb', shop_id, warehouse_id=37, status='submitted')` + `pg_advisory_xact_lock(shop_id)` | заявки разных точек за смену сливаются в один заказ на точку |
| Статусы | `consumablesOrder.ts` → `orders.status` + `transfers.status` | `accepted → picking → shipped` |
| Порядок в API | CRM вызывается **до** вставки в `feedback` | пользователь не видит успех, если склад не принял |

### 1.3 Ключевое препятствие: маппинг точки

`rpc_create_feedbackgb_consumables_order` содержит:

```sql
SELECT id INTO v_shop_id
FROM household_chemicals.shops
WHERE poster_spot_id = p_feedback_store_id AND is_active = true;
IF v_shop_id IS NULL THEN
  RETURN jsonb_build_object('success', false,
    'error', 'FeedbackGB store is not mapped to a CRM shop');
END IF;
```

Фактическое состояние `household_chemicals.shops` (39 активных строк):

* `id` 1–24 — магазины, `poster_spot_id` заполнен (1…24), совпадает с
  `categories.spots.spot_id`;
* `id` 25–39 — **цехи и склады** (`ЦЕХ "2 поверх"`, `ЦЕХ "Піцерія ГРАВІТОН"`,
  `ЦЕХ "Бульвар-Автовокзал"`, `ЦЕХ НІЧНА ЗМІНА "САДОВА"`, `ЦЕХ "Флорида"`,
  `ЦЕХ "Піцерія МІКРОРАЙОН"`, `Склад витратних матеріалів`,
  `Склад "Крафтова пекарня"`, `Склад сировини "Трембіта"`,
  `Склад "Кондитерка"`, `Склад № 2`, `Склад "Запаси Анатолійовича"` и т.д.),
  у **всех** `poster_spot_id IS NULL`, но `warehouse_id` заполнен и указывает
  на реальный `warehouses.id`.

`categories.spots` (источник `v_stores` и `users.store_id`) содержит только
25 магазинов — цехов там нет и не будет: это внешне синхронизируемая таблица
Poster.

Вывод: **у supply-точки нет ключа, который принимает текущая RPC.**

---

## 2. Архитектурные решения

### Р1. Идентичность supply-заявки — `facility_id`, а не `store_id`

Сессия supply несёт `facility_id uuid` (`feedbackgb.facilities`), а не
`store_id`. `feedbackgb.feedback.store_id` для supply-строк остаётся `NULL`.

Миграция (дополнение к `20260723_001_supply_employees.sql`):

```sql
alter table feedbackgb.feedback
  add column if not exists facility_id uuid
    references feedbackgb.facilities(id) on delete restrict;

create index if not exists feedback_facility_idx
  on feedbackgb.feedback (facility_id, created_at desc)
  where facility_id is not null;

alter table feedbackgb.facilities
  add column if not exists crm_warehouse_id integer;

comment on column feedbackgb.facilities.crm_location_id is
  'household_chemicals.shops.id (НЕ warehouses.id и НЕ poster_spot_id)';
comment on column feedbackgb.facilities.crm_warehouse_id is
  'household_chemicals.warehouses.id — для отчётности и будущих transfer-потоков';
```

`crm_location_id` хранит **`shops.id`**, потому что `orders.shop_id` — FK на
`shops`, а не на `warehouses`. `crm_warehouse_id` дублирует связь для будущих
потоков сырья (`rpc_create_transfer_with_items` работает по warehouse-ID).

Сид facilities выполняется отдельным ревьюируемым скриптом из живых данных, без
хардкода ID в коде приложения (требование `READ_ONLY_AUDIT_2026-07-23.md`).

### Р2. Новая CRM-функция вместо правки существующей

**Решение: добавить сестринскую функцию, не трогая рабочую.**

```sql
create or replace function household_chemicals.rpc_create_feedbackgb_supply_consumables_order(
  p_feedback_id      uuid,
  p_feedback_user_id uuid,
  p_crm_shop_id      integer,   -- household_chemicals.shops.id напрямую
  p_notes            text default null,
  p_items            jsonb default '[]'::jsonb
) returns jsonb
```

Тело — копия существующей функции с единственной заменой блока резолва точки:

```sql
SELECT id INTO v_shop_id
FROM household_chemicals.shops
WHERE id = p_crm_shop_id AND is_active = true;
```

Всё остальное сохраняется байт-в-байт: проверка дубля по
`feedbackgb_order_contributions`, `pg_advisory_xact_lock(v_shop_id)`, слияние в
открытый `submitted`-заказ, запись `order_items` + `feedbackgb_order_contributions`,
`warehouse_id = 37`, `source = 'feedbackgb'`.

Почему так, а не иначе:

* **Не backfill `shops.poster_spot_id` синтетическими ID.** `poster_spot_id` —
  внешний ключ Poster; выдуманные значения столкнутся с реальными `spot_id`
  при следующей синхронизации и сломают маппинг магазинов.
* **Не менять сигнатуру рабочей функции.** Seller-поток в проде; изменение
  контракта живой функции — лишний риск ради экономии одной функции.
* Одинаковая таблица `feedbackgb_order_contributions` означает, что весь
  read-слой (`consumablesOrder.ts`: статусы, детали, timeline, success-stage)
  работает для supply **без единой строки изменений**.

**Про гейт ADR 0003.** Гейт закрывает `rpc_create_employee_order`,
`rpc_create_write_off_with_items`, `rpc_create_receipt_with_items` — у них нет
ключа идемпотентности. Поток розхідних матеріалів под гейт не подпадает: он уже
в проде и уже идемпотентен по `feedback_id` через
`feedbackgb_order_contributions` с get-or-create семантикой. Новая функция
наследует ровно это свойство. Это надо явно зафиксировать в `INTEGRATIONS.md`,
иначе следующий ревьюер заблокирует работу по формальному признаку.

### Р3. Цели перевода (HR `transfer`)

Новое представление:

```sql
create or replace view feedbackgb.v_transfer_targets as
select 'store'::text as kind, s.id::text as id, s.name, true as is_active
  from feedbackgb.v_stores s
union all
select 'facility'::text, f.id::text, f.name, f.is_active
  from feedbackgb.facilities f
 where f.is_active;
```

Контракт полей `fields` для `hr_topic = 'transfer'`:

* магазин: `target_store_id` (integer) — **без изменений**, seller-поток не трогаем;
* цех/склад: `target_facility_id` (uuid) — новое поле;
* валидация принимает ровно одно из двух, ноль или два — `400`;
* сервер сам резолвит `target_store_name` / `target_facility_name` из БД и
  никогда не доверяет клиентской подписи (правило уже действует для магазинов).

### Р4. Каталог: убрать хардкод склада

`SUPPLY_WAREHOUSE_ID = 37` уезжает в `CONSUMABLES_WAREHOUSE_ID` (env, значение
по умолчанию 37 для обратной совместимости) и используется обоими приложениями.
Прямое требование `READ_ONLY_AUDIT_2026-07-23.md`: «no UI code may hardcode an ID».

### Р5. Общий код — третьей копии не будет

Переносим в `shared/lib/` и подключаем `experimental.externalDir` в
`supply-app/next.config.mjs`:

```
hrTopics.ts              feedbackValidation.ts    assignment.ts
consumablesCatalog.ts    consumablesOrder.ts      consumablesStatusMeta.ts
consumablesOrderError.ts warehouseCrm.ts          feedbackStatusMeta.ts
```

`scripts/check-shared-drift.sh` расширяется с пары приложений до матрицы из
трёх (см. пункт 19 плана исправлений).

Что **не** переносится в supply: `PostHogProvider`, `InteractionTracker`,
`OfflineSyncProvider`/`offlineDb` — офлайн-очередь и аналитика подключаются
отдельным решением, а не автоматически вместе с формами.

### Р6. Назначение админа и уведомления

`resolveAssignedAdmin(supabase, category, storeId)` ищет
`admin_directions (category, store_id)`, затем откат на `store_id IS NULL`.
Supply-заявки идут с `storeId = null` → сразу попадают на правило «все точки».

Фаза 1: этого достаточно, но нужно убедиться, что для `hr_question` и
`consumables_request` есть активные строки с `store_id IS NULL`, иначе все
supply-заявки будут `assigned_to = null`.

Фаза 2 (отдельная задача, не блокирует): расширить `admin_directions` полем
`facility_id` и добавить третий шаг резолва (facility → NULL).

`createNotification` работает без изменений — получателем остаётся назначенный
админ.

### Р7. Отображение в админке

`feedback_feed` подставляет `store_name` из `store_id`; у supply-строк он `NULL`.
`POST /api/feedback` уже пишет `store_label`, поэтому:

* supply-роут кладёт в `store_label` имя facility;
* `feedback_feed` дополняется `coalesce(store_name, store_label)` либо
  отдельным полем `location_name` + `location_kind`;
* фильтр по точке в админке получает опцию «Цехи і склади».

---

## 3. Поверхность supply-app после работ

### Маршруты страниц

```
/home/feedback/consumables_request      корзина + отправка
/home/hr-menu                           меню 5 тем
/home/hr-menu/vacation
/home/hr-menu/day-off
/home/hr-menu/sick-leave
/home/hr-menu/resignation
/home/hr-menu/transfer
/home/my-requests                       Активні / Архів
/home/my-requests/[id]                  детали + timeline
/home/notifications
/home/thanks                            экран успеха со стадией заказа
```

### API-роуты

| Метод | Путь | Заметка |
|---|---|---|
| POST | `/api/feedback` | общая ручка; supply-версия подставляет `facility_id`, `store_id = null` |
| GET | `/api/consumables/catalog` | прокси `rpc_product_catalog`, warehouse из env |
| GET | `/api/hr/vacation-requests` | и ещё 4 по темам |
| GET | `/api/my-feedback`, `/api/my-feedback/[id]` | свои заявки + детали |
| GET | `/api/notifications`, POST `/api/notifications/[id]/read`, `/read-all` | |
| GET | `/api/transfer-targets` | `v_transfer_targets`, для темы «переведення» |
| GET | `/api/r/photo/[id]` | подписанная ссылка на фото (лікарняний) |

Все API-роуты закрываются middleware (пункт 3 плана исправлений), а не только
проверкой внутри хендлера.

---

## 4. Фазы работ

### Фаза 0 — фундамент (блокирует всё остальное)

1. App-scoped вход: `user_app_access` + активная `user_facility_memberships`
   (пункты 1–2 плана исправлений).
2. `SupplySession` расширяется до `{ uid, full_name, role, facility_id, iat }`;
   `facility_id` в куке — **подсказка**, авторитет всегда перечитывается из БД
   в `requireSupplyUser()`.
3. Middleware на `/home/*` и `/api/*` (пункт 3).
4. Миграция: `feedback.facility_id`, `facilities.crm_warehouse_id`,
   комментарии к `crm_location_id`.
5. Сид `facilities` из живых `household_chemicals.shops` (id 25–39) —
   ревьюируемый скрипт, не хардкод.

**Выход фазы:** авторизованный работник цеха видит `/home`, у сессии есть
facility, ни один API не отвечает анониму.

### Фаза 1 — вынос общего кода

Перенос 9 файлов в `shared/lib/`, `externalDir: true`, расширение
drift-скрипта до трёх приложений, порт тестов `feedbackValidation` в общий пакет.

**Выход:** `npm run test` зелёный в feedback-app, `check-shared-drift.sh` — код 0.

### Фаза 2 — HR (внешних блокеров нет, поэтому первым)

1. `v_transfer_targets` + `GET /api/transfer-targets`.
2. `target_facility_id` в валидации и в резолве имени на сервере.
3. Перенос 5 форм и меню; вычистить seller-копирайт («магазин» → «цех/склад»).
4. 5 self-service GET-роутов.
5. Строки `admin_directions` для `hr_question` со `store_id IS NULL`.
6. Админка: `location_name` в фиде.

**Выход:** работник цеха подаёт все 5 типов HR-заявок; заявка видна в админке с
именем цеха; сам работник видит её в «Мої заявки».

### Фаза 3 — розхідні матеріали (нужен шаг CRM-команды)

1. **CRM-команда:** `rpc_create_feedbackgb_supply_consumables_order`, гранты
   `service_role`, интеграционные тесты (дубль, слияние, неактивная точка).
2. Обновить `INTEGRATIONS.md`: новая строка контракта + явная пометка, что
   consumables-мост не подпадает под гейт ADR 0003.
3. `CONSUMABLES_WAREHOUSE_ID` в env обоих приложений.
4. `/api/consumables/catalog` в supply-app.
5. Ветка `consumables_request` в supply-версии `POST /api/feedback`: вызов новой
   RPC c `p_crm_shop_id = facility.crm_location_id`, CRM **до** записи в журнал,
   `client_submission_id` как `feedback.id`.
6. Перенос `ConsumablesCartForm` + `ConsumablesTabBar` + `QuantityStepper`.
7. Экран успеха с реальной стадией (`getConsumablesSuccessStage`).

**Выход:** заказ цеха создаёт `orders`-строку с `shop_id` цеха и
`warehouse_id = 37`; повторная отправка того же `feedback_id` не создаёт второй
документ; статус доезжает до «Мої заявки».

### Фаза 4 — кабинет

`my-requests` (Активні/Архів), детали с timeline, колокольчик уведомлений.

---

## 5. Критерии приёмки (сквозные)

| # | Проверка | Ожидание |
|---|---|---|
| A1 | Работник цеха без строки `user_app_access('supply_app')` вводит верный PIN | `401`, нейтральный текст, `auth.login.failure` в аудите |
| A2 | PIN продавца в supply-app | `401` **и** `users.last_login` не изменился |
| A3 | HR-заявка из цеха | `feedback.store_id IS NULL`, `facility_id` = цех, `store_label` = имя цеха |
| A4 | Отпуск с датой начала через 3 дня | `400` «щонайменше за 7 днів» |
| A5 | Перевод: `target_facility_id` + `target_store_id` вместе | `400` |
| A6 | Перевод: подделанный `target_facility_name` в теле запроса | имя в БД взято из `facilities`, клиентское проигнорировано |
| A7 | Заказ розхідних з цеху | `orders.shop_id` = `facilities.crm_location_id`, `warehouse_id = 37`, `source='feedbackgb'` |
| A8 | Повторная отправка того же `feedback_id` | `duplicate: true`, `count(orders)` не изменился |
| A9 | Два цеха заказывают в одну смену | два **разных** заказа (слияние только внутри одной точки) |
| A10 | Один цех, две заявки в одну смену | один заказ, `order_items.quantity_requested` просуммированы, две строки в contributions |
| A11 | Facility с `crm_location_id IS NULL` | `400` с внятным текстом, ни одной строки в `feedback` |
| A12 | CRM недоступна | `503`, в `feedback` **ничего** не записано |
| A13 | Заказ создан в CRM, вставка в `feedback` упала | повтор с тем же `client_submission_id` → `duplicate`, второго заказа нет |
| A14 | Аноним на любой `/api/*` supply-app | `401` JSON от middleware |

---

## 6. Тесты

### Юнит (vitest, node-env — как в feedback-app)

* `feedbackValidation`: 5 HR-тем × граничные даты; `transfer` с нулём/двумя
  целями; корзина — пустая, >100 позиций, дубль товара, нулевое/отрицательное
  количество, дробное округление до 3 знаков.
* `facilityResolution`: facility без `crm_location_id`, неактивная facility,
  facility чужого пользователя.
* `consumablesOrderError`: классификация «store is not mapped» → `400`, сетевая
  ошибка → `503`.
* `session`: подпись/проверка, TTL 12 ч, `iat` в будущем, чужой секрет,
  неизвестная роль.

### Интеграционные (моки Supabase, как `feedback-route.test.ts`)

* Порядок вызовов: CRM раньше `insert` — проверяется через порядок моков.
* `503` от CRM ⇒ `supabase.from('feedback').insert` не вызван ни разу.
* `duplicate: true` ⇒ ответ `200`, второй `insert` не выполнен.
* HR `transfer`: сервер перезаписывает `target_*_name` значением из БД.
* Аноним ⇒ `401` до какого-либо обращения к БД.

### На стороне CRM (репозиторий CRM, до включения моста)

* Двойной вызов новой RPC с одним `p_feedback_id` → один `orders`-документ.
* Таймаут после коммита + ретрай → один документ.
* Конкурентные вызовы двух работников одного цеха → один заказ, два вклада.
* `p_crm_shop_id` неактивной точки → `success: false`, ноль записей.

### Ручной прогон на staging

Один работник цеха: вход → 5 HR-заявок → заказ розхідних → «Мої заявки» →
статус после `confirm` на стороне склада → уведомление админу. Отдельно —
прогон под продавцом в seller-app после всех изменений, чтобы подтвердить,
что общий код не сломал существующий поток.

---

## 7. Риски

| Риск | Митигация |
|---|---|
| CRM-команда не добавит supply-RPC | Фаза 2 (HR) поставляется независимо и раньше |
| Расхождение общего кода на трёх приложениях | Фаза 1 делается **до** фаз 2–3; drift-скрипт на матрицу |
| Facility заведена без `crm_location_id` | SQL-guard по образцу `scripts/check-supply-store-mapping.sql`, запуск после каждой новой facility |
| Правки shared-кода ломают seller-поток | Полный прогон тестов feedback-app в CI на каждый шаг фазы 1 |
| Смешение потоков в админке | `location_kind` в фиде + отдельный фильтр «Цехи і склади» |
