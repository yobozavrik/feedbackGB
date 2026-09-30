# Полные чеки: журнал реализации

> Актуальный отложенный риск ночной загрузки зафиксирован как `TD-001` в `TECHNICAL_DEBT.md`: один запуск импортирует не более одного пропущенного дня и при backlog не догоняет источник автоматически.

## 29.09.2026 — foundation, без записи в Supabase

Цель: полный source receipt + referenced customer profile в feedbackgb; без потери неизвестных полей и без клиентских данных в общей аналитике. Рабочая база Preview/Production не является staging.

### Проверено

- Crypto: оригинальные bytes, в том числе большие числа, duplicate product lines, null/unknown fields/whitespace; random nonces; tampered nonce/tag/ciphertext, неправильный ключ, account/endpoint/object/key-id rejected; uniform error без PII. Клиентский payload имеет отдельную привязку источника.
- Новый набор тестов: **38 passed**, 2files, command `npm run test -- src/lib/admin/__tests__/posterReceiptArchive.test.ts src/lib/admin/__tests__/posterReceiptMigrationContract.test.ts`, exit0,16:24:29 local.
- Полный suite окончательной версии: **81files/790tests passed**, exit0,16:25:41 local,7.64s.
- `npm run typecheck`: exit0, включая повтор после последнего изменения. `git diff --check`: exit0; только предупреждения LF/CRLF старых документов.
- Первый Vitest startup в sandbox дал EPERM; повтор с разрешённым локальным запуском прошёл. Это не дефект приложения и не тестовый passed для первой попытки.

### Реализовано в коде, не принято по БД

- Модуль `posterReceiptArchive.ts`, тесты, SQL foundation043, SQL readback и guarded empty rollback.
- Все новые SQL объекты в feedbackgb, no public schema. Прикладные grants отсутствуют до атомарного verified importer; новый код не подключён к UI/cron/worker.
- Семь таблиц; FK связывают аккаунт/источник/запуск, repeated lines сохраняются по ordinal; identities независимо от даты, версии неизменяемые. Архивы шифруются вне БД; ключей в файлах нет.
- Базовые B-tree индексы; monthly partitions **не внедрены**: нет доказательства объёма/EXPLAIN.

### Граница доказательств и следующий gate

- SQL tests — text guards; миграция не исполнена PostgreSQL, реальное поведение constraints/ACL/triggers не подтверждено. В рабочую Supabase ничего не записывали, таблиц нет.
- Требуется отдельный staging: применить043, readback, synthetic FK/immutability/role tests; проверить query plans и migration rollback. После этого atomic publication + import worker + client enrichment + production key management + complete pagination/refund/time/unit checks.
- Full receipt import, ночной sync, загрузка января–сегодня, receipt analytics, customer access audit и E2E — **не готовы**. Existing sales aggregates не заменены и не изменены этим foundation.
- Новых коммитов/пуша в этой итерации нет.

## 29.09 — по запросу владельца: сверка categories и файл миграции

- Live проверены columns/constraints/indexes/triggers/RLS/ACL PostgreSQL15.8 схемы categories. Корректное имя categories. categories.clients пустая; крайние даты чеков2025-01-02–2026-09-28 не доказательство coverage. Оценки pg_class записаны отдельно от COUNT.
- Расширен043: payment split/ewallet/tax/tips/profit; open dates/status/user/table/service/processing metadata; line tax/fiscal/cost/profit/bonus. reason исходный text, а не принудительный integer. PII только encrypted source; старые categories privileges/indexes не перенесены.
- SQL preflight отвергает отсутствующую feedbackgb или частично существующий foundation. Readback содержит compact aggregate + подробные objects. Файл миграции дан владельцу для самостоятельного запуска; importer до runtime gates остаётся выключен.
- После расширения: **41 tests passed**,2files,16:37:12,exit0. Это cryptography+static SQL guards, не исполнение PostgreSQL. Полный suite790 выше относится к предыдущей версии; повтор после расширения указан ниже.
- Финальный полный suite после расширения: **81files/793tests passed**,16:38:02,7.95s,exit0; `git diff --check` exit0.
- Подробности: `POSTER_RECEIPT_CATEGORIES_SCHEMA_COMPARISON_2026-09-29.md`. Никакой DDL/записи/изменения ACL в Supabase не выполняли.

## 29.09 — владелец применил043; атомарный контракт044 подготовлен

- Получены readback владельца7tables/RLS/denied SELECT anon/authenticated/denied INSERT service_role и4immutable triggers. Дополнительно agent live read-only сверил exact columns, ACL и наличие SHA256/advisory-lock signatures. Применённые043 файлы больше не редактировались.
- Новое: `posterReceiptBundle.ts` с exact numeric token projections и encrypted original bytes, bounded full network-day pages, exact source count/page count, stable scan helper, source IDs/date/spot/lines и required referenced client snapshots. API docs повторно проверены; spot query parameter не выдуман.
- Новое: SQL044 policy disabled by default + service-only atomic RPC, ordered run/account locks, SHA256 replay/conflict, full ordinals/count/client checks, publish-last, accepted metadata immutable; readback и staging-only total-rollback synthetic smoke.
- Tests:59новых bundle/atomic-static passed; **полный83files/852tests passed**,exit0,16:58:09. Typecheck exit0. Lint exit0,3старых warnings (absences useMemo/img; schedules openHistory dependency). Diff check exit0,LF/CRLF warnings старых documents.
- Это не PostgreSQL execution proof новой044: функции не созданы и не вызваны; live policy_table/atomic_rpc=NULL,manifest_column=0. Создание таблиц043 не доказывает atomic/RLS/races/crypto на полном live import. Новые primary receipts/client data не запрашивались/не записывались агентом в этой итерации.
- Нужен runtime acceptance044/staging smoke/concurrent tests. Protected full-page worker, secret management и ingestion enable ещё не сделаны; нет нового cron/UI/загрузки истории. Подробный handoff: `POSTER_RECEIPT_ATOMIC_IMPORT_HANDOFF_2026-09-29.md`.

## 29.09 —044 применена; loader и локальное runtime-исполнение

- Владелец прислал успешный readback044. Повторный agent read-only SELECT подтвердил: `ingestion_enabled=false`, `archive_runs=0`. Applied043/044 не редактировались. Никакого DDL/изменения policy/импорта в рабочую БД агентом.
- Изолированный `verify-receipt-sql-local.mjs` исполняет exact migration files, ACL/readback/staging-smoke и реальные encrypted synthetic bundles.17checks passed в PostgreSQL18.3/PGlite0.5.8; source bytes возвращаются из PostgreSQL и расшифровываются без потери. Account IDs вне safe integer, повторяющиеся product lines, replay, manifest conflict, rollback при missing client/битой второй строке и immutability проверены. Пакет закреплён только в ignored `node_modules/.receipt-sql-qa`; package.json/lock не менялись. Нет внешней БД/env.
- Ограничения SQL evidence: engine не production15.8, single exclusive connection, **не проверены настоящие конкурентные транзакции**. Не выдавать эту проверку за staging acceptance или production E2E.
- Реализованы `posterReceiptLoader.ts`, `posterReceiptPublication.ts`, `posterReceiptSync.ts`; scripts read-only verifier и explicit one-day operator CLI. Default CLI prepare-only не создаёт Supabase client; publish требует явных двух application gates плюс независимый DB policy. No anon fallback. Сбой неизвестного результата RPC не трактуется как гарантированный rollback.
- Первая live попытка полного дня28.09 остановилась на512requests (`receipt_request_budget_exceeded`,UTC14:12:03–14:14:36). Бюджет оказался недостаточным из-за cold referenced-client enrichment. Не пропускали клиентов и не называли частичный день полным. Добавлены bounded offline budget, early client-budget check и safe counters.
- Повтор: **passed**,UTC14:16:28–14:19:35.2188receipts/4624product lines/618client snapshots;26current spots;3pages и2identical scans;624requests;6533388source bytes. Encrypted original page/profile authenticated decrypt проверен в RAM; ephemeral key уничтожен. Без Supabase, файлов, source dumps/PII. Это один день, не full-year coverage; текущий roster не historical roster; time/money/unit normalization не доказана; более поздние изменения Poster возможны.
- После worker дополнения первая попытка тестов поймала5ошибок в параметризованном тестовом наборе (Vitest разворачивал arrays в аргументы). Данные теста исправлены на object cases, включая реальную duplicate-roster проверку. Финальный **86files/926tests passed**,17:23:24,6.88s. Предыдущая попытка не passed.
- CLI `--prepare-only` проверен на текущей конфигурации: exit1/`receipt_config_invalid`, остановка до source/DB, полный серверный config ещё не установлен. Значения env/ключей не выводились/не менялись.
- Нет cron/backfill/принятого реального receipt import/receipt UI. Следующий gate: внешний production archive-key/account config; настоящий two-session staging acceptance; затем разрешённый реальный день с counts/coverage/byte readback. Durable encrypted retry checkpoint между процессами ещё отсутствует. Без этого не стартовать длинный unattended backfill.
- Финальная статическая проверка после CLI: `npm run typecheck` exit0; `npm run lint` exit0, только3ранее известных warnings absences/schedules, вне текущего scope. `git diff --check` exit0 для tracked changes; новых untracked файлов эта команда не проверяет. Их TypeScript проверен typecheck/test, JSON evidence создан без source values/PII.

## 29.09 — решение владельца: хранить без шифрования

- Владелец явно изменил требование: «делаем без шифрования. это внутренний проект». Это заменяет AES requirement предыдущих этапов, не отменяет RLS/ACL/PII redaction. Данные читатель raw table/backup сможет увидеть без ключа; SHA-256 не шифрует и не подписывает источник.
- Forward-only045 добавляет `raw_body text`, `source_sha256`, `raw-utf8-v1` и storage-shape constraint; обновляет RPC для raw source/hash/JSON validation. Applied043/044 не редактировались; legacy ciphertext не переписывается. Grants/FKs/indexes/immutable triggers сохранены, ingestion не включается.
- Builder/loader поддерживают keyless raw mode; explicit worker по умолчанию использует raw. Existing POSTER_ACCOUNT применяется как namespace, explicit POSTER_RECEIPT_ACCOUNT_ID имеет приоритет. App env выше root fallback; root `.env`/`.env.local` прочитаны только в памяти, значения не выводились, файлы не менялись. Git ignore подтверждён отдельно предыдущей проверкой.
- Локальная документация Poster прочитана; receipt summary содержит несовпадение YYYYMMDD/response-array/include_* с текущей официальной pagination документацией. Повторно сверены primary joinposter/docs getTransactions/getClient; рабочий date/page/per_page contract не изменён.
- `npm run test`: **87files/948tests passed**,17:39:43,8.29s. `npm run typecheck`:exit0. `npm run lint`:exit0,3existing warnings absences/schedules. Local SQL: **26checks passed**, PostgreSQL18.3/PGlite0.5.8, synthetic only; включая043→044→045, byte-exact raw text, no encryption columns for raw, mismatched hash/mixed-format rejection, replay/conflict, ACL и immutability. Конкурентные транзакции и production15.8 не проверены.
- **Реальный raw CLI prepare passed:** `node scripts/sync-poster-receipt-day.mjs --date=2026-09-28 --prepare-only`, exit0; UTC14:41:15.093–14:44:23.256.2188receipts/4624lines/618profiles;26current spots;3pages ×2identical scans;624requests;6533406source bytes. `archiveFormat=raw-utf8-v1`, `databaseWriteRequested=false`, `publication=null`. Никаких raw/client values в сохранённом evidence, файлов источника или Supabase writes.
- Единственный необходимый следующий schema gate: владелец применяет045 и readback. До этого raw publish не запускаем. Переход без шифрования не означает, что history/cron/receipt analytics уже работают. Отдельные runtime/concurrent acceptance и policy/env enable ещё впереди. Commit/push не делали.
- Подробности: `POSTER_RECEIPT_PLAINTEXT_SWITCH_2026-09-29.md`; безопасный summary evidence: `docs/evidence/receipts/2026-09-29-plaintext-preparation.json`.

## 29.09 — применение045 и разрешённый реальный импорт28/09

- Владелец прислал readback045: raw columns/RPC/storage-shape/RLS/immutable/ACL true; ingestion=false,accepted_runs=0. Agent live подтвердил PostgreSQL15.8, raw schema ready и0runs. Пользователь отдельно разрешил включить импорт и записать день28/09.
- Через SQL connector включение не удалось: execute_sql оборачивает query в SELECT и отвергает modifying CTE; query_database UPDATE завершился internal `query.eq is not a function`. Эти попытки не изменили policy. Владелец выполнил строго scoped UPDATE singleton в SQL Editor; live readback подтвердил enabled=true. Env-флаг запуска выставлен только в отдельном PowerShell process; env-файлы не менялись. Нет cron/исторического backfill.
- Первая команда --publish завершилась exit1/receipt_publish_failed. Live readback0runs/0receipt versions/0lines: successful import не подтверждён. Размер relations после отката не равен количеству принятых строк и не считается доказательством успешной частичной загрузки.
- Safe invalid-bundle probe: маленький и8MiB-string payload отклонены400/P0001/receipt_bundle_invalid до INSERT. Транспорт/RPC доступны, источник-size gateway reject на таком размере не воспроизвёлся. Не создавали синтетических чеков/клиентов в рабочей базе. В authenticator найден statement_timeout=8s/lock_timeout=8s; это возможная причина, окончательный SQL код первого failed RPC не был сохранён старым обработчиком.
- Добавлен safe ReceiptPublishError: только SQL state/HTTP status, без SQL message/body/PII. Supabase resolved status0 теперь bounded-retry с EXACT SAME bundle, outcome_unknown после исчерпания; SQL57014 отдельно receipt_publish_timeout, не повторять автоматически. Новые3tests.
- `npm run test`: **87files/951tests passed**,18:03:15,82.29s. `npm run typecheck`:exit0. SQL verifier: **27checks passed**, PGlite18.3, synthetic only; новый read-only `045_poster_receipt_day_verification.sql` сверяет counts, byte hashes и все mapping fields с raw JSON. Source pages разворачиваются один раз через materialized CTE, не заново на каждое поле каждого чека.
- Повторная разрешённая загрузка идёт с safe diagnostics; окончательный статус и независимая post-import verification дописываются после завершения. Никакого утверждения, что загрузка уже успешна.

### Результат повторного запуска и исправление SQL производительности

- Второй --publish завершился exit1: `receipt_publish_timeout`, SQLSTATE57014,HTTP500. Live owner readback: runs=0,receipt versions=0,lines=0,policy=true. Принимаем факт SQL cancellation; statement_timeout=8s найден у authenticator, но raw message первого запроса не выводился/не сохранялся. Никакой успешной загрузки не заявляем. Общие role/DB timeout настройки не меняли.
- Подготовлена **forward-only046**, новая версия существующего RPC: payloads/clients/identities/receipt versions/lines вставляются пакетно; source/shape/client/spot/ordinal/allowlist guards сохранены; те же locks/manifest/replay/FK/unique/immutable/ACL; весь день остаётся одной транзакцией, accepted последним. Никаких partial chunks/new tables/DDL outside feedbackgb.
- Дополнительная причина лишнего вычисления в исходной конструкции: `(jsonb_populate_record(...)).*` разворачивается по колонкам. В046 используется table-function `CROSS JOIN LATERAL ... AS populated`, `SELECT populated.*`, один record вызов на строку. Это описано в официальном PostgreSQL15 rowtypes §8.16.5; исходные applied044/045 не редактировали.
- Bulk verifier прогнал exact043→044→045→046 в isolated PostgreSQL18.3/PGlite0.5.8: **34checks passed**. В raw/bulk режиме отдельно проверены missing client, bad line, unknown spot, row out-of-bounds и forbidden private projection — все с atomic rollback. Same-sized synthetic stress:2188receipts/4624ordered lines/618profiles/26stores/3source pages; raw unknown metadata увеличивает source size; publish+readback+exact replay passed. Последний measured insert1876ms (1.876s), **не** замер production15.8 или proof конкуренции.
- `npm run test`: **88files/958tests passed**,18:14:13,9.02s. Typecheck повтор запущен после SQL/static test добавления. Предыдущий lint exit0 с3known warnings. Diff check exit0 tracked only. Safe failure/benchmark evidence сохранены без source/customer values.
- Владелец должен применить `046_poster_receipt_bulk_publication.sql`, затем `046_poster_receipt_bulk_readback.sql`. Agent execution connector read-only, migration самостоятельно не применена. На последнем live readback `bulk_ready=false`,runs=0,receipts=0,policy=true. После подтверждения046 повторить **реальный** день28/09 и независимую verification; source/history/cron всё ещё не приняты.
- Повторный `npm run typecheck` после всех bulk/static-test изменений завершился exit0; `git diff --check` tracked changes exit0 (толькоLF/CRLF warnings старых docs). Ни одного нового commit/push.

## 29.09 — 046 применена; реальный день 28.09 принят и сверен

- Владелец прислал readback 046: bulk RPC, `security definer`, RLS/ACL/immutable guards присутствуют; `ingestion_enabled=true`, на момент readback `accepted_runs=0`. Агент подтвердил readiness read-only запросом.
- По ранее данному разрешению выполнен один явный `--publish` за 2026-09-28. Флаг `POSTER_RECEIPT_IMPORT_ENABLED=true` был только в процессе команды и удалён по завершении; env-файлы не менялись. CLI завершился exit0, `status=accepted`, `attempts=1`, `replayed=false`, run `8f458fe3-7ff2-4929-9418-83ff0803cead`. Источник: 3 страницы, 2188 чеков, 4624 товарные строки, 618 профилей клиентов, 26 текущих магазинов; 2 идентичных сканирования, 624 запросов, 6533444 исходных байт. Начало UTC 15:48:16.948, конец UTC 15:51:25.950.
- Независимый readback из feedbackgb: accepted run за ровно 2026-09-28, `source_count=2188`, `page_count=3`, 26 spot ID, manifest present; фактически 2188 receipt versions, 4624 line versions, 618 client snapshots и 621 raw source payload (3 страниц + 618 профилей). Во всех 621 payload SHA-256 совпадает с сохранённым raw_body; суммарно 3 страницы содержат 2188 исходных чеков, page metadata без расхождений.
- Сверка сохранённого Poster JSON против проекций по каждой из 3 страниц: 2188/2188 чеков без пропусков; 72204 проверок mapped header fields и 110976 проверок mapped product-line fields, **0 расхождений**. Источник и проекция совпали также по transaction/spot/client ID, дате закрытия, суммам, количеству строк, product ID/quantity/price. 0 duplicate receipt identities; 0 missing source refs, 0 line-count mismatches, 0 client-link errors, 0 client-ID/source mismatches; все 26 магазинов представлены в чеке.
- Монолитный `045_poster_receipt_day_verification.sql` в runtime превысил `statement_timeout=8s`; **его нельзя отмечать passed как один SQL**. Эквивалентные проверки выполнены отдельными ограниченными запросами по страницам/связям/хешам; фактические результаты выше. PostgreSQL production runtime проверен одним реальным import, но изолированный staging и конкурентные публикации не проверены.
- Это подтверждает **только 28.09.2026** и точность сохранения проверенных исходных полей, не полноту периода с 01.01, не корректность последующих финансовых агрегатов и не ночной cron. `ingestion_enabled=true` остаётся в DB policy; процессного флага после CLI нет. Автоматический исторический backfill здесь не запускали.
