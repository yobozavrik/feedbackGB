# Сверка categories → feedbackgb: полные чеки

29.09.2026. Live metadata через read-only SQL, без SELECT клиентских значений, INSERT/UPDATE/DELETE/DDL. Точное имя найденной схемы — `categories`, не `categries`. Новая migration043 **не применена**: live `to_regclass('feedbackgb.poster_receipt_import_runs')` вернул NULL. Другие schemas categories1/categories_poster2 не выбраны источником автоматически.

## Что подтверждено

| Таблица | Структура/ограничения | Решение для feedbackgb |
|---|---|---|
| categories.transactions | PK(transaction_id), дополнительный UNIQUE(transaction_id); денежные numeric; date_start/date_start_new/date_close/date_close_date timestamp WITHOUT time zone; spot/user/client/table/status/payment IDs; payment split, tips, tax/profit, free-text/customer fields | account×transaction identity, immutable versions; исходные даты/денежные строки и проверенная нормализация отдельно; private text только encrypted payload |
| categories.transaction_items | PK(id); FK(transaction_id) ON DELETE CASCADE; два одинаковых UNIQUE(transaction_id,product_id,modification_id); qty/bonus/price/payment/cost/profit/tax/fiscal metadata | PK(receipt_version_id,source_line_no), duplicate product lines разрешены; без cascading удаления финансовой истории |
| categories.clients | PK(client_id); ФИО/телефоны/email/address/comment/card/government_id/loyalty/bonus/ewallet; updated_at; **0rows** на момент запроса | referenced client snapshots из Poster, encrypted private response, current observation не историческое состояние |

У `transactions`, `transaction_items`, `clients`: relrowsecurity=false, grantee anon/authenticated имеют relation SELECT/INSERT/UPDATE/DELETE и другие grants. Это подтверждённая конфигурация, **не доказательство доступности через HTTP**: exposure/schema USAGE и endpoint не проверяли. Существующие grants/таблицы не изменены; новой схеме такая конфигурация не копируется.

Обычных user triggers на этих3tables нет. Новая043 добавляет immutable UPDATE/DELETE guards для archives/snapshots/version/lines. Полный клиентский доступ с аудитом и atomic publication ещё впереди.

## Объём и время

- pg_class.reltuples estimates: transactions1,222,866; transaction_items2,560,251. Это **оценки статистики**, не точные COUNT и не доказательство полноты.
- pg_total_relation_size, включает indexes/TOAST: transactions745,717,760bytes; transaction_items1,371,250,688bytes. Это не прогноз размера нового архива.
- Индексированные крайние ненулевые date_close:2025-01-02 08:49:35.817 →2026-09-28 17:36:05.108. Наличие крайних дат не доказывает все дни/магазины внутри. Исторические timezone/единицы не выведены из SQL-типа.
- PostgreSQL15.8. Partitions текущих3tables нет (relkind=r). Для нового архива решение monthly partitions остаётся после benchmark; гранулярность/индексы заданы независимо от него.

## Что берём и чего не копируем

1. Берём расширенный inventory header: open/start dates, status, user/table/guests, service/processing, payment method/card type/ewallet, tax/profit/tips, auto_accept/application. Source fields могут отсутствовать в конкретном ответе Poster — в проекции NULL, без синтетического заполнения из categories.
2. Берём line inventory: bonus_accrual, price, paid, fiscal/tax fields, cost/profit net/gross; плюс поля реального Poster sample, отсутствующие в categories line schema: product_sum, bonus_sum, cert_sum, discount, round_sum, type/workshop.
3. Не копируем неоднозначный timestamp WITHOUT TZ как доказанный UTC/Kyiv. Исходную date_close сохраняем, closed_at/business_date нормализуем только после контракта источника.
4. Не объединяем все money fields одним коэффициентом. *_source — исходное значение, registry хранит basis каждого endpoint/path. quantity unit остаётся unverified.
5. Не копируем повторяющиеся unique/indexes. В transactions дублируются PK и UNIQUE, spot indexes; в items два identical UNIQUE и несколько overlapping product/transaction indexes. Удалять старые индексы не авторизовано.
6. Уникальность item(transaction,product,modification) не гарантирует lossless source lines: два одинаковых nonnull product/modification в одном чеке конфликтуют. Реальная потеря строк этой системой **не доказана**: importer не проверен. Новая identity lineordinal этот риск исключает.
7. Не импортируем из categories автоматически. Это reference schema, не принятый источник полного первичного архива; полного raw receipt payload в transactions/items нет. Poster остаётся первичным источником.

## Файл для запуска и границы

`supabase/043_poster_receipt_archive_foundation.sql` создаёт **пустой foundation в feedbackgb**, без зависимости от042 и без ALTER/DROP/categories/public. Обёрнут BEGIN/COMMIT; preflight отказывается работать, если уже есть любой из семи объектов. Нет import grants/cron/data copy и consumer views, чтобы незавершённые данные не попадали в показатели.

SQL не исполнен на отдельном PostgreSQL/staging. Доказательства сейчас — metadata сверка, ручной review и static contract tests; **не runtime approval**. Рекомендуемый первый запуск — staging. Если владелец запускает в общей рабочей базе, это только additive empty foundation; нельзя обещать runtime-проверку, которой не было. Сразу после запуска выполнить `043_poster_receipt_archive_readback.sql` и вернуть результаты; ожидаем7tables с RLS=true, anon/authenticated SELECT=false, service INSERT=false,4immutable triggers. Импорт до следующих gates не включать.

Для тестов ограничений/ACL и EXPLAIN нужны staging либо согласованный способ безопасного отдельного PostgreSQL execution. Дозагрузка истории, encrypted client sync, full pagination, returns и nightly orchestration этой миграцией **не выполняются**.
