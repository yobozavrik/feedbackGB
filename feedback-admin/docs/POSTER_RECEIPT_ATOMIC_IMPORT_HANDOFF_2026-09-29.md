# Полные чеки: handoff атомарного импорта

## Фактический статус

043 и044 применены владельцем. Readback044 подтверждает service-only RPC, RLS policy, manifest column и immutable accepted-run trigger. Повторный live SELECT29.09: `ingestion_enabled=false`, `archive_runs=0`. Агент не выполнял DDL/запись в Supabase. Loader/worker и проверки ниже пока локальные, без нового cron/UI/commit/push.

**Последнее решение владельца29.09:** новые source payload хранить **без шифрования**. Код operator worker теперь использует `raw-utf8-v1` и существующий `POSTER_ACCOUNT` (или явный `POSTER_RECEIPT_ACCOUNT_ID`). Encryption key/key-id не требуются. Подготовлена новая045; applied043/044 не изменены. Исторические AES проверки ниже описывают предыдущую версию, не текущую конфигурацию.

Рабочий импорт **не запущен**:045 ещё не применена владельцем; DB policy и env publishing остаются выключены; отдельный staging/concurrent acceptance не выполнен.

## Реализация

1. `src/lib/admin/posterReceiptBundle.ts`: exact number token parsing, preserved full source bytes; consistent full network-day pagination/IDs/clients; bounded sizes; AES encrypted original page/profile; private fields отсутствуют в projections;2-scan byte stability helper.
2. `supabase/044_poster_receipt_atomic_import.sql`: добавляет policy(default false), manifest/spot scope/page rows metadata; accepted-run immutable trigger; atomic service-only RPC; global account identity и same-run serialization; whole manifest replay; page/row/line/client completeness; publish last. Applied043 не редактируется.
3. `supabase/044_poster_receipt_atomic_import_readback.sql`: RPC and ACL, policy false, protected accepted runs, manifest column. Expected: все guards=true, ingestion_enabled=false.
4. `supabase/044_poster_receipt_atomic_import_staging_smoke.sql`: только отдельный staging, session marker `feedbackgb.receipt_smoke_environment=staging`; total rollback; synthetic integrity fixtures, no real profiles, no source calls.

Источник структуры API повторно проверен: [transactions.getTransactions](https://github.com/joinposter/docs/blob/master/en/web/transactions/getTransactions.md), [clients.getClient](https://github.com/joinposter/docs/blob/master/en/web/clients/getClient.md). Документированный источник чеков network-date/page; SQL schema categories только reference, не raw source.

## Проверки29.09

- Новые tests bundle+atomic SQL static:59passed,2files,exit0,16:56:12.
- Полный suite: **83files/852tests passed**,exit0,16:58:09,7.53s.
- TypeScript: exit0. SQL guards — **текстовые**, не SQL runtime proof. PostgreSQL15.8 live подтверждает наличие built-in SHA256/advisory lock; новую функцию не вызывали/не создавали.
- Staging SQL smoke, roles ACL execution, concurrent same/different bundle race и rollback, client missing/deleted/source time/unit rare-case live checks, complete direct Poster pagination **ещё не выполнены**. E2E не проводили — worker/API/UI этого слоя отсутствуют.

## Дополнительные проверки —29.09, после применения044

- `node scripts/verify-receipt-sql-local.mjs`:17 runtime checks passed. Exact043/044 исполнены в PostgreSQL18.3/PGlite0.5.8 без внешней БД; проверены ACL, атомарный publish, replay/conflict, rollback частичной вставки, immutability, roundtrip зашифрованных оригинальных bytes. Синтетические fixtures. Это **не** concurrency proof: у PGlite одна exclusive connection; рабочая БД PostgreSQL15.8.
- `node scripts/verify-poster-receipt-day-readonly.mjs --date=2026-09-28`: passed, UTC14:16:28–14:19:35.26current spots;2188receipts;4624ordered lines;618referenced client snapshots;3pages ×2identical scans;624requests;6533388source bytes. Только RAM, временный ключ, никаких Supabase calls/files/PII output.
- Первая попытка с бюджетом512 остановилась `receipt_request_budget_exceeded` и не считается passed. Реальная причина: полный день требует624requests. Новый offline worker bounded: default4096requests/15min, max20000/30min, min200ms inter-request pause,20s per request,3attempts,64MiB total source/16MiB bundle. Проверка заранее известного недостаточного бюджета перед profiles; failure progress только aggregate counts.
- `npm run test`:86files/926tests passed,17:23:24 local. Typecheck/lint результаты фиксируются в журнале. Все mock/source-contract tests отдельно от live SQL/API доказательств.
- CLI preparation фактически остановился `receipt_config_invalid` до источников/БД. Полная конфигурация реального ключа/account пока не задана. Не подставляли ephemeral verification namespace в рабочую базу.

## Новые модули и безопасная команда

- `posterReceiptLoader.ts`: все страницы network-day, два byte-identical scans, все уникальные referenced clients, AES bundle, redacted errors, bounded retries/bytes/time. Нет DB/logging.
- `posterReceiptPublication.ts`: explicit enabled gate; RPC completion contract; при неоднозначном transport повтор EXACT SAME bundle/run/nonces; после3неопределённых попыток `receipt_publish_outcome_unknown`, а не утверждение, что записи не было.
- `posterReceiptSync.ts` + `scripts/sync-poster-receipt-day.mjs`: operator one-day orchestration; default preparation без создания DB client. `--publish` + env enabled обязательны; anon fallback запрещён; key Buffer обнуляется finally.

Запуск из `feedback-admin`:

```powershell
# После внешней настройки ключа: только сборка/проверка, НЕ запись.
node scripts/sync-poster-receipt-day.mjs --date=2026-09-28 --prepare-only

# Только после отдельного acceptance и разрешения рабочей записи:
# node scripts/sync-poster-receipt-day.mjs --date=2026-09-28 --publish
```

Текущие серверные переменные: existing `POSTER_ACCOUNT` (стабильный namespace аккаунта, не токен), `POSTER_TOKEN`; при необходимости явный `POSTER_RECEIPT_ACCOUNT_ID` имеет приоритет. Для publish дополнительно `POSTER_RECEIPT_IMPORT_ENABLED=true`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. **Ни encryption key, ни key-id не нужны.** App env имеет приоритет; root env заполняет только отсутствующие параметры worker, не меняя файлы. Токены не присылать в чат/commit. CLI не меняет env-файлы или DB policy. При prepare bundle не сохраняется и не может быть позднее replay после завершения процесса. Durable checkpoint пока не реализован.

## Последовательность дальнейшего запуска

1. Проверить044 на staging + readback + synthetic smoke + две concurrent sessions. Applying в shared DB создаёт только dormant RPC; это не замена staging tests.
2. Применить045, выполнить `045_poster_receipt_plaintext_readback.sql`. Проверить account namespace и серверные Poster/service-role credentials без вывода значений. У новых raw payload нет encryption key; чтение legacy AES при наличии таких данных потребует прежнего ключа, данные не переименовываются/не расшифровываются автоматически.
3. Loader и exact-bundle bounded publisher реализованы; полный live day проверен только read-only. Проверить на staging их связку с service-only RPC и две настоящие конкурентные сессии. Любой incomplete/unknown spot/client/day блокирует публикацию. Endpoint не даёт snapshot guarantee; subsequent corrections nightly recheck. Current spot roster не доказывает историческую принадлежность с января.
4. После worker/source/race acceptance owner разрешает policy, затем небольшой реальный день и explicit totals/coverage/bytes readback. До этого никаких искусственных customer profiles/zero-filled coverage в Production.
5. Только затем backfill Jan1→closed yesterday, nightly bounded jobs, latest accepted read model и verified receipt KPI, categories/product bridges, private audited customer drilldown. Партиции — после volume/EXPLAIN.

**Не готово:** импорт/cron/backfill/receipt UI; source math/time/units normalized projections; accepted-run consumer/history-asOf selection; private customer access audit/retention. Реализована только атомарная инфраструктура и source-bundle contract, не полная функция аналитики.
