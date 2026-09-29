# Импорт28/09: timeout и пакетная публикация

## Статус после исполнения 046

046 применена владельцем. Повторный реальный импорт 2026-09-28 **принят**: run `8f458fe3-7ff2-4929-9418-83ff0803cead`, 2188 чеков, 4624 строки, 618 профилей, 3 страницы/26 магазинов. Независимая сверка всех 621 raw SHA-256, числа строк, связей и mapped header/line fields дала 0 расхождений. Подробности в `POSTER_RECEIPT_IMPLEMENTATION_LOG_2026-09-29.md`.

Ниже сохранён исторический handoff до применения 046. Его шаги 1–4 **уже выполнены**. Монолитный `045_poster_receipt_day_verification.sql` превысил рабочий 8-секундный statement timeout, поэтому сверка выполнена эквивалентными отдельными запросами по каждой source-page. Полная история и ночной cron по-прежнему не загружены/не запущены.

## Факт

045 применена; владелец разрешил импорт реального дня и включил DB policy. Два запуска --publish не приняты. Второй вернул SQL57014/HTTP500. В БД после него0runs/0receipt versions/0lines; не показывать partial/нулевой результат как полный день. Найден authenticator statement_timeout8s. Общий timeout не повышали.

## Исправление046

Меняется только `feedbackgb.import_poster_receipt_bundle(jsonb)`. Все5сущностей вставляются set-based; те же guards, locks и one-transaction publication. `CROSS JOIN LATERAL jsonb_populate_record(...) AS populated` исключает повторное построение composite expression для каждого столбца. См. [PostgreSQL15 composite types](https://www.postgresql.org/docs/15/rowtypes.html#ROWTYPES-USAGE).

Applied043/044/045 не менять. Новых таблиц/прав/тайм-аутов/секретов/cron нет. Full receipt raw/source/client слой закрыт от app-role direct SELECT/INSERT.

## Проверено локально

- 88files/958tests passed, TypeScript до последнего прогона exit0.
- Exact SQL043→044→045→046:34checks passed, including disabled policy/ACL/hash/immutability/rollback/raw field readback.
- Синтетический network-day2188receipts/4624lines/618profiles/26stores: accepted и replay без новых duplicate versions; вставка1.876s в PGlite18.3/WASM. Не считать это скоростью рабочей PG15.8.
- Настоящие параллельные сессии не проверены. Рабочая скорость/full source parity будут проверены после применения046.

## Владелец

1. Выполнить046 целиком в SQL Editor.
2. Выполнить `046_poster_receipt_bulk_readback.sql`: bulk/lateral/raw/security/ACL guards=true; `ingestion_enabled=true` (уже включено владельцем),accepted_runs=0 до первого успешного импорта.
3. Передать readback. Worker env publishing включается только для одного запуска, env-файлы не меняются.
4. Повторить28/09 --publish; проверить `045_poster_receipt_day_verification.sql` с run_id принятого запуска. Ожидается actual==declared и0mismatches/errors/duplicates. Количество фактических source receipts может измениться, поэтому фиксировать diagnostics именно данного запуска, не blindly константы прежнего read-only sample.

## Откат

046 не меняет schema/data. При ошибке прекратить новые запуска; не чистить таблицы и не увеличивать общий role timeout. Возврат тела RPC к045 — отдельная forward migration, не повторное выполнение полного045 (колонки уже существуют). Policy остаётся уже включённой; для аварийной остановки владелец может вернуть singleton.enabled=false. Ночного receipt cron пока нет.
