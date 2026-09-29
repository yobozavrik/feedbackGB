# Чеки Poster без шифрования: решение и внедрение

## Решение владельца

29.09.2026: «делаем без шифрования. это внутренний проект». Новые полные ответы чеков и referenced клиентов хранятся открытым исходным UTF-8 JSON-текстом. Ключ шифрования не нужен. Это не разрешение открывать таблицы anon/authenticated/browser или публиковать персональные данные в логах/Git.

## Что меняется

1. Forward-only `045_poster_receipt_plaintext_archive.sql`: `raw_body text`, `source_sha256 text`, формат `raw-utf8-v1`; строго раздельная форма legacy AES/raw; прежние constraints/FK/indexes/immutable triggers/RLS сохранены.
2. `import_poster_receipt_bundle(jsonb)` расширен для raw, валидирует UTF-8 SHA-256 и JSON-object; прежние manifest/replay/locks/atomic accepted-last и service-only EXECUTE сохранены. Policy не включается миграцией.
3. `buildPlainPosterReceiptBundle` сохраняет исходный текст без parse/stringify пересериализации. Все неизвестные поля остаются в тексте. Header/ordered line projections не округляют large IDs/decimals.
4. CLI default prepare-only теперь raw mode; использует `POSTER_ACCOUNT` или explicit `POSTER_RECEIPT_ACCOUNT_ID`, а не encryption env. Root env заполняет недостающие параметры, app env имеет приоритет. Не копирует/редактирует env.
5. Legacy AES builder/crypto оставлены для совместимости/тестов043/044. Новая команда sync их не использует. Старые данные не переписываются.

## Без изменений

- Все новые объекты только feedbackgb; applied043/044 файлы не редактировать.
- Raw таблица закрыта public/anon/authenticated/service_role SELECT/INSERT. Запись только защищённым RPC.
- Полные customer profiles относятся к моменту получения, не к историческому моменту покупки.
- Нет raw body/source errors/token URLs в outputs. CLI выводит только агрегатные diagnostics.
- Два identical scans не гарантируют отсутствие более поздних изменений Poster. Current roster не является историческим roster.
- Не включаем новый cron/backfill до применения045/readback/runtime acceptance. Missing data не превращается в нули.

## Проверка документации API

Переданные локальные `poster_knowledge_base/Web API/transactions Чеки/transactions.getTransactions Список чеків.md` и `clients Маркетинг/clients.getClient Властивості клієнта.md` прочитаны. Локальная receipt summary противоречит официальному источнику: YYYYMMDD, response-array и include_* options не соответствуют проверенному официальному контракту текущего endpoint. Поэтому не менять рабочий loader по этой summary.

Первичные источники повторно сверены29.09:

- [transactions.getTransactions](https://github.com/joinposter/docs/blob/master/en/web/transactions/getTransactions.md): YYYY-MM-DD, page/per_page≤1000, response.count/page/data и products.
- [clients.getClient](https://github.com/joinposter/docs/blob/master/en/web/clients/getClient.md): client_id, optional1c=true, response array с клиентом.

## Проверки до применения

- `npm run test`:87files/948tests passed,17:39:43; `npm run typecheck`:exit0.
- `node scripts/verify-receipt-sql-local.mjs`:26checks passed. Exact043→044→045 в isolated PostgreSQL18.3/PGlite0.5.8. Проверены raw service publish, byte-exact text roundtrip, hash/mixed-format rejection, replay/conflict, immutability и denied read для3ролей. Policy после045 остаётся выключенной.
- Это не production15.8 или two-session concurrency proof. Все local SQL данные синтетические; live DDL/запись не выполнялись.
- Реальная raw preparation28.09 прошла:2188receipts/4624lines/618profiles;26current spots;3pages ×2identical scans;624requests. UTC14:41:15–14:44:23, exit0, `prepared_only`, `publication=null`; без Supabase writes/source files. Safe evidence в `docs/evidence/receipts/2026-09-29-plaintext-preparation.json`.

## Применение владельцем

1. Supabase SQL Editor: выполнить весь `045_poster_receipt_plaintext_archive.sql`.
2. Выполнить `045_poster_receipt_plaintext_readback.sql`; guards=true, ingestion_enabled=false, accepted_runs=0 для текущего пустого архива. Ни одного customer value в readback.
3. После readback согласовать отдельный тест импорта и enable policy/env. Само применение045 ничего не загружает.
4. Принятый реальный день сверить по receipt/line/client/page counts и raw byte hash; затем backfill/cron. Не считать подготовку в памяти импортом.

## Откат и ограничения

Не удалять columns и не откатывать на044 после появления raw rows — потеряется доступ к новому формату. Безопасный операционный откат: выключить publishing env и DB policy; сохранять уже принятые данные. Схемный откат требует отдельной forward migration после проверки содержимого. Массовый поиск JSON/новые GIN/partitions пока не добавлены без реальной query-volume/EXPLAIN задачи.

Raw данные читатель БД/backup может увидеть без отдельного ключа. SHA-256 не защищает конфиденциальность и не является подписью Poster. TLS/секретность service-role/RBAC/retention остаются необходимы.
