# Полные чеки Poster → feedbackgb

Дата29.09.2026. Scope: **вся доступная информация чеков**, дата/время/номер, продукты, суммы, бонусы, скидки, клиенты. Последнее решение владельца: **без прикладного шифрования**. Это заменяет первоначальное требование AES ниже. RLS/закрытые права/запрет PII в логах сохраняются. Применены043/044; подготовлена forward-only045. Реальный импорт ещё не включён.

## 1. Источник и границы полноты

Primary receipt source — transactions.getTransactions. Официальные документы:

- https://github.com/joinposter/docs/blob/master/en/web/transactions/getTransactions.md
- https://github.com/joinposter/docs/blob/master/en/web/clients/getClient.md

API возвращает receipt header и products. client_id — ссылка; карточка клиента получается отдельным clients.getClient. Обогащать referenced clients, а не незаметно импортировать всю unrelated CRM. Guest/client_id0 не связывать с произвольным клиентом.

«Полный» означает **все поля фактически возвращённых API payload**, вложенность, null, ordered arrays, новые неизвестные поля. Это не гарантия, что API отдаёт все поля кассового экрана/фискального документа. transaction_id — источник ID заказа; нельзя подписывать его номером фискального чека, если такой номер не подтверждён отдельно. Типы money/time/status/number уточняются по каждому endpoint/полю, не общим коэффициентом на все данные.

## 2. Read-only inventory 29.09

`node scripts/probe-poster-receipt-fields.mjs`: exit0; started13:11:16.143Z, finished13:11:16.348Z; только2receipt samples за28Sep. Вывод **field paths/types**, ни одного значения чеков/клиентов, никаких DB writes.

Подтверждённые header fields:

```text
transaction_id,spot_id,table_id,client_id,date_close,
sum,payed_sum,payed_cash,payed_card,payed_card_type,payed_cert,payed_bonus,payed_third_party,
round_sum,pay_type,reason,tip_sum,tips_card,tips_cash,bonus,discount,print_fiscal,
total_profit,total_profit_netto,application_id,auto_accept,products
```

Подтверждённые product-line fields:

```text
product_id,modification_id,type,workshop_id,num,
product_sum,payed_sum,cert_sum,bonus_sum,bonus_accrual,round_sum,discount,
product_cost,product_cost_netto,product_profit,product_profit_netto,
fiscal_company_id,print_fiscal,tax_id,tax_sum,tax_type,tax_value,tax_fiscal
```

Header money amounts пришли strings, profit fields — numbers, percentages — numbers; quantity num — number; bonus_accrual встречается null/string. **Это типы, не доказательство единиц каждого money field.** Дата открытия, terminal/order printed number, cashier и контакты клиента в этих2samples не обнаружены; отсутствие в sample не доказывает отсутствие в других receipt/detail endpoints. Расширенный inventory и официальный endpoint lookup — обязательный следующий шаг перед финальной схемой.

Документация описывает receipt discount и line discount как проценты; bonus как процент начисления, payed_bonus/bonus_sum — платеж/сумма. Не записывать все эти поля в одну колонку «скидка/бонус₴». Текущий balance из clients.getClient не является бонусным балансом на момент январской покупки.

## 3. Предлагаемый слой хранения (все объекты в feedbackgb)

| Объект | Grain / назначение |
|---|---|
| poster_receipt_import_runs | Источник/аккаунт/период, страницы/count/hash, fetch times, parser_version, outcome; stage≠complete до принятия |
| poster_receipt_identities | Непартиционированная идентичность account×transaction_id, указатель на принятую версию; printed number отдельно если источник отдаёт |
| poster_receipt_versions | Immutable receipt version: import_run,identity,store,source date/time+business_date,client reference,payment,status metadata |
| poster_receipt_line_versions | Receipt version×source_line_no, исходная позиция/модификация, quantity и verified unit basis, все подтверждённые финансовые/налоговые поля |
| poster_receipt_source_payloads | Полный versioned receipt source; **незашифрованный** exact UTF-8 JSON-текст `raw_body`, SHA-256, формат `raw-utf8-v1`; legacy AES сохраняется без изменения |
| poster_client_snapshots | Account×client_id×observed_at; ссылка на полный незашифрованный `clients.getClient` source payload; receipt reference отдельно |
| poster_receipt_field_registry | Endpoint/path, observed types, money/unit basis/verification status; новые поля сохраняются, но неподтверждённые не участвуют в KPI |
| receipt category/product bridges | DISTINCT receipt identity/version×historical category/product; только после category identity verification, без персональных данных |

Текущий статус29.09: foundation043 и atomic RPC044 применены владельцем; plaintext045 подготовлена и проверена локально, но ещё не применена. Whole-day loader/CLI реализованы и проверены на live Poster read-only. Импорт не включён; field registry population, клиентский доступ с аудитом и category/product bridges не реализованы. Не создавать копию existing aggregate sales pipeline. Analytics comparison отдельно сверяет товарные и чековые источники; не складывает их деньги вместе.

Для полноты нужен lossless JSON read/archive: нельзя сначала округлить большие числа JavaScript Number, а потом назвать повторную сериализацию точной копией источника. Оригинальные source strings и raw date_close сохраняются; normalized numeric/minor/timestamptz — отдельные поля. JSONB сохраняет структуру, но не исходный порядок ключей/формат чисел; byte-exact archive — исходный UTF-8 текст + SHA-256. Хэш только для проверки целостности: не шифрование и не аутентификация Poster. Никакие raw API URLs/token/error body не архивируются.

Продуктовое название/единица/category отсутствующие в receipt API берутся как versioned observation отдельного справочника с source+observed_at; сегодняшняя карточка не выдаётся за исторический snapshot. Клиентский snapshot, полученный сегодня, также не выдаётся за январское имя/телефон/баланс. receipt client_id остаётся исходным.

## 4. Защита клиентских данных

- Полный private payload включает разрешённые пользователем персональные поля, но не становится частью общедоступной аналитики. Для общих views только surrogate IDs и безопасные measures.
- RLS включена; revoke PUBLIC/anon/authenticated и inherited grants. Service-role не обходить через прямой browser connection; restricted backend workflow/RPC.
- **Решение владельца29.09:** application-level encryption не использовать. Полные PII доступны читателю raw-архива/дампа БД в открытом виде. Внутренний статус проекта сам по себе не скрывает данные при доступе к БД/backup. Обычные charts/API не получают raw payload. TLS, RLS, закрытые ACL и секретность Poster/service-role токенов сохраняются. Ключ шифрования/key-id больше не нужны для нового загрузчика.
- ФИО/телефон/email/address/comments не возвращать в обычные charts/API/logs/exports. Отдельное разрешение на просмотр клиента и журнал действий; на первом этапе доступ super_admin. Открытие admin — отдельное RBAC решение.
- Сохранять полный payload в приватном архиве, но typed analytics projection минимальная. Хэши телефонов для поиска не считать анонимизацией; lookup HMAC только при реальной бизнес-задаче и отдельном key management.
- Период хранения и порядок исправления/удаления клиентской карточки определить отдельно; не удалять финансовую историю автоматически. Не обещать бессрочное хранение контактов как обязательное для анализа продаж.

## 5. Индексы и partitions

Кандидаты B-tree по реальным query patterns:

- identity UNIQUE(account_id,transaction_id), независимо от изменения даты закрытия.
- versions(account_id,transaction_id,observed_at DESC); store/day/import_run; client_id/business_date для разрешённого drilldown.
- lines(receipt_business_date,receipt_version_id,source_line_no); product_id/business_date/store_id для trend, modification_id при подтверждённой необходимости.
- clients(account_id,client_id,observed_at DESC); не индексировать все чувствительные fields без нужного запроса.
- import runs(period,status,completed_at); latest accepted indexes. Append-only datetime BRIN — только после проверки физического порядка/EXPLAIN.
- GIN на весь raw JSON по умолчанию не создавать: размер/стоимость записи, PII и отсутствие разрешённого поиска. Именованные финансовые колонки+typed dimensions обслуживают основной dashboard.

**Месячное RANGE(business_date)** предлагается для объёмных receipt versions/lines после замера фактического годового объёма и EXPLAIN. Малые identities, policies,clients metadata не партиционировать автоматически. Parent RLS/ACL и direct child ACL проверять отдельно; ни одного открытого child partition.

В PostgreSQL partitioned UNIQUE/PK должен включать partition key: composite PK(business_date,version_id), соответствующие composite FK. Глобальная уникальность transaction identity обеспечивается отдельной unpartitioned identities, а не ложным UNIQUE(transaction_id) на месячных parents. Дату исправленного чека нельзя использовать как новую идентичность: новая версия может оказаться в другом месяце, старый финансовый snapshot сохраняется, affected old/new dates invalidated.

Создавать partitions заранее на разрешённый history range и несколько будущих месяцев под контролем защищённого maintenance. Missing partition — явная import error, не сброс строки. Не запускать DDL из UI request или на каждую receipt insert. Не делать DROP старого partition как способ ускорения при требовании полной истории.

Partitioning не заменяет индексы, pagination, latest version filtering или coverage. Принять решение после измерений: unpartitioned/indexed vs monthly partitions на одинаковом staging dataset и типовых запросах7/30/YTD×store/product. Нельзя утверждать ускорение без замера.

## 6. Загрузка и проверки

1. Утвердить field inventory и безопасный lossless/archive/parser contract; новые/редкие source fields не теряются.
2. Проверить денежные basis каждого header/line/client endpoint; percentages отличаются от UAH/minor; signed returns не clamp.
3. Проверить source timezone/date_close и фильтры day boundaries; исходные строки сохранить. Не угадывать UTC для local date_close.
4. Подготовить forward-only SQL, encryption/configuration workflow, RLS/ACL/partition keys/FK/readback/rollback. Номер после inventory existing migrations.
5. На staging: idempotency, repeated product lines, multi-page drift, moved receipt date, void/fiscal returns, null/unavailableclient, missing partition, large numeric exactness, PII denied/log redaction, concurrent sync/latest asOf.
6. Backfill с01.01 постепенно; ночной closed day и bounded recheck. Публикация immutable accepted run атомарно, incomplete version не вытесняет accepted.
7. Валидация page/source totals, lossless field completeness и reconcile **подписанных** eligible populations; расхождение не скрывать округлением или отказом от bonus/cert.
8. Только затем включать receipts/count/average basket/penetration в Analytics. Source unavailable ≠ zero.

043 применена владельцем: получен readback7tables/RLS/denied SELECT anon/authenticated/denied INSERT service_role и4immutable triggers; структура дополнительно сверена live29.09. Partitions не созданы; импорт агентом не запускался. Инвентаризация2чеков — не проверка годового импорта или полной customer sync. Полный runtime staging gate остаётся незакрытым: создание objects/ACL не доказывает импорт или concurrent behavior.

## 7. Исторический этап foundation043 (первоначально AES; теперь применена)

- `src/lib/admin/posterReceiptArchive.ts`: AES-256-GCM для оригинальных bytes ответа; authenticated context account/endpoint/object/key-id; случайный nonce12bytes и tag16bytes; лимит32MiB. Клиентский ответ шифруется отдельно. Ключ передаётся только серверному процессу из внешнего secret storage, не сохраняется в SQL. Runtime подключения ключа и ротации ещё нет.
- `supabase/043_poster_receipt_archive_foundation.sql`: seven tables, account/run/endpoint-bound FK, source-row ordinal, ordered repeated product lines, global transaction identity, nullable unverified normalized time, raw monetary strings и status basis unverified; index identities/store-day/product/client observations; RLS и revoke всех прикладных прав. Источники и принятые факты не перезаписываются: correction требует новой версии.
- Полные неизвестные поля/оплата/налоги/контакты хранятся в encrypted original page/client response, а не открытом JSONB. Табличная финансовая проекция пока частичная и не является готовым аналитическим контрактом.
- Foundation **не даёт service_role импортировать данные**. Следующий этап — проверенный atomic RPC, completeness checks, latest accepted version selection, protected worker и access audit. Accepted-state публикация ещё не обеспечена функцией; обходить её ручным UPDATE запрещено.
- `043_poster_receipt_archive_readback.sql`: конфигурация RLS/ACL, indexes, immutable triggers. `043_poster_receipt_archive_rollback.sql`: только пустой foundation, ACCESS EXCLUSIVE locks, отказ при любом содержимом, без CASCADE.
- Partitioning отложено до объёма и EXPLAIN на staging. Даты/единицы/возвраты нельзя объявлять проверенными по двум примерам.
- Тесты модуля шифрования и **статические текстовые** SQL guards — не Postgres execution proof. SQL application, FK failures, RLS under roles, concurrent publication, ingestion and E2E остаются `blocked/not started` до отдельного staging. Ни основной dashboard, ни cron не подключены к новому foundation.

## 8. Исторический этап атомарного контракта044 (первоначально AES; теперь применена)

- `posterReceiptBundle.ts` принимает полные оригинальные bytes **всех** страниц network-day и referenced client replies; JSON numbers в проекциях остаются lexical strings, без округления через JS Number. Сначала отдельная syntax-only validation (результат отбрасывается), затем lexical number quoting. Оригинальный JSON отдельно AES-GCM archived.
- Документированный transactions.getTransactions предоставляет даты/page/per_page; spot filter не указан. Не использовать выдуманный параметр и не фильтровать source receipts молча. Bundle покрывает network-day; source spot сохраняется для каждого receipt; verifiedSpotIds — проверенный allowlist, неизвестный магазин блокирует run, не теряется.
- Полная проверка pages: последовательность1..N, consistent source total/per_page, page count/expected last-page rows, duplicate transaction IDs, источник даты, каждый product line/ID, каждый referenced nonzero client. Guest0 не получает произвольного client snapshot. Missing client response блокирует bundle; политика допустимого отсутствия клиента ещё не принята.
- `assertReceiptPagesStable` — сравнение2полных original scans. Это bounded stability check: у endpoint нет используемого snapshot token и это **не гарантия отсутствия последующих изменений**. Worker должен выполнить два scans до публикации; protected worker пока не написан.
- Raw unknown fields/client contacts/comments остаются в encrypted bytes. Открытый transport projection только explicitly mapped measures/IDs; numeric fields отвергают arbitrary text. Полный data registry population/verified money/time/units пока не сделаны. Финансовые KPI из этого слоя не публикуются.
- `044_poster_receipt_atomic_import.sql`: policy default false; bounded16MiB/20kreceipts/128pages; два ordered advisory transaction locks(run/account); exact SHA256 canonical bundle replay и conflict на другом содержимом; все INSERT + accepted LAST в одном RPC. Freshness проверяется для new run, но принятому exact replay не мешает возраст. Run metadata после принятия immutable. Прямые INSERT/SELECT права не открываются; только service_role EXECUTE.
- RPC доверяет authenticated worker attestation: он **не умеет расшифровывать исходник** без внешнего ключа и не доказывает, что projection соответствует encrypted page. Поэтому source/projection проверка worker + runtime tests обязательны; service-role не отдавать browser.
- В run source_spot_ids отражает объявленную область проверки, но не доказывает historical roster. current roster нельзя объявлять историческим автоматически. normalized business_date/closed_at и money/quantity basis остаются null/unverified, не являются готовыми день×магазин measures.
- Повтор транспортного вызова использует **тот же encrypted bundle**, run IDs и ciphertext. Пересборка с новыми nonce/UUID даёт новую версию; не пытаться использовать тот же run ID с новым шифротекстом. Durable transport retry/checkpoint пока не подключён.
- `044_poster_receipt_atomic_import_staging_smoke.sql`: staging-only opt-in, synthetic integrity fixtures, итог ROLLBACK; disabled gate, incomplete rollback, replay/conflict, accepted metadata protection, repeated lines. Fixtures ciphertext не реальные AES objects: SQL smoke не заменяет crypto/source/race тесты.
- 044/readback/smoke **агентом не исполнялись**. Политика enable требует отдельного решения после staging + ключа + worker + source verification. Не включать её для демонстрации графиков, не обещать, что applying044 начинает импорт.
