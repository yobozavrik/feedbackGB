# План реализации: персональный AI-помощник в админ-панели

## 1. Цель

Добавить в админ-панель отдельный раздел **«Мій помічник»** для администраторов сети.

Помощник помогает анализировать рабочие данные и формировать предложения, но не становится общим чатом и не действует самостоятельно от лица человека.

Главное правило изоляции:

> Каждый администратор видит только свои диалоги, запросы, черновики задач и персональные автоматизации. `super_admin` видит все диалоги и журнал событий, но не может незаметно писать от имени другого администратора.

Система должна фиксировать полный жизненный цикл каждого обращения: кто открыл чат, что запросил, какие источники были использованы, какой ответ вернулся, какие задачи/автоматизации были предложены или запущены, ошибки и время обработки.

## 2. Подтверждённая исходная точка

Это план, а не утверждение о уже реализованной функции.

| Область | Состояние в текущем коде |
|---|---|
| Роли | Есть `admin` и `super_admin`; server helper `requireAdminSession()` проверяет роль из сессии. |
| Навигация | Есть групповой sidebar `AdminShell`; super-admin-only пункты фильтруются в `src/lib/admin/menu.tsx`. |
| Журнал | Есть `feedbackgb.audit_log` и super-admin-only `/admin/audit`, но он хранит дискретные события, а не полноценные диалоги AI. |
| База | Используется схема `feedbackgb`, server-only Supabase client и service role. |
| AI-чат | Маршрутов, UI, таблиц разговоров, очереди задач и провайдера LLM в текущем контуре не обнаружено. |

Следствие: нельзя «дописать пару полей в audit_log» и считать задачу выполненной. Нужен изолированный контур чатов, запуска AI и журнала автоматизаций.

## 3. Границы первой версии

### Входит

1. Персональный чат каждого `admin`/`super_admin` с помощником.
2. Строгая изоляция по `owner_admin_id` на каждом чтении и действии.
3. Super-admin обзор всех чатов, запросов, источников, результатов, задач, автоматизаций и ошибок.
4. Аудит каждого запроса и ответа с техническими метаданными.
5. Помощник только читает разрешённые бизнес-данные через server-side инструменты.
6. Предложения задач и автоматизаций с обязательным явным подтверждением человека.
7. Персональные автоматизации: каждый запуск принадлежит конкретному администратору, имеет журнал и может быть выключен владельцем или super admin.
8. Поиск, фильтры, экспорт аудита только для super admin.

### Не входит в MVP

- самостоятельная отправка сообщений продавцам, Telegram, email или изменение статуса фидбека;
- доступ AI к PIN, cookie, `init_data`, service-role ключам, сырым фото, подписанным URL или секретам окружения;
- общий «чат администраторов»;
- подмена личности: super admin не может отправить сообщение как другой admin;
- browser-доступ к таблицам AI через `anon`/`authenticated`;
- применение миграций, выбор LLM-провайдера или production-деплой без отдельных подтверждений.

## 4. Роли и права

| Операция | Admin | Super admin | Сервисный backend |
|---|---|---|---|
| Создать личный чат | Только от своего имени | Только от своего имени | Да, от имени явно указанного владельца только для служебного job |
| Читать личные чаты | Только `owner_admin_id = session.uid` | Все | Да |
| Писать в чужой чат | Нет | Нет; только режим просмотра/комментарий super admin с отдельным автором | Нет без явного системного правила |
| Видеть аудит всех чатов | Нет | Да | Да |
| Создать персональную автоматизацию | Только свою | Свою или назначенную другому с явным `created_by` | Исполняет только активные правила |
| Включить/выключить чужую автоматизацию | Нет | Да, с аудитом | Исполняет только enabled |
| Подтвердить действие с внешним эффектом | Только собственное | Да, от своего имени | Не подтверждает сам себя |

`admin` может иметь доступ к бизнес-данным только в пределах уже существующего административного доступа. Помощник не расширяет роли и не обходит RBAC.

## 5. Пользовательские сценарии

### 5.1 Личный диалог администратора

1. Admin открывает `/admin/assistant`.
2. Сервер извлекает session и создаёт/открывает только чат, принадлежащий `session.uid`.
3. Admin вводит запрос, например: «Покажи магазины без фотоотчёта за сегодня».
4. До вызова модели сервер создаёт неизменяемую запись запроса со статусом `queued`.
5. Оркестратор вызывает только allowlist инструментов чтения, фиксирует каждый tool call и источники.
6. Сохраняются ответ помощника, версия промпта, модель, usage, время, статус и безопасный error code при неудаче.
7. UI показывает ответ с источниками, временем данных и предупреждением, если данные неполные/устаревшие.

### 5.2 Предложение задачи

1. Помощник может сформировать структурированное предложение: название, описание, приоритет, доказательства, владелец, дедлайн.
2. Статус по умолчанию — `draft`; запись задачи не создаётся в рабочей системе автоматически.
3. Admin видит кнопку «Створити задачу» и явно подтверждает действие.
4. Backend проверяет владельца и роль заново, создаёт задачу и пишет аудит `assistant.task.approved`.
5. Если подтверждает super admin для чужого admin, автора подтверждения и владельца задачи хранить раздельно.

### 5.3 Персональная автоматизация

Пример: «Каждый день в 09:15 дай мне список магазинов без двух фотоотчётов».

1. Помощник создаёт только черновик правила с расписанием, owner и preview результата.
2. Admin подтверждает rule; она становится `active`.
3. Планировщик запускает правило с контекстом только owner admin.
4. Результат сохраняется в журнале запусков и выдаётся владельцу внутри админки.
5. Внешняя рассылка отключена в MVP. В будущем Telegram/email — отдельное подтверждаемое расширение.
6. Ошибка, таймаут или недостаток прав фиксируются как `failed`, не повторяются бесконечно и не меняют бизнес-данные.

### 5.4 Super-admin обзор

Маршрут `/admin/assistant/audit` доступен исключительно super admin. Он позволяет:

- искать по владельцу, периоду, статусу, категории источника, типу автоматизации и request ID;
- открыть transcript в режиме просмотра;
- увидеть все tool calls, data freshness, ошибки и подтверждения;
- выключить опасную/ненужную автоматизацию с обязательным reason;
- экспортировать ограниченный аудит без секретов и без файлов/изображений.

## 6. UX и маршруты

### 6.1 Sidebar

В группе «Робота» добавить:

```text
Робота
  Огляд
  Мої завдання
  Фотозвіт
  Мій помічник                 /admin/assistant

Система (лише super admin)
  Журнал дій
  Аудит помічника              /admin/assistant/audit
```

### 6.2 Экран `/admin/assistant`

```text
┌ Мій помічник ─────────────────── [Нова розмова] ┐
│ Мої розмови                 │ Діалог            │
│ • Фото звіт сьогодні         │ Джерела: ...      │
│ • Мої прострочені задачі     │                   │
│ • Ранковий контроль          │ [відповідь AI]    │
│                               │                   │
│ Автоматизації                │ [поле запиту]     │
│ • Ранковий контроль  Активна │ [Надіслати]       │
└─────────────────────────────────────────────────┘
```

Обязательные UI-состояния: загрузка, пустой чат, обработка, rate limit, ошибка провайдера, данные недоступны, ответ с неполными источниками, отмена, черновик действия, подтверждение и завершение.

### 6.3 Экран `/admin/assistant/audit`

Таблица super admin: время, owner, тип события, chat/run ID, статус, источники, latency, tokens/cost (если доступно), результат действия. Детали открываются в Drawer. Полный текст запроса/ответа отображается только по явному клику и только в UI super admin.

## 7. Данные и миграции

Номера миграций здесь не фиксируются: перед реализацией проверить последний применённый номер в target базе и назвать новые миграции строго следующим номером. Все объекты — только `feedbackgb`, не `public`.

### 7.1 Новые таблицы

| Таблица | Назначение | Ключевые поля |
|---|---|---|
| `assistant_conversations` | Заголовок и владение чатом | `id`, `owner_admin_id FK users`, `created_by`, `title`, `status`, `created_at`, `last_message_at`, `archived_at` |
| `assistant_messages` | Неизменяемая история реплик | `id`, `conversation_id`, `sequence_no`, `author_type (admin/assistant/system/super_admin_note)`, `author_user_id`, `content`, `content_redacted`, `request_id`, `created_at` |
| `assistant_runs` | Один запуск оркестратора на запрос | `id`, `conversation_id`, `owner_admin_id`, `requested_by`, `status`, `provider`, `model`, `prompt_version`, `started_at`, `completed_at`, `latency_ms`, `input_tokens`, `output_tokens`, `error_code` |
| `assistant_run_sources` | Доказательная база ответа | `id`, `run_id`, `source_kind`, `source_ref`, `retrieved_at`, `freshness_at`, `row_count`, `safe_summary` |
| `assistant_tool_calls` | Каждый server-side вызов инструмента | `id`, `run_id`, `tool_name`, `arguments_redacted`, `result_summary`, `status`, `started_at`, `completed_at`, `error_code` |
| `assistant_action_drafts` | Черновики действий AI | `id`, `run_id`, `owner_admin_id`, `action_type`, `payload`, `status`, `approved_by`, `approved_at`, `executed_at`, `failure_reason` |
| `assistant_automations` | Персональные правила | `id`, `owner_admin_id`, `created_by`, `name`, `schedule`, `timezone`, `input_template`, `status`, `last_run_at`, `next_run_at`, `disabled_reason` |
| `assistant_automation_runs` | История каждого запуска правила | `id`, `automation_id`, `owner_admin_id`, `status`, `triggered_at`, `started_at`, `completed_at`, `conversation_id`, `run_id`, `error_code` |
| `assistant_audit_events` | Append-only аудит контура | `id`, `occurred_at`, `event_type`, `actor_user_id`, `owner_admin_id`, `conversation_id`, `run_id`, `automation_id`, `request_id`, `meta` |

### 7.2 Обязательные ограничения и индексы

1. `owner_admin_id` и `conversation_id` — `NOT NULL` там, где запись относится к личному чату.
2. `assistant_messages`: `unique(conversation_id, sequence_no)`; sequence выдаёт сервер в транзакции.
3. `author_type = 'admin'` допускает только `author_user_id = owner_admin_id`; `super_admin_note` не меняет owner.
4. `assistant_runs.requested_by = owner_admin_id` для личного запуска; super-admin inspection не создаёт run от чужого имени.
5. `assistant_action_drafts.status` — конечный автомат `draft → approved|rejected|expired → executed|failed`; обратные переходы запрещены.
6. `assistant_automations.owner_admin_id` не меняется update-запросом; передача владения — отдельное audited действие.
7. Индексы: `(owner_admin_id, last_message_at desc)`, `(conversation_id, sequence_no)`, `(owner_admin_id, created_at desc)`, `(status, next_run_at)` для automation, `(occurred_at desc)` и `(owner_admin_id, occurred_at desc)` для аудита.
8. Внешние ключи с `on delete restrict` для owner; деактивация пользователя не удаляет историю.

### 7.3 RLS и права

1. На каждой новой таблице включить RLS.
2. Отозвать все права у `anon` и `authenticated`; не создавать политики для прямого PostgREST из браузера.
3. Выдать доступ только `service_role`; все API routes выполняются server-side.
4. Browser никогда не передаёт `owner_admin_id` как авторитетное право: сервер берёт его из `requireAdminSession()`.
5. Правило чтения проверяется в каждом route: admin — только owner; super admin — все; seller — 403.
6. `assistant_audit_events` и `assistant_messages` не обновлять и не удалять через прикладные API. Редакция чувствительных данных выполняется отдельным audited workflow, не `UPDATE content`.

### 7.4 Связь с существующим `audit_log`

Оставить существующий `audit_log` системным журналом и дублировать туда только компактные ссылки на ключевые события (`assistant.conversation.created`, `assistant.run.completed`, `assistant.action.approved`, `assistant.automation.failed`). Полный transcript и tool arguments хранить только в новых специализированных таблицах — иначе `v_audit_log` станет медленным и опасно широким.

## 8. API-контракты

Все маршруты работают в Node runtime, проверяют сессию прежде обращения к данным, валидируют тело и ограничивают размер запроса.

| Метод и маршрут | Назначение | Авторизация |
|---|---|---|
| `GET /api/admin/assistant/conversations` | Список только личных чатов | admin/super admin, owner из session |
| `POST /api/admin/assistant/conversations` | Новый личный чат | admin/super admin |
| `GET /api/admin/assistant/conversations/:id` | Transcript | owner или super admin |
| `POST /api/admin/assistant/conversations/:id/messages` | Новый запрос и старт run | только owner |
| `POST /api/admin/assistant/runs/:id/cancel` | Отмена ожидающего run | только owner |
| `GET /api/admin/assistant/automations` | Личные правила | owner |
| `POST/PATCH /api/admin/assistant/automations/:id` | Создание/редактирование/пауза личного правила | owner; super admin только с audit reason |
| `POST /api/admin/assistant/action-drafts/:id/approve` | Явное подтверждение | owner либо super admin от своего имени |
| `GET /api/admin/assistant/audit` | Все чаты и события с фильтрами | только super admin |
| `GET /api/admin/assistant/audit/export` | Асинхронный ограниченный экспорт | только super admin |

Ошибки: `401` нет сессии, `403` нет роли/владения, `404` объект скрыт от чужого admin, `409` конфликт sequence/status, `413` слишком длинное сообщение, `429` лимит, `503` провайдер/контур временно недоступен.

## 9. Оркестратор AI и данные

### 9.1 Выбор провайдера — отдельная развилка

LLM-провайдер, модель, регион обработки, договор обработки данных, лимиты и бюджет **не согласованы**. Их нельзя выдумывать в коде.

До интеграции нужен отдельный короткий decision record:

1. утверждённый провайдер и модель;
2. правила передачи персональных данных;
3. лимит стоимости на пользователя/день и сеть/месяц;
4. policy хранения prompts/responses;
5. ключи только в server environment, никогда в клиенте, git или логах.

### 9.2 Allowlist инструментов MVP

Помощник не получает SQL, service role, HTTP-клиент или shell. Он вызывает строго типизированные server-side функции:

- `get_photo_report_summary(date, store_ids?)`;
- `get_photo_report_store_detail(store_id, from, to)`;
- `get_assigned_feedback(owner_admin_id, filters)`;
- `get_feedback_status_summary(filters)`;
- `get_admin_personal_tasks(owner_admin_id)`;
- `get_user_visible_stores(owner_admin_id)`.

Каждая функция принимает контекст session, ещё раз проверяет RBAC, возвращает минимальный набор полей и метаданные свежести. Сырые тексты, фото, персональные контакты и секреты не передаются модели по умолчанию.

### 9.3 Защита от prompt injection

1. Данные из feedback и комментариев — недоверенный контент, не системные инструкции.
2. В system prompt запретить следовать инструкциям из retrieved data и раскрывать секреты.
3. Tool calls валидируются JSON schema до выполнения.
4. Все tool names и максимальные параметры allowlisted; никаких произвольных URL/SQL.
5. Ответ проверяется на запрещённые типы данных перед показом/сохранением.
6. Модель не может сама создать, удалить, отправить или изменить бизнес-объект.

## 10. Автоматизации

### 10.1 Типы MVP

| Автоматизация | Владелец | Расписание | Результат | Внешний эффект |
|---|---|---|---|---|
| Утренний контроль фотоотчётов | конкретный admin | ежедневно, Киев | личная карточка/чат-результат | нет |
| Мои просроченные задачи | конкретный admin | рабочие дни | личная сводка | нет |
| Изменения по закреплённым магазинам | конкретный admin | 1 раз/день | личная сводка | нет |
| Контроль ошибок автоматизаций | super admin | ежедневно | список failed runs | нет |

### 10.2 Исполнение

1. Проверить доступный механизм планировщика (существующий Vercel cron и его лимиты) до проектирования очереди.
2. Cron только выбирает готовые `active` правила с `next_run_at <= now()`; не кладёт бизнес-логику в cron handler.
3. Для каждого запуска создать `assistant_automation_runs` с idempotency key `(automation_id, scheduled_at)`.
4. Заблокировать параллельные дубли через уникальный ключ/transaction lock.
5. Run запускает тот же read-only оркестратор, но с owner context.
6. Обновить `last_run_at`, `next_run_at`, status и audit atomically.
7. Retry: максимум 2 попытки только при временных `provider_timeout`/`network`; логические/RBAC ошибки не повторять.
8. После трёх подряд failed запусков автоматически `pause` с видимой причиной и событием super admin.

### 10.3 Действия с эффектом

Автоматизация может только создать `assistant_action_drafts`. Создание задачи, уведомление, изменение статуса, экспорт, Telegram или email требуют отдельного подтверждения человека. Авто-подтверждение запрещено.

## 11. Пошаговая реализация и ворота качества

К следующему этапу не переходить, пока не выполнен критерий текущего.

### Этап A. Принять решения и карту данных

1. Утвердить provider/model/region/budget/retention.
2. Зафиксировать список read-only tool функций и владельцев данных.
3. Определить retention: например, transcript и audit хранятся X месяцев; точный срок утверждает владелец данных.
4. Снять актуальный readback версии PostgreSQL, последней миграции, RLS и действующих cron.

**Готово, когда:** есть decision record, список tools и SQL-readback как приложение к плану.

### Этап B. Спроектировать и проверить миграцию

1. Создать одну forward-only migration в `feedback-admin/supabase/` с таблицами, constraints, индексами, RLS, revoke/grant и комментариями.
2. Добавить явный rollback-документ: до появления production данных — drop новых объектов; после — только disable функций и retention workflow, не удаление истории.
3. Прогнать миграцию на staging, затем readback: наличие таблиц, RLS=true, 0 прав у anon/authenticated, только service role.

**Готово, когда:** migration SQL применима дважды без ошибки там, где допустим `if not exists`; constraints и RLS readback совпадают с разделом 7.

### Этап C. Server foundation и аудит

1. Создать типы статусов, ownership guard, request ID и redaction helper.
2. Добавить `logAssistantAudit()`; не применять fire-and-forget для критичных transcript/run записей — их создание должно быть подтверждено транзакцией.
3. Добавить маршруты conversations/messages с owner guard.
4. Реализовать pagination, max message length и per-admin rate limits.

**Готово, когда:** чужой conversation нельзя угадать по UUID; каждый успешный и неуспешный запрос имеет audit event с request ID.

### Этап D. Read-only AI orchestration

1. Внедрить согласованный provider только server-side.
2. Добавить allowlisted tools, schemas и data-freshness metadata.
3. Реализовать states `queued → running → completed|failed|cancelled`.
4. Сохранить answer и sources до отдачи UI; при ошибке сохранять безопасный error code.

**Готово, когда:** модель не может вызвать неразрешённый tool, SQL, URL или write action; answers имеют источники/время данных.

### Этап E. UI персонального чата

1. Добавить sidebar route `/admin/assistant` по текущему дизайну Ant Design/`AdminShell`.
2. Добавить список личных бесед, чат, streaming/status, sources, retries, archive.
3. Добавить states error/empty/loading/permission/rate-limit.
4. Убедиться, что клиент не получает чужие IDs в списке, preload или error details.

**Готово, когда:** два admins в независимых браузерных сессиях не видят пересечений и не могут открыть URL друг друга.

### Этап F. Super-admin аудит

1. Добавить `/admin/assistant/audit` как super-admin-only route и API.
2. Ввести серверные filters, cursor pagination, Drawer деталей, экспорт job.
3. Показывать read-only transcript с явным owner и author каждого сообщения.
4. Добавить отключение automation с `reason` и audit trail.

**Готово, когда:** super admin видит полный журнал, admin получает 403, а super admin не может послать реплику как owner.

### Этап G. Черновики действий и автоматизации

1. Включить только `draft` action proposals, затем explicit approval API.
2. Реализовать таблицы автоматизаций, idempotency и cron handler.
3. Добавить pause, retry policy, failure threshold, журнал runs.
4. Начать с одного read-only расписания и staging изолированных данных.

**Готово, когда:** повтор cron не создаёт дублей, auto-run ничего не меняет во внешних системах, все события видны owner и super admin.

### Этап H. Приёмка и релиз

1. Полный test/typecheck/lint/build.
2. Staging E2E с минимум двумя admin и одним super admin.
3. Security review ownership/RLS/prompt-injection/redaction/rate limits.
4. Нагрузочный тест с целевым профилем, согласованным отдельно.
5. Preview, затем production только после утверждения commit SHA.

**Готово, когда:** все критичные тесты passed, migrations readback verified, production smoke прошёл без боевых автоматических действий.

## 12. Матрица обязательных тестов

| ID | Проверка | Ожидаемый результат |
|---|---|---|
| A-01 | Admin создаёт чат | owner = session.uid, audit создан |
| A-02 | Admin читает свой чат | 200, только собственные сообщения |
| A-03 | Admin открывает UUID чужого чата | 404/403 без утечки существования/содержимого |
| A-04 | Super admin читает любой чат | 200, read-only transcript |
| A-05 | Seller вызывает assistant API | 403 |
| A-06 | Подмена `owner_admin_id` в POST body | игнорируется/400, owner не меняется |
| A-07 | Две параллельные реплики одного чата | последовательность уникальна, конфликт 409 или сериализация |
| A-08 | Слишком длинный prompt | 413, run не создан |
| A-09 | Rate limit владельца | 429, audit с типом отказа |
| A-10 | Provider timeout | run `failed`, безопасный error code, без ложного ответа |
| A-11 | Prompt injection из feedback | tool/write action не выполнен, ответ не раскрывает секреты |
| A-12 | Модель вызывает tool вне allowlist | блокировка до I/O, аудит отказа |
| A-13 | Tool с чужим store ID | server RBAC блокирует независимо от модели |
| A-14 | Ответ с источниками | сохранены `assistant_run_sources`, UI показывает freshness |
| A-15 | Логирование | запрос, run, tool и ответ имеют request ID, нет secrets/data URL |
| A-16 | RLS readback | RLS включён на всех таблицах |
| A-17 | Права схемы | `anon`/`authenticated` не имеют select/insert/update/delete |
| A-18 | Action draft | AI создаёт только draft, рабочая задача отсутствует |
| A-19 | Owner подтверждает draft | действие создано один раз, audit содержит approver |
| A-20 | Super admin подтверждает чужой draft | owner и approver различаются, impersonation отсутствует |
| A-21 | Automation idempotency | один scheduled slot создаёт один run |
| A-22 | Automation failure | max retry соблюдён, после порога правило paused |
| A-23 | Automation owner isolation | результат попадает только владельцу |
| A-24 | Super-admin audit filter/export | выборка полная, экспорт redacted |
| A-25 | Admin audit route | 403 |
| A-26 | Browser E2E admin A/B | у A и B разные списки/URL не пересекаются |
| A-27 | Browser E2E super admin | видит оба чата и owner labels |
| A-28 | Regression существующей админки | users, tasks, photo report, audit и notifications работают |
| A-29 | Performance | список чатов p95 и отправка prompt p95 соответствуют заранее принятому SLO |
| A-30 | Recovery | provider выключен: UI даёт понятную ошибку, данные чата сохраняются |

## 13. Наблюдаемость и отчётность

### Метрики

- количество runs по admin/day;
- p50/p95 latency;
- provider/tool error rate;
- rate-limit rejections;
- стоимость/токены, если provider отдаёт эти данные;
- automation success/failure/retry/paused;
- число попыток доступа к чужому conversation.

### Алерты

1. provider error rate выше согласованного порога;
2. три подряд failed runs одной автоматизации;
3. ownership/RLS violation attempt;
4. budget threshold 80%/100%;
5. очередь/cron задержан больше согласованного SLA.

### Итоговый отчёт каждой поставки

Один Markdown-файл: commit SHA, migration ID, preview/production URL, таблица тестов `passed/failed/blocked`, RLS/grants readback, примеры redacted audit events, известные ограничения и rollback.

## 14. Открытые решения до начала разработки

1. Какой LLM-провайдер, модель, регион и бюджет утверждены?
2. Допустимо ли передавать текст feedback внешнему провайдеру или нужен только агрегированный/обезличенный контекст?
3. Срок хранения полного transcript и экспортов?
4. Нужны ли super-admin комментарии внутри чужого чата или достаточно только просмотра? Рекомендация MVP: только просмотр.
5. Какой точный список read-only данных доступен каждому admin?
6. Какая целевая нагрузка: число admins, запросов/минуту, автоматизаций/день и максимальная задержка?
7. Нужны ли в следующей фазе внешние уведомления? Если да, кто и каким действием их подтверждает?

До ответа на эти вопросы разрешено реализовывать только каркас, изоляцию, аудит и mock provider на staging; реальный provider, отправка данных и production automation остаются заблокированными.

