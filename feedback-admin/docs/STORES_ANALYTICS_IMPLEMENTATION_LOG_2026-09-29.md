# Исполнение Магазини → Аналітика

29.09.2026, branch `codex/technologist-product-cards`, base `21d46a8`.
План: `STORES_ANALYTICS_IMPLEMENTATION_PLAN_2026-09-29.md`.

## Граница итерации

Рабочая БД: только SELECT; никакие миграции/seed/claim/sync/DDL не запускались.
Рабочие UI/API/cron не менялись. Commit/push не выполнялись.
Старые миграции036–041 и пользовательские untracked документы сохранены.

| Этап | Статус | Основание |
|---|---|---|
| S-00 | passed в пределах structural preflight | Branch/status/live PG/schema/ACL проверены; это не доказательство release provenance всей истории миграций |
| S-01 | passed для согласованного дизайна/метрик | Пользователь поручил реализацию плана; receipt/turnover unavailable до принятия источника |
| S-02 | passed только для bounded source-access sample; blocked для receipts/refunds | Повторный history probe exit0,16read checks; full-day receipt pagination/rare cases не приняты |
| S-03 | passed для query contract |122tests календарь/scope/query, typecheck passed; actual endpoints ещё не подключены |
| S-04 | blocked на staging runtime gate |042foundation draft/readback/rollback/smoke готовы; SQL ни разу не исполнен; worker не переключён |
| S-05…S-15 | not started | Зависимый этап не начинается до SQL gate |

## Фактические read-only проверки

- PostgreSQL15.8; существуют feedbackgb.foodcost_sales_runs и backfill_jobs. analytics_source_policies отсутствует.
- pg_get_functiondef двух действующих seed/claimRPC подтвердил rolling120days и текущий registry scope. Live definitions совпадают с соответствующим ограничением040.
- Queue/attempts/events column types прочитаны, v_stores содержит integer id/text name. source dictionaries в public не создавались.
- ACL: service_role attempts INSERT=false/events INSERT=false; complete/fail RPC EXECUTE=true — precondition041 наблюдён.
- Runs:585completed versions, minimum date2026-09-10, maximum2026-09-28. Число versions не равно числу покрытых клеток.
- DISTINCT closed date×current-store coverage от2026-01-01: expected7046, completed494, missing6552; historical_roster_verified=false. Это metadata coverage, не новая fact-level reconciliation всех494клеток.
- Повтор `node scripts/probe-poster-analytics-history.mjs`: started2026-09-29T12:58:49.597Z,finished12:58:51.708Z,exit0,statuspassed; ограниченные январские/28Sepтоварные/накладные источники и receipt-page samples, не вся история.
- Probe не сохраняет raw receipt PII/credentials. Чековые выборки по2IDs сверены major currency→minor ×100 с dash report; редкие возвраты не подтверждены. Source hash28Sepdash-receipts изменился относительно прежнего probe: текущий `58b7325239ec36bc40d4c269ba1e2d3b8c982436a882147a2f457ee346a68a58`, поэтому нельзя называть источник неизменяемым.

Connector вернул ошибку на SELECT с завершающим semicolon; повтор без него прошёл. EXPLAIN(ANALYZE,BUFFERS) через connector не выполнен: wrapper вернул syntax error at/near analyze. Не присваивать seed performance statuspassed. Локальные psql/docker не найдены в PATH; отдельный staging в этом запросе не предоставлен.

## S-03: изменения

`lib/admin/storeAnalyticsQuery.ts`, его test:

- Default30closed days,overview,scope текущих выбранных магазинов.
-7views,calendar/multi-store/legacy adapters,unknown category отдельно.
- Page/page_size/search/sort bounds; ID canonical integer; duplicate/conflicting params reject.
- Caller не передаёт asOf/user_id/source token. Фиксированный clock приходит с сервера.
- Today/custom-to-today запрещены до provisional acceptance. Период пользователя не подрезается молча.
- Category/product IDs — локальные фильтры; выбранный store scope остаётся независимым denominator input.

Это pure parser: не выполняет auth, DB reads, denominator calculation или runtime role check. Those остаются обязанностью следующих endpoints.

## S-04: миграция042 — только первая часть shared foundation

Файлы `supabase/042_analytics_year_backfill_{foundation,readback,rollback,staging_smoke}.sql`:

-2новые таблицы: policy фиксированного baseline и timestamped current-roster observations; никаких guessedvalid_from/store-storage historical mappings.
-2новые seed/claimRPC с policy baseline2026-01-01, тем же queue/audit и8attempt/15minlease/SKIP LOCKED. Existing v1RPC/view иcompletion/failureRPC не меняются.
-2новые current-roster year coverage/health views, historical=false; missing-only coverage на уровне completed run metadata, не доказательство свежести источника или correct facts.
- Policy enabled=false после применения. Старый worker продолжает120days; применение042 само по себе не включает годовую загрузку.
- RLS, safe search_path, SELECT-only service_role relations/EXECUTE RPC, inherited/default privileges явно отзываются.
- Readback SELECT-only; staging_smoke делает transaction иROLLBACK, но **только staging**; rollback удаления foundation запрещён послеactivation/observations, старые queue/facts/history не удаляются.

042 **не закрывает весь исходный A-05/S-04**: отдельные refresh jobs/orchestration journal, confirmed validity intervals, их audit/configuration workflow ещё не реализованы. Refresh нельзя симулировать missing-only seed. Для этих частей понадобятся последующие свободные migration numbers, после inventory; applied migrations не переписываются.

14static SQL guards passed — это проверка текста/контракта. Не подтверждён execution PostgreSQL, ACL на новых объектах, race/rollback behavior или EXPLAIN. Production применение до runtime gate не рекомендовано.

## Проверки

```text
npm test -- ...analyticsPeriod.test.ts ...analyticsScope.test.ts ...storeAnalyticsQuery.test.ts
3files/122tests passed

npm test -- ...analyticsYearMigrationContract.test.ts ...storeAnalyticsQuery.test.ts
2files/49tests passed (14static SQL+35query)

npm test
79files/752tests passed,exit0,6.99s

npm run typecheck
exit0

npm run lint
exit0; те же3existingwarnings absences/schedules

git diff --check
exit0 (tracked changes); новыеSQL вручную прочитаны, это неSQLparser
```

Build/browser E2E новой реализации не запускались: UI/routes не изменены. Browser smoke прошлого макета не считается production acceptance.

## Требуется для продолжения зависимых этапов

Отдельный PostgreSQL15+/Supabase staging с совместимыми037–041, минимальным неперсональным fixture v_stores. Применить042там, выполнить readback и staging_smoke; дополнительно two-session distinctclaim/expiredowner/immutablejournals tests и EXPLAIN. Только после passed gate: выбрать activation/configuration workflow, перевести bounded worker на v2 и проверить январский claim; затем marts/year reader и реальныйUI.

Общую рабочую Preview/Production БД не называть staging. Permission на запись в общую БД не является результатом проверки SQL и не закрывает этот gate.

## Решение пользователя по чековому источнику

29.09.2026 подтверждён отдельный versioned import чеков+строк Poster → feedbackgb: backfill с01.01, ночная загрузка завершённых дней и recheck недавних дней; аналитика читает принятую историю Supabase. Live — сверка/provisional today. Решение внесено в раздел6плана.

Этой фиксацией изменены только документы. Новые запросы Poster/DB не запускались, таблицы чеков не созданы, cron не включён. Статусы S-04/S-11 не повышены: staging environment и полная семантика receipt/refund ещё не подтверждены.

## Дополнение: вся детализация и клиенты

Следующим сообщением пользователь расширил scope до всех receipt fields, клиентов, индексов/возможных partitions. Устаревшая формулировка «не импортировать PII клиентов» заменена в обоих планах; private encrypted customer/raw storage отделён от безопасных analytics projections.

Добавлены `POSTER_FULL_RECEIPT_IMPORT_CONTRACT_2026-09-29.md` и read-only script `probe-poster-receipt-fields.mjs`. Script syntax passed;live exit0,13:11:16.143–13:11:16.348Z,2receipt samples28Sep. Выведены только paths/types;source values/PII не выводились и не сохранялись. Customer enrichment не запускался. Официальная документация transactions.getTransactions/clients.getClient прочитана; guessed singular transactions.getTransaction doc вернула404 и не использована как основание API.

Подтверждены client_id/date_close/payment/bonus/discount/tax/profit/line fields; sample не подтвердил print receipt number/open-time/client contacts. Полнота — все реально возвращённые sourcefields, не обещание отсутствующих APIданных. Клиентская карточка today не историческая карточка январского чека. Monthly partitions — proposal с composite partition key/global identity directory, не применённая оптимизация. Runtime SQL/partition/encryption testing ещё не выполнено.

## 30.09.2026 — S-05/S-06/S-07/S-08, первый вертикальный срез

Статус: **код и локальные проверки passed; SQL runtime и авторизованный E2E blocked до применения миграции 050**.

Реализовано:

- `050_store_analytics_overview.sql`: service-role-only aggregate RPC поверх latest completed `foodcost_sales_runs` и accepted receipt archive. Raw payload/клиентские поля не возвращаются.
- Денежные KPI и trend возвращаются только при полной coverage дата×магазин. При пропуске `metrics=null`, частичный итог не показывается.
- Чеки имеют отдельную дневную coverage. `averageCheckMinor=null` с причиной `receipt_money_basis_unverified`: средний чек не вычисляется из несверенных популяций.
- `/api/admin/stores/analytics/overview`: только `super_admin`, server-owned `asOf`, current-roster membership, `private, no-store`, 400/403/503 без database/source details.
- `Мережа → Магазини → Аналітика`: общий период, multi-store, сравнение; рабочие вкладки `Огляд` и `Якість даних`; KPI, trend, рейтинг магазинов и явные missing states. Остальные согласованные вкладки видимы, но disabled до собственных read-model gates.
- При открытии `Магазини` или `Аналітика` страница больше не читает до 10 000 строк `feedback_feed` и пользователей: эти данные загружаются только для вкладки `Звіти`.

Проверки:

```text
targeted Vitest: 4 files / 50 tests passed
full Vitest: 94 files / 996 tests passed
typecheck: exit 0
lint: exit 0; только 3 прежних warning absences/schedules
production build: exit 0
new route present: /api/admin/stores/analytics/overview
git diff --check: exit 0, только существующие LF/CRLF warnings
```

Не проверено и не считается готовым:

- миграция 050 ещё не применена и не скомпилирована PostgreSQL;
- readback/ACL и фактические агрегаты рабочей БД не получены;
- `EXPLAIN (ANALYZE, BUFFERS)` не выполнен;
- авторизованный браузер, светлая/тёмная тема и responsive не приняты;
- вкладки `Магазини`, `Категорії`, `Товари`, `Проникнення`, `Порівняння` внутри аналитики ещё не реализованы;
- средний чек остаётся недоступен до отдельной сверки receipt money population.

Следующий gate: применить `050_store_analytics_overview.sql`, выполнить `050_store_analytics_overview_readback.sql`, проверить 7/30/YTD и один магазин, затем только переходить к браузерному E2E и следующей вкладке.

### Runtime-дефект 050 и forward-only исправление 051

Первый runtime-readback 050 завершился ошибкой PostgreSQL `42883: function max(uuid) does not exist`. Причина подтверждена в двух CTE выбора единственного accepted receipt run: был использован агрегат `max(r.id)` для UUID. PostgreSQL 15 сортирует UUID, но встроенного агрегата `max(uuid)` не предоставляет.

Применённую 050 не переписываем. Добавлена миграция `051_store_analytics_overview_uuid_aggregate_fix.sql`: она проверяет точную сигнатуру и ровно два ожидаемых вхождения, заменяет их через `CREATE OR REPLACE` на `min(r.id::text)::uuid`, затем повторно проверяет сохранённое определение. Пользовательские данные и права не меняются. Runtime после 051 ещё не проверен.

После применения 051 runtime RPC проверен read-only отдельно:

- сеть 16–22.09: `182/182`, revenue `485251228` minor, classic foodcost `39.69%`, `15700` чеков, 26 магазинов, 7 trend points;
- магазин `Клуб` (spot18) 16–22.09: `7/7`, revenue `18798728` minor, classic foodcost `38.79%`, `574` чека, 7 trend points;
- anon RPC: HTTP401 / PostgreSQL42501;
- 23–29.09: честный `incomplete`, `156/182`, отсутствуют 26 клеток за 29.09; metrics/trend/stores не возвращаются.

Первый browser redirect выявил потерю query: middleware записывал в `next` только pathname. Исправлено сохранение pathname+search и добавлена client-side проверка внутреннего `next`, чтобы фильтры аналитики переживали PIN-вход без open redirect.

### Runtime/E2E gate после 051 и продолжение S-08

30.09.2026 проверено на свежей локальной production-сборке, подключённой к рабочему read-only analytics RPC:

- middleware HTTP 307 сохраняет полный внутренний `next` с query; `safeLoginNext` отклоняет внешние/двойные slash/backslash/CRLF targets;
- 23–29.09, вся сеть: UI показывает `156/182`, скрывает KPI/trend/ranking и не публикует частичную сумму;
- 16–22.09, вся сеть: UI показывает revenue `4 852 512,28 ₴`, classic foodcost `39,69%`, `15 700` чеков, sales `182/182`, receipt days `7/7`;
- вкладка `Якість даних`: `182/182`, `7/7`, explicit no-missing state;
- новая вкладка `Магазини`: рейтинг 26 точек, точные BigInt доли, foodcost tags, отсутствие Δ при incomplete comparison;
- drilldown `Клуб`: URL scope `spot_ids=18`, revenue `187 987,28 ₴`, foodcost `38,79%`, `574` чеков, `7/7`; возврат `До всіх магазинів` сохраняет период/view;
- light/dark desktop screenshots просмотрены, browser console warning/error пуст на чистой вкладке.

Проверки после последнего изменения:

```text
targeted Vitest: 3 files / 45 tests passed
full Vitest: 97 files / 1011 tests passed
typecheck: exit 0
lint: exit 0; только 3 прежних warning absences/schedules
production build: exit 0; /admin/stores 19.8 kB, First Load JS 1.13 MB
```

Ограничения не сняты: средний чек не вычисляется; historical roster не подтверждён; incomplete comparison не даёт Δ; `Категорії`, `Товари`, `Проникнення`, `Порівняння` ещё disabled; EXPLAIN и concurrency budget S-14 не выполнены. Первый `next start` smoke был испорчен параллельно работавшим `next dev`, который перезаписывал `.next`; после остановки конфликтующего процесса, чистой пересборки и новой вкладки production E2E прошёл.

## 30.09.2026 — S-09, категории и товары

Статус: **локальный код passed; SQL runtime, EXPLAIN и browser E2E blocked до применения 052**.

Реализовано:

- forward-only `052_store_category_product_analytics.sql` с private helper latest-facts и service-role-only reader;
- рейтинги категорий: выручка, доля всей выбранной сети, изменение, изменение доли, фудкост, охват магазинов, число товаров;
- таблица товаров с bounded pagination/search/sort, количеством, выручкой, долей, изменением, фудкостом, средней ценой реализации и охватом;
- identity товара не схлопывает модификации и единицы: `product_id + modification_id + category_id + unit + weight_based`;
- unknown category сохраняется как `Без категорії`; conflict flags не превращаются в выдуманное имя;
- карточка выбранной identity с revenue trend; при unit conflict количество trend становится `null`, а не суммируется;
- `/api/admin/stores/analytics/categories` и `/products`: только `super_admin`, server-owned `asOf`, bounded filters/pagination, no-store;
- drilldown category → products → product использует history navigation; Back восстанавливает scope;
- penetration остаётся явным `unavailable` с причиной `receipt_line_quantity_and_money_basis_unverified`.

Проверки до SQL runtime:

```text
targeted Vitest: 4 files / 49 tests passed
typecheck: exit 0
lint: exit 0; только 3 прежних warning absences/schedules
production build: exit 0; routes categories/products присутствуют
git diff --check: exit 0, только LF/CRLF warnings
```

Не проверено и не считается готовым:

- PostgreSQL ещё не компилировал 052;
- readback/ACL и реальные суммы category/product не получены;
- паритет category sum = network revenue и product/category samples не проверены на рабочей БД;
- `EXPLAIN (ANALYZE, BUFFERS)` не выполнен, поэтому дополнительные индексы не добавлялись вслепую;
- вкладки не проходили browser E2E на реальных данных;
- heatmap магазин × категория не входит в этот первый S-09 срез;
- вкладки `Проникнення` и `Порівняння` остаются disabled.

Следующий последовательный gate: применить 052, выполнить readback, проверить полный 7-дневный период сети и одного магазина, сверить суммы и EXPLAIN. Только затем browser E2E и решение по heatmap.

### Runtime-дефект 052 и forward-only исправление 053

Первый runtime sample 052 подтвердил компиляцию reader и корректный fail-closed для неполного периода 23–29.09: `156/182`, 26 пропусков за 29.09, categories/products пусты. Одновременно найден дефект: comparison 16–22.09 имел статус `complete`, но `totalRevenueMinor="0"`. Причина в коде 052: вычисление comparison total находилось внутри `if v_current_complete`, поэтому при неполном current сохранялось начальное значение 0.

Применённую 052 не редактируем. Добавлена forward-only `053_store_catalog_comparison_total_fix.sql`, которая проверяет точную сигнатуру и ожидаемый фрагмент сохранённого определения, переносит вычисление comparison total за пределы current gate и проверяет замену. Readback повторяет reported regression и отдельно проверяет полный период 16–22.09, ненулевые category/product rows и reconciliation суммы категорий с network total.

### Runtime/E2E gate после 053

Пользователь применил 053. Readback полного периода 16–22.09 подтвердил:

- `status=complete`, 27 категорий, 315 товарных identity, первая страница 25 строк;
- network revenue `485251228` minor;
- сумма категорий `485251228` minor, `categories_reconcile=true`.

Browser E2E выявил, что sales snapshot хранит category ID, но названия категорий в этом аккаунте Poster отсутствуют: все 27 ID ошибочно отображались как `Без категорії`. Исправлено без изменения фактов продаж:

- ID, суммы и группировка остаются из исторического snapshot/RPC;
- display name для известного ID берётся из текущего `menu.getCategories` и помечается как `current_poster_catalog`;
- при недоступном справочнике показывается `Категорія #ID`, а не ложное `Без категорії`;
- настоящий `category_id=null` остаётся `Без категорії`;
- интерфейс явно сообщает, что названия взяты из текущего справочника Poster.

Финальные проверки этого среза:

```text
targeted Vitest: 3 files / 20 tests passed
full Vitest: 102 files / 1034 tests passed
typecheck: exit 0
production build: exit 0; /admin/stores 22.1 kB, First Load JS 1.13 MB
browser console warning/error: []
```

Авторизованный production E2E на `localhost:3210`:

- сеть 16–22.09: реальные названия категорий, 27 строк, fallback раскрыт пользователю;
- drilldown `Пельмені` → 12 товаров категории;
- drilldown `Пельмені зі свинини`: revenue `231 209,02 ₴`, quantity `1 220,805 кг`, average price `189,39 ₴/kg`, trend block;
- `До списку` сохраняет category filter и период;
- scope `spot_ids=18` отрабатывает без ошибки и показывает охват `/1`;
- неполный 7-дневный период скрывает частичный рейтинг и показывает предупреждение.

Ограничения остаются явными: historical roster не подтверждён; проникновение по чекам не считается; неполное comparison не даёт delta; отдельная heatmap магазин × категория и `EXPLAIN (ANALYZE, BUFFERS)` остаются следующими шагами.

## 30.09.2026 — S-10, сравнение периодов и вклады

Статус: **код, tests/build и контрольный runtime passed; бизнес-сравнение разных полных окон blocked качеством истории**.

Реализовано без новой миграции поверх принятых readers 050/053:

- защищённый `/api/admin/stores/analytics/comparison`, только `super_admin`, no-store;
- overview и category reader получают один `scope` и один server-owned `asOf`;
- отдельный custom comparison RangePicker; два периода сохраняются в URL;
- absolute revenue и revenue/day показаны отдельно, поэтому окна разной длины не сравниваются как равные totals;
- signed contributions магазинов и категорий; переходы к магазину и товарам категории;
- сумма вкладов магазинов и категорий обязана совпасть с общей Δ; несошедшийся блок скрывается;
- incomplete current/previous скрывает KPI и вклады, а не публикует частичный результат;
- явная подпись: это текущий выбранный roster, не like-for-like cohort.

Проверки:

```text
targeted Vitest: 2 files / 8 tests passed
full Vitest: 104 files / 1042 tests passed
typecheck/build: passed
production build: /admin/stores 23.3 kB, First Load JS 1.14 MB
browser console warning/error: []
```

Runtime:

- 16–22.09 против 09–15.09, вся сеть и отдельно Клуб: previous incomplete, UI честно показывает unavailable;
- 16–22.09 против 01–07.08: previous incomplete, UI честно показывает unavailable;
- контроль 16–22.09 против тех же 16–22.09: оба окна complete, `4 852 512,28 ₴` против `4 852 512,28 ₴`, Δ `0,00 ₴`, revenue/day `693 216,04 ₴` с обеих сторон;
- 26 store contributions и 27 category contributions reconciled с общей нулевой Δ;
- category drilldown `Вареники` открыл `view=products&category_id=5` с сохранением обоих периодов.

Ограничение: это доказывает runtime-механику и reconciliation, но не реальное изменение между двумя разными полными периодами. Для бизнес-приёмки S-10 нужно дозагрузить хотя бы одно отличающееся полное окно; до этого статус полного бизнес-gate остаётся blocked.
