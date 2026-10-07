# «Надати показники» — бизнес-процесс и технический контракт

**Дата сверки с исходным кодом:** 07.10.2026. **Ветка:** `codex/utility-photo-report`.

**Статус:** 056 и 057 применены владельцем в production; read-only проверка подключённой БД подтвердила структуру 056, а после 057 — текст функции и права, см. [протокол readback](UTILITY_READINGS_PRODUCTION_READBACK_2026-10-07.md). Фактическое выполнение RPC с фото, staging и сквозная доставка не проверены. Раздел пока нельзя считать работающим в production. Все миграции выполняет только владелец проекта.

Этот документ описывает **текущее поведение кода**. Требования, которые ещё не реализованы или не проверены, помечены **«Требуется»**. План запуска и макеты: [UTILITY_PHOTO_REPORT_PLAN_2026-10-07.md](UTILITY_PHOTO_REPORT_PLAN_2026-10-07.md), [utility-photo-report-mockups.svg](utility-photo-report-mockups.svg).

## 1. Назначение и границы

Продавец передаёт бухгалтерии фотографии по одной из четырёх услуг: `electricity` («Електроенергія»), `water` («Вода»), `heating` («Опалення»), `other` («Інші послуги»). Путь в приложении: главная карточка «Надати показники» → карточка услуги → камера или галерея → просмотр фото → отправка. По устройству ввода это аналог «Фото звіту», но хранение, таблицы, статус проверки и Telegram-адресат отдельные.

- Ввод числа показания, тарифа, суммы, номера счётчика и OCR **отсутствует**. Название раздела не означает, что система распознала показание на фото.
- В одном новом подании 1–3 фото и необязательный комментарий до 1000 символов. У обычного «Фото звіту» минимум 6 фото; это правило здесь не действует.
- Четыре категории показываются каждому доступному магазину. Обязательность конкретной категории для конкретного магазина не задана. Статус «немає фото» не равен нарушению.
- Месяц нужен для группировки и истории. Первое подание идёт в текущий месяц автоматически; ниже четырёх карточек продавец видит ранее поданные месяцы и может открыть старую категорию. Админка позволяет выбрать созданный месяц.
- Срок **первой** подачи — последний календарный день месяца до `23:59:59.999` по `Europe/Kyiv`. Число автоматически получается 28, 29, 30 или 31. Если запись уже есть, её можно заменить новой версией без ограничения срока, включая статусы `verified` и `needs_correction`.
- Подача создаёт запись в Supabase. Пересылка в Telegram асинхронная; сообщение «Фото збережено» не означает доставку бухгалтеру.

Пример: продавец магазина №10 в октябре отправляет 2 фото воды. В БД появляется версия 1 пары `(магазин 10, октябрь, water)` и задача доставки. В ноябре он открывает в истории октябрьскую воду, снимает новое фото и отправляет версию 2. Версия 1 и её решение администратора остаются в истории. Первая подача за октябрь в ноябре не разрешена.

## 2. Источники истины и владельцы данных

| Источник | Что берём | Для чего | Ограничение |
|---|---|---|---|
| Подписанная сессия приложения, `feedbackgb.users` | `id`, `role`, `is_active`, `store_id` | Кто отправляет и активен ли пользователь | Сессия и запись пользователя проверяются при запросе; PIN и токен в новый модуль не копируются. |
| `feedbackgb.seller_store_permissions` | `seller_id`, `store_id`, `revoked_at` | Активный доступ продавца к магазину замены | Разрешение доказывает право выбора, но не факт смены. |
| `feedbackgb.v_stores` | `id`, `name`, `is_active` | Список и название активных магазинов | Нельзя подать для неактивного магазина. |
| `categories.spots` | `spot_id` | Внешний ключ `store_id` новых таблиц | Точное соответствие ID должно пройти readback после применения миграции. |
| `feedbackgb.utility_periods` | `period_start`, `period_end`, `due_at`, `status` | Внутренний месячный ключ и серверный deadline | Создаётся при первом авторизованном запросе текущего месяца через RPC. |
| Приватный Storage bucket `utility-reading-photos` | Файлы JPEG/PNG/WebP | Хранение фото | Публичный доступ выключен; админ получает signed URL на 10 минут. |
| `utility_submissions` + `utility_photos` | Факт подачи, версия, порядок фото | Основной источник отчётности | Telegram — копия для работы бухгалтера, не единственный архив. |
| `utility_delivery_jobs` | Очередь, состояние, попытки, `message_ids` | Контроль Telegram-доставки | `sent` не равен `verified`. |
| `utility_events` | `submitted`, `verified`, `needs_correction` | История бизнес-действий | Сейчас не является журналом всех технических ошибок. |

База у серверных клиентов приложений настроена на схему `feedbackgb` (`feedback-app/src/lib/supabase.ts`, `feedback-admin/src/lib/supabase.ts`). Объекты в `categories` используются только там, где они прямо указаны в SQL внешним ключом.

## 3. Бизнес-роли и процессы

| Роль | Может | Не означает |
|---|---|---|
| Продавец | Отправить фото для активного основного магазина или магазина с действующим разрешением; увидеть результат проверки текущей категории. | Разрешение на замену не подтверждает физическое присутствие. |
| Администратор / super admin | Открыть обзор, фото и версии; подтвердить или вернуть текущее `submitted` с причиной; серверный контракт также допускает подачу от имени администратора. | Подтверждение админом не доказывает, что бухгалтер прочитал Telegram. |
| Бухгалтер | Получить копию текста и фотографий в отдельном рабочем Telegram-чате после настройки адресата. | Чтение Telegram не меняет `review_status` в БД. |
| Владелец проекта | Выполнить все миграции и назначить отдельный чат/ответственного за сверку ошибок доставки. | Применение SQL само по себе не включает интерфейс и worker. |

### 3.1 Подача продавцом

1. Главная карточка открывает `/utility-readings` по умолчанию; явное `NEXT_PUBLIC_UTILITY_READINGS_ENABLED=false` скрывает раздел.
2. UI запрашивает `/api/utility-readings/stores`. Продавец видит только активные магазины из основного `store_id` и активных разрешений; при нескольких выбирает магазин.
3. UI запрашивает `/api/utility-readings?store_id=…`: сервер проверяет право магазина, создаёт или получает текущий месячный период, отдаёт deadline и последние версии по четырём категориям, а также первую страницу истории старых текущих поданий (20 строк). Кнопка «Показати ще» запрашивает следующие строки через `history_offset`.
4. Пользователь открывает текущую категорию или ранее поданную категорию старого месяца, снимает/выбирает 1–3 фото. На этом экране общий `PhotoInput` показывает отдельные кнопки камеры и галереи; обычный «Фото звіт» сохраняет прежний ввод. Фото сжимается на устройстве до 1600 px и целевого предела 650 KiB. Пользователь может удалить фото. Переключение магазина и уход назад блокируются на время сжатия; ответ устаревшего запроса истории другого магазина не добавляется в текущий список.
5. При отправке форма последовательно загружает каждое фото через `POST /api/utility-readings/uploads`. Сервер ограничивает тело примерно 2 MiB + 64 KiB multipart-накладных данных, проверяет фактический файл до 2 MiB и сигнатуру JPEG/PNG/WebP, права магазина, период и лимит 30 незакреплённых фото на пользователя/категорию. После дедлайна или закрытия периода upload допустим только для уже существующей текущей подачи той же пары магазин/период/категория.
6. Каждое принятое фото сохраняется в private Storage и получает строку `utility_uploads`, действительную для подания 24 часа. При ошибке записи строки сервер пытается удалить файл.
7. `POST /api/utility-readings/submissions` получает 1–3 `upload_ids`, комментарий и `client_submission_id`. SQL-функция из 057 в одной транзакции повторно проверяет активного пользователя, магазин, правило срока и принадлежность каждого фото, создаёт версию, привязки фото, задачу доставки и событие `submitted`. Текст установленной RPC прошёл read-only проверку; фактическое выполнение этого сценария не проверено.
8. После успешного ответа UI показывает ID подачи. Telegram-статус в ответе — текущее состояние очереди, обычно `pending`; это не обещание мгновенной доставки.

Повтор того же `client_submission_id` и того же SHA-256 полезной нагрузки возвращает тот же ID подачи. Тот же ID с другой нагрузкой вызывает конфликт. Если отдельное фото загружено, но пакет не подан, cleanup удаляет его после 24 часов. Клиентский массив upload IDs в пределах текущей попытки позволяет повторить запрос после сетевой ошибки без повторной загрузки уже успешно загруженных фото.

### 3.2 Проверка администратором

1. `/admin/utility-readings` загружает текущий период, список созданных месяцев и активные магазины. Администратор выбирает месяц; матрица «магазин × категория» перестраивается для него.
2. Обзор показывает число фото, последнюю текущую версию и статус проверки украинским текстом. Колонка доставки появляется только на этапе Telegram. Рядок без фото — только отсутствие записи.
3. Деталь по ID получает фото через signed URLs, версии, события и статус Telegram. Причина возврата видна в детали. Администратор может подтвердить только текущее подание со статусом `submitted` или вернуть его с непустой причиной. У старой версии кнопки проверки скрыты; установленная RPC также отклоняет её проверку.
4. SQL RPC записывает решение и событие `verified`/`needs_correction`. Продавец видит причину возвращения на карточке категории.
5. Новая подача для уже существующей пары магазин/месяц/категория создаёт следующую версию независимо от прежнего статуса и срока. Старое фото/подание не перезаписывается.

### 3.3 Telegram и очистка

`feedback-admin` — единственный текущий диспетчер. В первом production-релизе `/api/cron/utility-dispatch` не зарегистрирован в `vercel.json`: Telegram отложен до отдельного этапа. Worker берёт **одну** готовую задачу за вызов. Для будущей отправки обязательны `UTILITY_READINGS_ENABLED=true`, `TELEGRAM_BOT_TOKEN`, отдельный `TELEGRAM_UTILITY_CHAT_ID` и cron-авторизация. Общий `checkCronAuth` теперь в production требует `CRON_SECRET` и корректный Bearer-токен; один заголовок `x-vercel-cron: 1` больше не даёт доступ. Локальные тесты этого правила прошли в обоих приложениях; production env и фактический cron не проверялись. Нет запасного адресата из обычного фотозвіту. [Vercel указывает UTC для cron](https://vercel.com/docs/cron-jobs) и [рекомендует `CRON_SECRET`](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Worker посылает текст с магазином, услугой, периодом, автором, версией, ID подачи и комментарием, затем фото ответом на текст: одно через `sendPhoto`, 2–3 через `sendMediaGroup`. Каждая версия имеет собственный delivery job; уже отправленные старые сообщения остаются в чате и различаются номером версии. После каждого успешного шага worker сохраняет Telegram `message_id`. Конкретный чат пока не задан (TD-002 в `feedback-admin/docs/TECHNICAL_DEBT.md`); реальную доставку не проверяли.

[Telegram Bot API](https://core.telegram.org/bots/api#sendmediagroup) допускает 2–10 объектов в одном `sendMediaGroup` и возвращает массив сообщений. **Требуется до запуска Telegram:** проверить тариф/план Vercel и выбрать допустимый график; [документация Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs) ограничивает Hobby cron одним запуском в день. Vercel также не повторяет неудачную cron-инвокацию автоматически, поэтому состояние очереди и ошибки необходимо наблюдать отдельно.

Cron `/api/cron/utility-cleanup` идёт ежедневно в `02:15 UTC`, берёт до 100 просроченных незакреплённых загрузок, удаляет файлы и затем строки. При ошибке отдельного файла/строки продолжает цикл, пишет безопасное событие и увеличивает `failed` в ответе. Он включается флагом админки `NEXT_PUBLIC_UTILITY_READINGS_ENABLED`, отдельно от Telegram worker; для первого этапа нужны работающий cron и `CRON_SECRET`.

## 4. Схемы Mermaid

### 4.1 Контур системы

```mermaid
flowchart LR
  Seller[Продавец в Telegram WebView] --> App[feedback-app]
  Admin[Администратор] --> Panel[feedback-admin]
  App --> API1[API utility-readings]
  Panel --> API2[Admin API utility-readings]
  API1 --> DB[(Supabase feedbackgb)]
  API1 --> Storage[(Private Storage)]
  API2 --> DB
  API2 --> Storage
  DB --> Worker[feedback-admin cron dispatcher]
  Storage --> Worker
  Worker --> TG[Отдельный Telegram-чат бухгалтерии]
  Cleaner[feedback-admin cleanup cron] --> DB
  Cleaner --> Storage
```

### 4.2 Последовательность подачи и доставки

```mermaid
sequenceDiagram
  actor P as Продавец
  participant UI as feedback-app
  participant API as Seller API
  participant DB as Supabase DB
  participant S as Private Storage
  participant W as Dispatcher
  participant T as Telegram
  P->>UI: Выбирает магазин, категорию и фото
  UI->>API: GET stores + текущий период + история
  API->>DB: Проверка пользователя/магазина, ensure period
  DB-->>UI: period_id, due_at, latest, history
  P->>UI: Текущая карточка или старый месяц с поданием
  loop 1–3 фото
    UI->>API: POST uploads
    API->>S: Сохранить файл
    API->>DB: Создать utility_uploads
    API-->>UI: upload_id
  end
  UI->>API: POST submissions с upload_ids
  API->>DB: submit_utility_photos (атомарно)
  DB-->>UI: submission_id + pending job
  UI-->>P: Фото сохранено
  W->>DB: claim_utility_delivery_job
  W->>S: Скачать фото
  W->>T: Текст + фото
  T-->>W: message_id
  W->>DB: message_ids + state
```

### 4.3 Данные и версии

```mermaid
erDiagram
  utility_periods ||--o{ utility_submissions : period_id
  utility_periods ||--o{ utility_uploads : period_id
  utility_submissions ||--|{ utility_photos : submission_id
  utility_uploads ||--o| utility_photos : upload_id
  utility_submissions ||--|| utility_delivery_jobs : submission_id
  utility_submissions ||--o{ utility_events : submission_id
  utility_submissions ||--o| utility_submissions : supersedes_id
  utility_periods {
    uuid id PK
    date period_start
    date period_end
    timestamptz due_at
    text status
  }
  utility_submissions {
    uuid id PK
    int store_id
    uuid period_id FK
    text category
    uuid submitted_by
    int revision
    text review_status
    uuid client_submission_id
    timestamptz superseded_at
  }
  utility_uploads {
    uuid id PK
    uuid user_id
    text storage_path
    timestamptz expires_at
    uuid claimed_by
  }
  utility_delivery_jobs {
    uuid id PK
    text state
    int attempts
    jsonb message_ids
    text last_error_code
  }
```

### 4.4 Состояния доставки

```mermaid
stateDiagram-v2
  [*] --> pending: SQL создаёт job
  pending --> sending: cron claim
  retryable_failed --> sending: следующая попытка
  sending --> sent: текст и все фото подтверждены
  sending --> retryable_failed: Telegram 429/5xx до первого подтверждённого message_id
  sending --> permanent_failed: другой Telegram HTTP отказ до первого message_id
  sending --> uncertain: частичный успех, timeout или иной неясный исход
  uncertain --> [*]: ручная сверка обязательна
  sent --> [*]
```

`sending` при смерти worker сейчас автоматически не переводится в новый статус: `locked_until` записывается, но функция claim не подбирает зависшие `sending`. Оператору нужна ручная диагностика; слепой повтор может создать дубль в чате.

## 5. Supabase: контракт миграций 056 и 057

056 создаёт шесть таблиц и четыре RPC в схеме `feedbackgb`, private bucket и индексы. На всех шести таблицах включается RLS; прямые права `anon` и `authenticated` отозваны, `service_role` получает операции с таблицами и выполнение RPC. Серверные API дополнительно проверяют активную сессию и роль. Указанные объекты и права 056 подтверждены read-only в подключённой БД после сообщения владельца о production-применении; поведение API/RPC на реальных запросах ещё не проверено.

**057 применена владельцем в production:** `057_utility_resubmission_and_three_photos.sql` заменяет только тело `submit_utility_photos(...)`. Новая функция принимает 1–3 фото. Первое подание разрешено только для текущего открытого месяца до `due_at`; если текущая версия для пары магазин/месяц/категория уже есть, новая версия разрешена без срока и независимо от `review_status`. Advisory lock и проверка идемпотентности остаются перед этой проверкой. Read-only `057_utility_resubmission_and_three_photos_readback.sql` подтвердил ключевые признаки установленной функции и права; выполнение RPC с данными ещё не проверено. Повторный запуск 056 запрещён.

| Таблица | Зерно и ключевые поля | Ограничения/смысл |
|---|---|---|
| `utility_periods` | одна строка на непересекающийся месячный интервал; `period_start`, `period_end`, `due_at`, `status` | `ensure_current_utility_period()` рассчитывает границу в Киеве и берёт advisory lock при создании. |
| `utility_submissions` | одна версия `(store_id, period_id, category, revision)`; автор, источник, комментарий, проверка | Частичный уникальный индекс разрешает лишь одну строку с `superseded_at IS NULL` на магазин/период/категорию. `client_submission_id` уникален. |
| `utility_uploads` | одно временное фото; владелец, магазин, период, категория, MIME, bytes, SHA-256, путь | `expires_at` по умолчанию через 24 часа, `claimed_by` указывает на подание. |
| `utility_photos` | связь одного `upload_id` с одним поданием; для новых поданий после 057 порядок 0–2 | Уникальны `(submission_id, sort_order)` и `upload_id`. |
| `utility_delivery_jobs` | один job на подание | Очередь и итог Telegram: `state`, `attempts`, `next_attempt_at`, `locked_until`, `chat_id_snapshot`, `message_ids`, `last_error_code`, `sent_at`. |
| `utility_events` | событие на подание | Сейчас RPC пишет `submitted`, `verified`, `needs_correction`; ошибки API и worker сюда не пишутся. |

RPC: `ensure_current_utility_period()` создаёт/возвращает текущий период; `submit_utility_photos(...)` атомарно создаёт версию, связывает фото и ставит доставку; `review_utility_submission(...)` принимает решение админа; `claim_utility_delivery_job(chat_id)` резервирует одну задачу через `FOR UPDATE SKIP LOCKED`.

**Пример периода:** для октября 2026 `period_start=2026-10-01`, `period_end=2026-10-31`, `due_at=2026-10-31 23:59:59.999 Europe/Kyiv` (в БД хранится `timestamptz`). Для февраля невисокосного года конец 28-го, високосного — 29-го. Проверен расчёт SQL-выражения для 28/29/30/31 и киевского перехода времени; установленная RPC ещё не проверена.

**Пример пути файла:** `utility/<store_id>/<period_uuid>/<category>/<upload_uuid>.jpg`. Это служебный путь, не публичная ссылка. Выдача админке идёт через `createSignedUrls(..., 600)`.

## 6. Маршруты и ошибки API

| Среда/маршрут | Вход → выход | Основные проверки и возможные ответы |
|---|---|---|
| App `GET /api/utility-readings/stores` | Сессия → `{stores}` | Активность/роль, `v_stores`, разрешения; `401`, `403`, `500`, `503`. |
| App `GET /api/utility-readings?store_id=N&history_offset=0` | Магазин → `{period, latest, history, history_has_more}` | Право магазина, `ensure_current_utility_period`; история по 20 текущих поданий старых месяцев за запрос, смещение 0–10000; `400`, `403`, `500`, `503`. |
| App `POST /api/utility-readings/uploads` | multipart: `store_id`, `period_id`, `category`, `client_submission_id`, `photo` → `{upload_id, bytes, mime}` | 1 файл, 2 MiB, сигнатура, право, 30 pending; после срока — только при наличии прежней текущей подачи для этой пары; `400`, `403`, `409`, `413`, `429`, `500`, `503`. |
| App `POST /api/utility-readings/submissions` | JSON: магазин, период, категория, комментарий, UUID идемпотентности, 1–3 UUID фото → `{submission_id, saved, telegram_status}` | Проверка `raw.length <= 16384` символов, право, RPC; `400`, `403`, `409`, `413`, `422`. До 057 RPC может отказать в разрешённом новой логикой повторе. |
| Admin `GET /api/admin/utility-readings/config` | Сессия админа → магазины, до 1000 созданных периодов и текущий ID | `403`, `500`, `503`, `507`; результат ограничен 1000 магазинами и 1000 периодами. |
| Admin `GET /api/admin/utility-readings/coverage?period_id=UUID` | Период → строки магазин × 4 категории | `400`, `403`, `500`, `507`; выборки магазинов, текущих поданий, фото и jobs ограничены 1000 строками, превышение явно отвергается. |
| Admin `GET /api/admin/utility-readings/submissions?id=UUID` | ID → подание, фото с временными ссылками, версии, события, доставка | `400`, `403`, `404`, `500`; ошибка выдачи ссылок — `500 signing_failed`. |
| Admin `POST /api/admin/utility-readings/submissions` | ID, `verified`/`needs_correction`, причина → `{ok:true}` | Нужна активная роль admin/super_admin; причина возврата обязательна; `400`, `403`, `409`, `413`. |
| Cron `GET /api/cron/utility-dispatch` | Авторизованный cron → итог одного job | Выключенный флаг: skipped; нет чат ID/токена: `503`; ошибки claim/state: `500`; результат `sent`/ошибка/`uncertain`. После обработанного job даже при `ok:false` текущий маршрут возвращает HTTP 200: мониторинг должен читать JSON/БД, а не только HTTP-статус. |
| Cron `GET /api/cron/utility-cleanup` | Авторизованный cron → `{ok, cleaned, failed, scanned}` | До 100 незакреплённых просроченных файлов; частичная ошибка даёт `ok:false`, `failed>0` при HTTP 200. |

Страницы: app `/utility-readings`; admin `/admin/utility-readings`. Первый этап доступен по умолчанию; явное `NEXT_PUBLIC_UTILITY_READINGS_ENABLED=false` скрывает страницы и пункты меню, серверные API проверяют то же правило. В админке вкладка и колонка Telegram видны только если `UTILITY_READINGS_ENABLED=true`, заданы `TELEGRAM_UTILITY_CHAT_ID` и `TELEGRAM_BOT_TOKEN`; иначе показано уведомление об отсутствии пересылки. Это проверка конфигурации, не подтверждение работающего cron. `UTILITY_READINGS_ENABLED` управляет только Telegram worker. Cleanup следует правилу доступа админки и работает без чата.

Таблица перечисляет маршрутные ошибки, не исчерпывая общие ответы: seller API также могут вернуть `404 feature_disabled`, `401 unauthenticated`, `403 forbidden`, `503 backend_unavailable`; admin API — `404 feature_disabled`, `403 forbidden`, `503 backend_unavailable`; cron — `401 unauthenticated` или `503 cron_secret_not_configured` по общему `checkCronAuth`. Без `CRON_SECRET` production-запуск не следует считать безопасно настроенным.

## 7. Ошибки и логирование по всему маршруту

### 7.1 Что реально фиксируется сейчас

**Обновление 07.10.2026 после реализации шага 8:** seller/admin API и оба cron используют `utilityTrace`: каждый ответ получает `x-request-id`; ошибки пишутся как JSON-события с ограниченным набором служебных полей. ID загрузок, `client_submission_id`, подачи и job связывают этапы. Эти записи существуют в логах приложения после развёртывания новой версии; локальные тесты не доказывают наличие production-логов.

| Участок | Текущее поведение кода | Чего не хватает |
|---|---|---|
| Выбор магазина/периода | API отдаёт стабильный `error`, HTTP-статус, `x-request-id`; отказ пишет JSON-событие. | Ошибку разрешения магазина на уровне `canUseUtilityStore` пока нельзя надёжно отличить от технического сбоя БД: функция возвращает только boolean. |
| Сжатие фото на устройстве | `PhotoInput` показывает ошибку и вызывает `console.error(e)` в клиенте. | Ошибка не коррелируется с серверной попыткой; нельзя класть в телеметрию фото или data URL. |
| Upload в Storage/БД | API возвращает коды и пишет отдельные события отказа Storage, записи метаданных и компенсации. При ошибке вставки пытается удалить файл. | Лог хранит `upload_id`, но не полный storage path; поиск сироты требует восстановления пути по известным частям или отдельного Storage-аудита. |
| Атомарная подача | RPC пишет `utility_events: submitted`; API пишет отдельный отказ RPC с `client_submission_id` и возвращает request ID. | Техническая причина не пишется в бизнес-аудит `utility_events`; свободный текст провайдера сознательно не логируется. |
| Проверка админом | RPC пишет бизнес-событие решения; API пишет структурированный отказ review/read/signing. | Нужна проверка на реальных staging-данных. |
| Telegram | Job хранит статус и message IDs; worker пишет события claim, packet/Telegram/ledger/state-write и `uncertain`, отдаёт `x-request-id`. | Нет автоматического разбора зависшего `sending`, алерта по `uncertain` и времени очереди. Обработанная ошибка job возвращает HTTP 200 с `ok:false`, что не гарантирует алерт по HTTP. |
| Cleanup | Ответ содержит `scanned`, `cleaned`, `failed`; ошибки отдельных удалений пишутся с upload ID. | Нужно подключить мониторинг `failed > 0`; HTTP 200 при частичном отказе остаётся по контракту маршрута. |

**Требуется до production:** проверить новые события в staging; назначить ответственного за `uncertain` и зависший `sending`, подключить алерт на `ok:false`/cleanup `failed`, определить мониторинг очереди. `utility_events` — бизнес-аудит, а не замена операционных логов. Клиентская ошибка сжатия пока остаётся только на устройстве.

В обычном фотозвіті есть локальный образец JSON-событий `logPhotoReport` в `feedback-app/src/app/api/feedback/route.ts`. Новый модуль использует отдельные однотипные helpers `utilityLog.ts` в двух приложениях: входящий `x-request-id` принимается только как UUID, иначе генерируется новый. Из произвольного объекта в событие проходят только разрешённые служебные ключи; поля фото, токена, комментария и URL отбрасываются.

### 7.2 Формат структурированного события

Каждый входящий запрос получает валидированный или сгенерированный `request_id`; он возвращается в заголовке ответа и попадает в каждую серверную запись. Для цепочки загрузок связь дополнительно дают `client_submission_id`, затем `submission_id` и `job_id`. Поля события:

```json
{
  "event": "utility.upload.storage_failed",
  "level": "error",
  "request_id": "7e5e72d2-8a62-440e-a744-ff54a03c7c11",
  "route": "POST /api/utility-readings/uploads",
  "phase": "storage_upload",
  "store_id": 10,
  "period_id": "fdb7a778-7437-4ee3-83ce-0d9967f4a944",
  "category": "water",
  "error_code": "storage_failed",
  "http_status": 503,
  "duration_ms": 382
}
```

Это **пример формата**, не реальный production-лог и не существующий request ID. В логах не хранить PIN, session cookie, Telegram token/chat ID, URL с подписью, фотографию, base64, комментарий/причину возврата, ФИО и тело запроса. Для диагностики допустимы служебные UUID, ID магазина, категория, код, фаза, длительность и количество фото. Worker нормализует неизвестные исключения до `unknown_delivery_error`; свободный текст провайдера не пишется.

### 7.3 Матрица обязательных событий и реакции

| Фаза | Событие при отказе | Уровень | Операционная реакция |
|---|---|---|---|
| session/access | `utility.access.denied` / `utility.access.backend_failed` | `warn` / `error` | Разделять ожидаемый отказ прав и ошибку БД; не раскрывать существование чужого магазина. |
| period | `utility.period.ensure_failed` / `utility.period.closed` | `error` / `info` | Проверить миграцию/readback или объяснить дедлайн. |
| client photo processing | `utility.photo.compress_failed` | клиентский диагностический код, без изображения | Пользователю предложить повторить фото; агрегировать лишь после отдельного согласованного клиентского сбора. |
| upload validation | `utility.upload.invalid` / `utility.upload.too_large` | `info` | HTTP 400/413, без тревоги по одиночному случаю. |
| upload storage | `utility.upload.storage_failed` | `error` | Искать Storage отказ по request ID; сверить отсутствие строки. |
| upload metadata/compensation | `utility.upload.record_failed`, `utility.upload.compensation_failed` | `error`/`critical` | При неудачном удалении файла нужен отдельный поиск сироты по пути/UUID. |
| submission RPC | `utility.submission.rejected` / `utility.submission.rpc_failed` | `info`/`error` | Отличать бизнес-конфликт от технического отказа; проверить атомарность. |
| admin read/review | `utility.admin.read_failed`, `utility.admin.sign_failed`, `utility.admin.review_failed` | `error` | Проверить RLS/Storage/RPC и ID подачи; не логировать signed URL. |
| worker claim | `utility.delivery.claim_failed` | `error` | Проверить функцию, backlog и доступ service role. |
| Telegram send | `utility.delivery.telegram_failed`, `utility.delivery.uncertain` | `error`/`critical` | По job ID сверить чат и `message_ids`; не повторять неопределённый исход автоматически. |
| worker state write | `utility.delivery.ledger_failed`, `utility.delivery.state_write_failed` | `critical` | Сверить Telegram и БД до повторной попытки. |
| cleanup | `utility.cleanup.storage_failed`, `utility.cleanup.row_failed` | `warn`/`error` | Сохранить ID upload, увеличить счётчик неудач, повторить следующий cron. |

Нужны агрегаты для мониторинга: число `pending`, возраст старейшего job, `retryable_failed`, `uncertain`, `sending` с истёкшим `locked_until`, доля `sent`, ошибки upload, доля неудачного cleanup. Порог алерта задаётся после измерения реального потока; в коде и документации пока нет подтверждённого SLA.

### 7.4 Разбор типовых ситуаций

| Симптом | Где искать | Как трактовать |
|---|---|---|
| Пользователь видит «Фото збережено», бухгалтер не видит сообщение | `utility_submissions` → `utility_delivery_jobs` по `submission_id`; флаг worker, chat ID, `state`, `last_error_code` | Факт подачи сохранён, доставка отдельная. При `uncertain` сначала сверять чат. |
| Приложение пишет «Не вдалося зберегти фото» | HTTP ответа uploads; есть ли `utility_uploads` и объект Storage | Клиентский текст общий; точная причина без структурированного лога пока ограничена кодом ответа. |
| «Термін минув» при повторе старой подачи | Версия `submit_utility_photos`, наличие текущего `utility_submissions`, `period_id` | По правилу 057 повтор разрешён без срока. Если ошибка возникнет после readback 057, проверить идентификатор БД, наличие прежней подачи и фактическую ветку RPC по журналам. |
| Job долго `sending` | `locked_until`, `message_ids`, Telegram-чат | Автоматического возврата в очередь нет; это защита от возможного дубля, нужна ручная сверка. |
| Фото есть в Storage, строки upload нет | Ошибка вставки `utility_uploads` и неуспешная компенсация | Текущий cleanup не найдёт такой файл по БД; нужна отдельная процедура сверки сирот. |

Примеры безопасных **read-only** запросов после применения миграции владельцем:

```sql
select id, submission_id, state, attempts, next_attempt_at,
       locked_until, message_ids, last_error_code, sent_at
from feedbackgb.utility_delivery_jobs
where submission_id = '<submission_uuid>'::uuid;

select id, store_id, period_id, category, revision, review_status,
       superseded_at, submitted_at
from feedbackgb.utility_submissions
where store_id = <store_id> and period_id = '<period_uuid>'::uuid
order by category, revision;

select state, count(*) as jobs, min(created_at) as oldest_created_at
from feedbackgb.utility_delivery_jobs
group by state order by state;
```

Не подставлять демонстрационные значения как реальные ID. Чат и message IDs сверяются ответственным человеком, которому разрешён доступ к этому чату. Ручные SQL-исправления статусов здесь не предписаны.

## 8. Проверки и границы достоверности

| Проверка | Фактическое состояние на 07.10.2026 |
|---|---|
| Сверка маршрутов, SQL и UI с исходниками | Выполнена при подготовке этой документации; позднее исправлены кнопки проверки старой версии, подписи статусов и выбор камеры/галереи. |
| Typecheck и production build обоих приложений | После последних UI-правок прошли в обоих приложениях. В admin build остались предупреждения ESLint в других разделах; предупреждения из изменённого utility workspace нет. |
| Автотесты | После последних UI-правок прошли 194/194 теста seller app и 19/19 целевых admin тестов utility/обычного Photo Report. Эти тесты не подтверждают поведение установленной RPC с реальными данными. |
| Миграция и readback новых таблиц/RPC | 056 подтверждена в production: 6 таблиц, 4 RPC, RLS, права, приватный bucket. После 057 read-only запрос подтвердил лимит 3, отсутствие старого запрета повторной подачи после подтверждения, наличие ветки первичной подачи и права `EXECUTE` только для service role. Дополнительно read-only проверка установленной `review_utility_submission` подтвердила `superseded_at is null and review_status = 'submitted'`. В подключённой БД сейчас 0 периодов, фото и поданий. Staging и фактическое выполнение RPC не подтверждены. |
| Android/iOS в Telegram WebView | Не проверено. |
| Фактическая отправка в отдельный Telegram-чат | Не проверено; `TELEGRAM_UTILITY_CHAT_ID` не предоставлен. |
| Сквозное структурированное логирование ошибок | Реализовано в локальном серверном коде seller/admin API и cron; unit-тесты проверяют request ID и исключение неразрешённых полей. Staging/production лог и алерты не проверены. |

Для первого этапа без Telegram нужны staging-проверка RPC и маршрута seller → Supabase → admin, проверка cleanup cron/`CRON_SECRET`, логов и ручная приёмка на устройствах. Только после этого можно отдельно включить флаги app/admin. Telegram-чат, ответственный за `uncertain`, проверка отправки и накопленной очереди относятся ко второму этапу; до этого `UTILITY_READINGS_ENABLED` остаётся выключенным. Первый этап нельзя обозначать как доставку бухгалтеру в чат.

## 9. Карта исходного кода

| Часть | Файлы |
|---|---|
| Главная карточка и seller UI | `feedback-app/src/components/CategoryGrid.tsx`; `feedback-app/src/app/(app)/utility-readings/page.tsx`; `utility-readings-form.tsx`; `feedback-app/src/components/PhotoInput.tsx` |
| Seller API и доступ | `feedback-app/src/app/api/utility-readings/{route.ts,stores/route.ts,uploads/route.ts,submissions/route.ts}`; `feedback-app/src/lib/utilityAccess.ts` |
| Admin UI/API и доступ | `feedback-admin/src/app/(admin)/admin/utility-readings/*`; `feedback-admin/src/app/api/admin/utility-readings/{config,coverage,submissions}/route.ts`; `feedback-admin/src/lib/admin/utilityAccess.ts` |
| Worker | `feedback-admin/src/app/api/cron/utility-dispatch/route.ts`; `utility-cleanup/route.ts`; `feedback-admin/src/lib/admin/utilityTelegram.ts`; `feedback-admin/vercel.json` |
| Серверное логирование | `feedback-app/src/lib/utilityLog.ts`; `feedback-admin/src/lib/admin/utilityLog.ts`; тесты `utilityLog.test.ts` в обоих приложениях |
| База и readback | `feedback-admin/supabase/056_utility_readings.sql`; `056_utility_readings_readback.sql`; `057_utility_resubmission_and_three_photos.sql`; `057_utility_resubmission_and_three_photos_readback.sql` |
| Ограничение chat ID | `feedback-admin/docs/TECHNICAL_DEBT.md`, TD-002 |

При изменении поведения обновлять этот документ вместе с кодом: бизнес-правило, Mermaid-переход, API, таблицу ошибок, проверку и дату фактического readback. Не менять описание live-состояния по одному только локальному SQL-файлу.
