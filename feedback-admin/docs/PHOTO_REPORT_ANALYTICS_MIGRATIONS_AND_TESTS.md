# Фото звіт: миграции, тесты и проверки

## Миграции — проект

Ниже только проект миграций. Окна, `effective_at` и исключения закрытия применяются после утверждения правил окон; смены — только после отдельного утверждения источника смен и retention. У каждой реальной миграции обязателен rollback SQL либо явная пометка «необратимо»; новые вкладки и атрибуция по смене включаются отдельными feature flags.

### 1. Контрольные окна и исключения

Таблица `feedbackgb.photo_report_requirements`:

- `id`, `store_id integer references categories.spots(spot_id)` (nullable только для сетевого default);
- `weekday_iso` (1=понедельник … 7=воскресенье), `slot_no`, `slot_label`, `window_start`, `due_time`, `late_grace_end`;
- `is_required`, `effective_from`, `effective_to`;
- `created_at`, `updated_at`.

Все `time` трактуются в `Europe/Kyiv`; окно через полночь запрещено. Окно — `[window_start, due_time)`, grace — `[due_time, late_grace_end)`. CHECK: `window_start < due_time AND due_time <= late_grace_end`.

PostgreSQL не имеет встроенного `timerange`: создать `feedbackgb.timerange AS RANGE (subtype = time)`. Один `EXCLUDE USING gist` по `coalesce(store_id,0)`, `weekday_iso`, `daterange(effective_from, coalesce(effective_to,'infinity'),'[]')` и `timerange(window_start, late_grace_end,'[)')` запрещает одновременно действующие пересечения слотов, включая разные `slot_no`. Это делает grace одного окна непересекающимся со следующим. Если у магазина на дату и weekday есть хотя бы одно собственное правило, сетевые default-правила для него игнорируются целиком.

Отдельная таблица `feedbackgb.photo_report_exceptions(store_id nullable, local_date, reason, created_by, created_at)` исключает закрытые магазины и праздники из знаменателя; `store_id null` — вся сеть. Уникальность: `UNIQUE NULLS NOT DISTINCT (store_id, local_date)` на PostgreSQL 15+, иначе два частичных unique-индекса. Неполный рабочий день пока не поддерживается: для него требуется отдельное переопределение окон на дату.

### 2. Время и атрибуция отчёта

В `feedbackgb.feedback` добавить nullable `effective_at timestamptz DEFAULT now()`, `effective_at_source (client|server)`, `client_time_rejected_reason`, `attribution_source (attendance|home_store|admin)`, `attendance_id nullable`. Backfill запускается пачками: старым записям присваиваются `effective_at=created_at`, `effective_at_source=server`; старый `client_created_at` не используется, так как offline-флага не было. Затем добавить `CHECK (effective_at IS NOT NULL) NOT VALID` и отдельно `VALIDATE CONSTRAINT`, не ставить блокирующий `NOT NULL` на большой таблице.

Новый API один раз валидирует offline-флаг и 12-часовое окно, записывает время и причину отклонения. Сам offline-флаг приходит с клиента и может быть подделан — это принятый риск; UI показывает «синхронізовано пізніше», а аналитика считает долю поздних синхронизаций на продавца. `attendance_id` определяется только фактической `confirmed`/`corrected` сменой в `effective_at`. `feedback_feed` не пересоздаётся в первой миграции: сначала read-only снять его живое определение и порядок колонок, затем отдельной миграцией добавить поля строго в конец фактического контракта. Безопасный порядок релиза: миграция → seller app → admin; старый app временно получает server default.

### 3. Присутствие продавца

Таблица `feedbackgb.seller_attendance`:

- `id`, `user_id`, `store_id`;
- `started_at`, `ended_at nullable` (timestamptz);
- `kind` (`planned`, `actual`), `source` (`poster`, `schedule`, `check_in`, `manual`);
- `source_ref`, `status` (`confirmed`, `corrected`, `cancelled`);
- `created_by`, `created_at`, `updated_at`, `correction_reason`, `last_confirmed_activity_at`.

Ограничения: `ended_at is null or ended_at > started_at`; `store_id` имеет FK на `categories.spots`; без ограничения «продавец закреплён за магазином» — подмены допустимы. EXCLUDE действует только `WHERE (kind='actual' AND status <> 'cancelled')`; он запрещает две пересекающиеся фактические смены одного продавца. Плановые и фактические смены разделены.

Новый check-in в приложении завершает прежнюю открытую фактическую смену временем нового `started_at`, с причиной `superseded_by_check_in`; 409 остаётся для ручных/импортных пересечений. Планировщик закрывает забытые смены через утверждённое время (рекомендация 16 часов), причина `auto_closed`. Такая смена после `last_confirmed_activity_at` считается неполной и не создаёт обязанность по поздним окнам. BEFORE DELETE-триггер с `RAISE EXCEPTION` запрещает удалить смену: только `cancelled`. Не хранить геолокацию без отдельного решения владельца.

### 4. Аудит изменений смен

Создать `feedbackgb.attendance_events` для журнала смен и ошибок загрузки: `attendance_id nullable`, `store_id`, `user_id`, `event_type`, `occurred_at`, `actor_user_id`, `meta`; индекс `(store_id, occurred_at desc, id)`. Это индексируемая сущность, в отличие от поиска id внутри `audit_log.meta`.

Каждая запись/корректировка смены выполняется одной RPC-функцией (`attendance_check_in`, `attendance_check_out`, `attendance_correct`): она в одной транзакции выставляет `app.actor` и изменяет строку. Триггер insert/update пишет этого actor; при прямом системном изменении — `system`. API сохраняет ошибки Storage с rate limit, чтобы сбой не залил журнал. BEFORE DELETE-триггер с `RAISE EXCEPTION` защищает также `attendance_events`. В `audit_log` остаются краткие административные события.

### 5. Индексы и агрегаты

```sql
create index concurrently feedback_photo_store_effective_idx
  on feedbackgb.feedback (store_id, effective_at desc)
  where category = 'photo_report';
```

Индексы новых пустых attendance-таблиц создаются обычными `CREATE INDEX` в той же миграции; частичный gist-индекс EXCLUDE уже покрывает путь user/time, отдельный `user_started` не нужен. `CONCURRENTLY` остаётся только для существующей `feedback` и выносится в отдельный запуск. Агрегирующая SQL-функция должна повторять `reportPhotoUrls`: JSONB-массив, JSON-строка или fallback `photo_url`; перед запуском нормализовать исторические данные либо зафиксировать эквивалентное SQL-выражение.

Ручное переназначение магазина отчёта делается только RPC с причиной: обновляет attribution-поля, попадает в существующий `audit_feedback`/`audit_log`, а агрегаты затронутых прошлых дней пересчитываются.

## Тесты

### Unit

- киевские границы дня: 23:50 и 00:10 принадлежат разным дням;
- переход Europe/Kyiv на летнее/зимнее время: день 23/25 часов;
- client_created_at после полуночи относится к исходному дню только в разрешённом offline-окне;
- границы полуоткрытых интервалов: до `window_start`, ровно `due_time`, за мгновение до/ровно `late_grace_end`;
- pending в течение дня не считается нарушением;
- отчёт на каждой границе `window_start/due_time/late_grace_end` закрывает ожидаемое окно;
- один отчёт закрывает только одно самое раннее незакрытое окно;
- несколько отчётов в одном окне не закрывают другие;
- правило магазина целиком перекрывает сетевое default-правило;
- grace одного окна не пересекается со следующим окном;
- изменение правил окна не переписывает прошлые дни;
- магазин без настроенного плана отображается как «не требуется»;
- продавец без attendance не считается отсутствующим или нарушившим;
- продавец в смене и без отчёта попадает в «не надіслав» только для пересекающегося обязательного окна;
- частичная смена, пересекающая полночь, корректно раскладывается по дням.
- cancelled-смена не блокирует новую; пересечение фактических смен даёт 409; auto-close сохраняет причину;
- повторный check-in закрывает прежнюю открытую смену с `superseded_by_check_in`; `auto_closed` не создаёт обязанность после последней подтверждённой активности;
- офлайн-отчёт после конца смены атрибутируется по смене в `effective_at`;
- SQL и `reportPhotoUrls` дают одинаковое число фото; число отчётов строки совпадает с галереей.

### API/RBAC

- без сессии: 401, продавец: 403, админ: 200 для всех analytics endpoint'ов;
- `store_id`, период и лимиты валидируются; диапазон >90 дней — 400;
- raw `photo_urls` нет в ответах аналитики;
- ручная корректировка смены создаёт `attendance_events` с actor и причиной;
- отчёт при активной подменной смене получает магазин смены; без смены — домашний магазин с `attribution_source=home_store`.
- анонимный вызов SQL RPC отклонён.
- ручное переназначение магазина требует причину, создаёт audit-запись и пересчитывает агрегаты.

### Интеграция staging

1. Три магазина, разные планы окон, исключение закрытого магазина, 6 продавцов и подтверждённые фактические смены.
2. Отправить отчёты до/после полуночи Kyiv и в разных окнах.
3. Сверить SQL-агрегат с каждым экраном и JSON API.
4. Открыть галерею 60 фото: одна операция пакетного подписания.
5. Создать ручную корректировку, ошибку Storage и проверить audit trail, actor и rate limit.
6. Проверить старый seller app после миграции и порядок миграция → seller app → admin.

### Нагрузка

- 100 магазинов × 3 окна × 15 фото;
- 100 одновременных продавцов;
- staging заполнен историей 90 дней: примерно 27 000 отчётов до замера `/store?from=&to=` на полном диапазоне;
- одновременно 10 администраторов открывают дневную сводку и галерею;
- критерии: отсутствие сирот, корректные агрегаты, p95 API аналитики <2 с, ответ дневной сводки <200 KB.

## Readback после миграций

```sql
select relname, relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'feedbackgb'
  and relname in ('photo_report_requirements', 'photo_report_exceptions', 'seller_attendance', 'attendance_events');

select indexname
from pg_indexes
where schemaname = 'feedbackgb'
  and indexname in ('feedback_photo_store_effective_idx', 'seller_attendance_store_started_idx', 'attendance_events_store_occurred_idx');

select conname, contype, convalidated
from pg_constraint
where connamespace = 'feedbackgb'::regnamespace;

select tgname, tgrelid::regclass
from pg_trigger
where tgrelid in ('feedbackgb.seller_attendance'::regclass, 'feedbackgb.attendance_events'::regclass)
  and not tgisinternal;

select count(*) as effective_at_nulls
from feedbackgb.feedback
where effective_at is null;
```

В миграции: `REVOKE ALL ON TABLE ... FROM anon, authenticated`; `REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon, authenticated`. Readback проверяет `has_table_privilege(role, table, 'select'|'insert'|'update'|'delete') = false` для всех новых таблиц и `has_function_privilege(role, function, 'execute') = false` для каждой RPC. Одного `relrowsecurity=true` недостаточно: сервер работает под `service_role` с BYPASSRLS. Только после этого разрешается UI и нагрузочная проверка.
