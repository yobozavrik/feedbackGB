# Цены, фудкост и продажи: история с 1 января, календарь и ночная синхронизация

Дата: 29.09.2026. Основание кода: `2bda13d`, ветка `codex/technologist-product-cards`.

Ход исполнения: `FOOD_COST_YEAR_HISTORY_IMPLEMENTATION_LOG_2026-09-29.md`. Ниже сохранён проектный план; наличие плана или локального кода не означает применение миграций или готовый годовой интерфейс.

Статус: **план, не реализация**. При подготовке прочитаны код, миграции и метаданные рабочей БД через SELECT. Код приложения, БД и настройки cron не изменены. Имена новых объектов ниже — проектные; номера миграций необходимо повторно проверить перед реализацией.

## 1. Цель и границы

Создать один достоверный аналитический контур Poster → Supabase `feedbackgb` → админка:

- История продаж и накладных с **01.01.2026**, без автоматического удаления старых лет.
- Стандартные периоды и произвольный диапазон через календарь во всех связанных вкладках и карточках.
- Общая сеть, отдельный магазин и несколько магазинов; отдельно фильтр складов для закупок.
- Одинаковые даты при переходах «Огляд → категория → товар → магазин → график».
- Полные дневные товарные продажи, обе существующие методики фудкоста, цены закупки, история наблюдаемой цены реализации.
- Отдельный чековый слой для детальных продаж, способов оплаты, скидок и возвратов, насколько их позволяет доказать API Poster.
- Ежедневное ночное обновление, повторная сверка исправлений, восстановление после ошибок, видимость полноты и свежести.
- Графики трендов без ложных нулей, усреднения процентов и скрытого обрезания данных.

**Не входит:** изменение цен в Poster, отправка продаж обратно в Poster, перерасчёт его бухгалтерии, изменение PIN/продавцов/фотоотчётов. Не создавать объекты в `public` или менять ERP-таблицы `categories`.

Полнота имеет несколько независимых уровней: товарные дневные суммы, чековые данные, накладные, исторический состав сети, история цен. «Всё загружено» без указания этих уровней запрещено.

## 2. Что подтверждено сейчас и почему фильтр не решает проблему

| Узел | Подтверждённое текущее поведение | Что требуется |
|---|---|---|
| `foodcostPeriod.ts` | Только 7/14/30/60 завершённых киевских дней | Единый контракт диапазона |
| `foodcostSalesRead.ts` | Запрещает более 60 дат; читает факты страницами в JS | Серверные агрегаты и явная пагинация детализации |
| `foodcostRecentNetwork.ts` | Сверяет текущий состав `access.getSpots` с `v_stores`; исторический состав не подтверждён | Историческая принадлежность магазинов и отдельный статус качества |
| `foodcostSalesNightlyWorker.ts` | Missing-only, максимум 80 jobs/210 с; проверяет 120-дневную границу | Загрузка с 1 января, refresh и управление бюджетом |
| Миграция 040 | Seed/claim/coverage/health привязаны к 120 дням | Forward-only изменение всех связанных контрактов |
| `posterSalesSync.ts` | Умеет повторно сверять день и создать новую версию при изменении; missing-only это обходит | Использовать существующую версионность для refresh |
| `foodcostSupplyPrices.ts` | Читает один последний completed snapshot накладных | История документов независимо от 30-дневных snapshots |
| `posterSupplyPrices.ts` | Привязывает конец периода к `snapshotTo`, не к выбранному календарю | Общие явные `from/to` |
| `posterSupplySync.ts` | 30-дневное окно, seeded-list, completed run повторно не проверяется | Инкрементальная история, изменения и удаления накладных |
| `categories.spots` | В live metadata есть ID, имя, адрес, координаты, `is_deleted`; нет дат открытия/закрытия | Не выдумывать даты работы из текущего справочника |
| `poster_supply_cost_documents` | В live metadata есть `storage_id`, дата и JSON lines | Сохранить склад и нормализовать строки |
| `vercel.json` | Пять слотов sales и два supply, расписание UTC | Проверить реальное Production исполнение и производительность |

Предыдущая приёмка недели и сообщение пользователя о `494/780` относятся к конкретному проверенному срезу. Это не обещание текущего полного годового покрытия. В этом планировании годовые продажи заново не выгружались и рабочая база не наполнялась.

Опорные файлы:

- `src/lib/admin/foodcostPeriod.ts`, `foodcostSalesRead.ts`, `foodcostRecentNetwork.ts`.
- `src/lib/admin/foodcostSalesNightlyWorker.ts`, `posterSalesSync.ts`, `posterSalesMath.ts`.
- `src/lib/admin/foodcostSupplyPrices.ts`, `posterSupplyPrices.ts`, `posterSupplySync.ts`, `posterSupplyCostMath.ts`.
- `src/app/(admin)/admin/technologist/food-cost/page.tsx`, `food-cost-workspace.tsx`.
- `src/app/api/admin/technologist/food-cost/**`, `src/app/api/admin/technologist/products/[id]/food-cost/route.ts`.
- `src/app/api/cron/poster-foodcost-sales/route.ts`, `vercel.json`.
- Миграции 036–041; applied-файлы не редактировать.

## 3. Пользовательский интерфейс: единый фильтр

### 3.1. Стандартный выбор

Сохранить дефолт **7 завершённых дней**. Предложенные пункты:

1. Сьогодні — отдельный предварительный режим, не completed ночной отчёт.
2. Вчора.
3. 7, 14, 30, 60, 90 завершених днів.
4. Поточний місяць — с первого числа до вчера; отдельно переключатель предварительного сегодня.
5. Попередній місяць — полный календарный месяц.
6. Поточний квартал — до вчера.
7. З початку року — 1 января текущего года до вчера.
8. Весь доступний період — от 01.01.2026 до вчера.
9. Власний період — календарь `від — до` и кнопка «Застосувати».

При смене года «З початку року» начинает новый год, но «Весь доступний період» сохраняет 2026 и последующие годы. Ничего не удалять по наступлению 1 января.

### 3.2. Календарь и сегодня

- Нижняя разрешённая дата истории: `2026-01-01`; верхняя: сегодняшний день `Europe/Kyiv`.
- Диапазон включительный. Проверять существование даты, порядок, повторяющиеся query params, будущие даты и размер запроса.
- Если выбрано сегодня, UI прямо показывает: **«Сьогодні — попередні дані, оновлено …»**.
- Completed исторические KPI по закрытым дням и предварительное сегодня показывать раздельно. Не обрезать конец запроса до вчера молча.
- Первый релиз календаря допускает выбрать сегодня, но до готовности provisional-загрузчика показывает «Дані за сьогодні ще недоступні»; не заявляет полный диапазон. Финальная приёмка включает работающий provisional-контур.
- Ночной cron обновляет закрытые дни. Для «сегодня в моменте» нужен отдельный bounded fetch с коротким кэшем/очередью; ночной cron этого не обеспечивает.
- АнтД `Select`, `DatePicker.RangePicker`, существующие шрифты, размеры, токены и светлая/тёмная темы. Новую дизайн-систему не вводить.
- Выбор даты не запускает массовое наполнение БД из браузера. Недостающие данные попадают в устойчивую очередь отдельным авторизованным процессом.

### 3.3. Магазины и склады

- По умолчанию «Уся мережа», далее один/несколько магазинов и «Вибрати всі».
- Исторические/удалённые магазины остаются доступны для истории; текущий `v_stores` не должен скрывать старые продажи.
- Для продаж фильтр — `spot_id`. Для закупок — `storage_id` и подтверждённая связь склада с магазином на дату документа.
- Центральные/производственные склады — отдельный scope «Центральні та виробничі склади»; не разносить их закупки поровну на магазины.
- Магазин без прямой закупки получает «Немає прямих постачань», а не цену сети под видом цены магазина.
- Неподтверждённая связь склада с магазином — отдельная проблема данных, не угаданный join по имени.

### 3.4. Общий URL и API контракт

```text
?tab=overview&period=custom&from=2026-01-01&to=2026-09-28
&spot_ids=1,2&grain=week&comparison=previous
```

`all` — отдельное значение, не смешивать с ID. Сохранять scope магазина/категории/товара/методики во всех ссылках. Существующие `days=7|14|30|60` и `spot_id` поддержать через adapter; конфликт старых и новых параметров — 400, не случайный приоритет.

Ответ содержит: requested/effective closed/provisional windows, timezone, scope, `asOf`, методику, выбранные ревизии, coverage по каждому источнику, freshness, quality issues, суммы, пагинацию. Деньги bigint возвращать decimal strings; дробные количества — decimal strings. Не пропускать значения за пределами `Number.MAX_SAFE_INTEGER` через JS Number.

Для custom multi-year чтения ограничивать число chart buckets, page size и server execution budget, а не молча обрезать историю. Детализация — cursor pagination; превышение синхронного export budget переводит выгрузку в устойчивый job. Year-to-date не ограничивать 60 датами старого loader.

## 4. Контракт источников Poster

Документация проверена 29.09.2026. Документация подтверждает интерфейс, но не фактическую доступность нашей истории, права токена или поведение возвратов. Это отдельный live gate.

| Источник | Использование | Ограничение |
|---|---|---|
| `dash.getProductsSales` | День × магазин, все строки товаров/модификаций; два варианта прибыли | Это агрегат, не список чеков; даты `Ymd` включительно |
| `transactions.getTransactions` | Страницы чеков с товарами, способами оплаты, округлением | В прочитанной документации нет параметра `spot_id`: выгружать сеть за день, затем разделять по returned spot_id; проверить live |
| `storage.getSupplies` | Список накладных и deleted-флаг | При `dateFrom/dateTo` limit/offset по документации игнорируются; использовать небольшие календарные окна |
| `storage.getSupplyIngredients` | Все строки накладной, количества, единицы, денежные суммы | Нормализовать, сохранить источник и сравнить суммы |
| `menu.getProducts`, `menu.getProduct` | Каталог, текущие цены по точкам, текущая техкарта | Текущая техкарта/цена не восстанавливает январскую автоматически |
| `menu.getIngredients`, `menu.getCategories` | Имена и текущий справочник | ID первичны; новые имена не переписывают исторические снимки |
| `access.getSpots` | Текущий состав точек/склады | Текущий список не доказывает исторические даты открытия |

Первичные ссылки:

- [Товарные продажи](https://github.com/joinposter/docs/blob/master/en/web/dash/getProductsSales.md).
- [Чеки и пагинация](https://github.com/joinposter/docs/blob/master/en/web/transactions/getTransactions.md).
- [Накладные](https://github.com/joinposter/docs/blob/master/en/web/storage/getSupplies.md).
- [Строки накладных](https://github.com/joinposter/docs/blob/master/en/web/storage/getSupplyIngredients.md).

### 4.1. Что означает «продажи все, полные»

Обязательные уровни:

1. Каждая ожидаемая дата/магазин проверена, включая дни с подтверждённым пустым ответом.
2. Внутри ответа сохранены **все** строки, модификации, удалённые товары и отрицательные значения, если они валидно возвращены источником.
3. Никаких `.limit(5000)` без полного чтения, Map по одному product_id или выбора только топа для подсчёта общего итога.
4. Чековый контур: все страницы/чеки/позиции, контроль declared count, уникальности и суммы. Топ-N применяется только к представлению рейтинга.
5. Возвраты, удаления, отмены, бесплатные чеки, сертификаты/бонусы и округление имеют явные правила и доказательства.
6. Нельзя объявлять чековую полноту по совпадению товарного агрегата; API может иметь отличающуюся популяцию/методику.

`transactions.getTransactions` документирует fiscal return flag, но это не доказательство полного бизнес-возврата. До live-проверки нельзя обещать восстановление всех возвратов. Gate должен определить нужные дополнительные read-методы, статусы и контрольные кейсы. Клиентские имена, телефоны и платёжные реквизиты для этого раздела не нужны и не сохраняются.

**Уточнение по live-проверке 29.09.2026:** для четырёх контрольных чеков за 15.01 и 28.09 `transactions.getTransactions.payed_sum` — decimal major currency, а `dash.getTransactions.payed_sum` — integer minor currency. Например, `18.50` соответствует `1850`, `724.50` соответствует `72450`. Парсер чеков должен иметь отдельный money contract; нельзя переиспользовать integer parser товарных отчётов без преобразования. Семантику остальных денежных/процентных полей проверять отдельно, не переносить вывод автоматически.

### 4.2. История цен имеет предел доказуемости

- Закупочная цена с января восстанавливается из реальных накладных.
- Фактическая средняя цена продажи восстанавливается из суммы оплаты и проданного количества при подтверждённой единице; подписывать «Фактична середня ціна», не «Прайс».
- Установленная цена реализации по магазину фиксируется с момента начала нашего наблюдения. Январский прайс не выдумывается из сегодняшнего меню.
- Исторический рецепт/норматив доступен только если есть подтверждённая версия. Пересчёт старых продаж по сегодняшней техкарте — сценарная оценка, не исторический факт.

## 5. Методики и правила вычисления

### 5.1. Продажный фудкост: сохранить существующий контракт

Для периода, магазина, категории, продукта и любого chart bucket:

```text
paid = Σ payed_sum
profit = Σ product_profit
netto_profit = Σ product_profit_netto, только если поле есть во всех фактических строках
inferred_cost = paid - profit
netto_inferred_cost = paid - netto_profit
FC_A = inferred_cost / paid × 100
FC_B = netto_inferred_cost / paid × 100
```

`paid <= 0` → процент Н/Д; суммы/отрицательные значения сохраняются. Не усреднять проценты магазинов/товаров/дней. NULL netto не превращать в 0, `SUM` с игнорированием NULL не выдавать за полный netto.

FC_B — **совместимая существующая методика проекта**, не новая претензия на бухгалтерски чистый VAT-adjusted foodcost. Различие с FC_A и знаменатель явно описывать в help. Изменение формул/методики только отдельным утверждённым решением и новой methodology_version.

Себестоимость в гривнах, фудкост в процентах, закупочная цена и сценарный норматив — разные показатели.

Цвета существующие: <35% зелёный, 35–45% включительно жёлтый, >45% красный; отсутствующие/неполные/аномально отрицательные данные — нейтральный статус и проблема качества, не «хорошо».

### 5.2. Цены сырья

```text
weighted_purchase_price = Σ line_sum_minor / Σ normalized_quantity
```

Группировка минимум `(ingredient_id, unit, currency, scope)`. Для периода использовать суммы и количества оригинальных строк, не среднее дневных средних и не среднее цен накладных. Не округлять промежуточные расчёты; форматирование выполняется в UI.

День без закупки имеет Н/Д цены; объём/сумма 0 допустимы только при проверенном полном списке без документов. Последняя известная цена может отображаться отдельной пунктирной линией с фактической датой, но не подменять наблюдение этого дня.

Единицы: `kg → кг`, `l → л`, `p → шт`; g/kg и ml/l преобразовывать явно. Кг и шт не суммировать, весовые цены /100 г и /кг различать. Изменение единицы продукта/ингредиента не скрывать агрегацией.

### 5.3. Закупки и техкарта

В карточке оставить согласованный ранее сравнительный слой «Накладні за 30 днів, уся мережа» с собственным label/window. Он не должен незаметно становиться годовым при выборе годовых продаж.

Дополнительно можно выбрать «За обраний період» или склад. Пересчёт брутто по закупочным ценам подписывать как расчётную стоимость, отдельно от Poster. Версия рецепта/выход/единицы/период/склады обязательны; недостающие компоненты → неполный расчёт, не 0.

## 6. Архитектура хранения в feedbackgb

Не создавать дубликаты существующих sales facts. Сохранить 036–041 и добавить forward-only объекты. Нумерация ниже предварительная, до реализации сверить локальную и live историю.

```text
Poster read API
  → устойчивые jobs / attempts / безопасные source envelopes
  → immutable sales runs+facts / версии накладных / чековые версии
  → verified completion + per-run агрегаты
  → read RPC с единым asOf и coverage
  → Огляд / Категорії / Позиції / Ціни / Магазини / карточка
```

### 6.1. Миграция 042: горизонты, магазины и управление загрузкой

| Объект | Назначение и ключ |
|---|---|
| `analytics_source_policies` | Источник, history_start=2026-01-01, timezone, refresh lookback, budget, enabled; настройки только через защищённый workflow |
| `analytics_spot_history` | Версионная подтверждённая принадлежность магазина сети, имя, valid_from/to, evidence, confirmed_by/at; запрет пересечения диапазонов |
| `analytics_storage_spot_history` | Связь склад→магазин/central/production на период; запрет неоднозначной принадлежности одного склада |
| Расширение существующей sales queue | Seed/claim/health от configured history_start; добавить priority, source-purpose для refresh через отдельную refresh queue, не сбрасывать completed попытки |
| `analytics_refresh_jobs` | Повторные проверки источников, ключ `(source, scope_key, period_start, period_end, cycle_key)`; owner/lease/retry/outcome |
| `analytics_sync_runs` | Ночной orchestration run: planned/processed/failed, deadline, checked_at, correlation_id, безопасный error_code |
| `analytics_sync_events` | Append-only события refresh/orchestration; старые backfill attempts/events переиспользуются, не копируются |

Источник исторического состава — подтверждённые ERP/Poster/операционные сведения, не первая найденная продажа. До подтверждения: можно честно предоставить «данные выбранных текущих магазинов», но нельзя подписать «полная сеть с января». Поздно открывшаяся точка до открытия — `not_applicable`, не missing и не нулевая продажа.

Исторические spot IDs из фактов не удаляются и не требуют нахождения в текущем access.getSpots. Право токена читать такую точку проверяется отдельно. Нет доступа — явный blocked, без подмены сегодняшним магазином.

### 6.2. Миграция 043: дешёвое чтение продаж и контроль полноты

Переиспользовать `foodcost_sales_runs`, `foodcost_sales_facts`, leases и completion RPC. Добавить поля run/source envelope или связанную таблицу для safe JSON исходных товарных строк, SHA-256, parser_version и last_verified_at; не хранить token-bearing request URL. Область payload должна пройти review.

Сохранение «всех полей» означает также source fields, которые старый parser не нормализует, например tax/vat и deleted/modifier metadata, если они реально есть в ответе. Добавлять их в typed facts только после live проверки семантики; raw source envelope не должен теряться из-за whitelist старого parser. Чековый discount в процентах не складывать с товарным discount в копейках.

Derived tables привязать к **run_id**, а не перезаписывать единственный день:

- `foodcost_sales_run_product_totals`: run × product × modification × историческая category × unit/weight basis; nullable category идентичность кодировать без коллизий и с CHECK.
- `foodcost_sales_run_category_totals`: run × category, деньги и флаги полноты nullable полей; отдельные количества по единицам, не одно «количество всего».
- `foodcost_sales_run_totals`: один row/run, денежные суммы, счётчики, coverage nullable fields, parser/methodology_version.

Новая completion RPC в одной транзакции проверяет fact counts/order/sums, строит per-run marts, затем делает run видимым. Не выполнять HTTP/Poster calls из SQL-триггеров. Исторические completed runs заполнить marts небольшими партиями с readback; до готовности SQL-view fallback по фактам, без молчаливой потери строк.

Views/RPC:

- `v_foodcost_sales_latest_completed`: latest eligible completed per date/spot, не SUM всех версий.
- `v_foodcost_sales_coverage`: expected matrix по датам/подтверждённым интервалам и source checks.
- `v_foodcost_sales_sync_health`: история/очередь/свежесть/backlog по магазинам, а не fixed120.
- `read_foodcost_sales_period(p_from,p_to,p_spot_ids,p_as_of,p_grain,...)`: overview/trends/категории/товары; previous window проверяется независимо.
- `read_foodcost_product_history(...)`: выбранный товар/магазины, тренд, единицы и source versions.

RPC с `asOf` выбирает только runs `completed_at <= asOf`; marts сохраняют версии, поэтому обновление в середине запроса не сдвигает прежнюю выборку. Для today используется отдельная provisional выборка с явным timestamp, не latest completed.

Для today в 043 предусмотреть `analytics_provisional_snapshots`: source × local_date × scope × observed_at, safe payload/hash, parsed metrics, stage/status и срок кэша. Ни одна provisional запись не входит в closed coverage или существующий completion RPC. Обновление только через защищённый bounded backend fetch, single-flight lease и rate limit; предложение TTL — 5 минут, окончательно после замера API. Если fetch неудачен, предыдущий snapshot остаётся с явным stale timestamp, не «данные сейчас». При закрытии дня ночной процесс заново читает источник и создаёт обычный completed run, а не просто меняет provisional status.

Индексы-кандидаты: существующий latest completed оставить; `(run_id, product_id, modification_id, unit)`, `(product_id, run_id)`, `(category_key, run_id)` для marts; очереди `(priority, next_attempt_at, date)` partial по pending; истории EXCLUDE/периодные индексы. Добавлять только после EXPLAIN, не дублировать существующие.

### 6.3. Миграция 044: история накладных и наблюдаемых цен

- `poster_supply_history_runs`: маленькое окно списка документов, source version, expected IDs/hash/count, status, verified_at, completed_at, error_code.
- `poster_supply_document_versions`: run × supply_id, storage/supplier IDs, дата, deleted, source_hash, metadata; строки неизменяемы после completion.
- `poster_supply_line_versions`: document-version × source_line_no; ingredient_id, name_snapshot, quantity numeric, unit, sum_minor bigint, netto_minor nullable, currency.
- `poster_product_price_observations`: observed_at/snapshot_id × product × modification × spot, price_minor, price_basis, currency, visibility, parser_version.
- `analytics_catalog_snapshots`: versioned безопасный каталог/единицы/справочники и, если нужен норматив, версии техкарт; observed_at не выдавать за effective_at в прошлом.

Публиковать supply run только когда list и все details подтверждены. При исчезновении документа отличать подтверждённое удаление/перенос даты от неполного ответа. Хранить tombstone с доказательством; failed fetch не удаляет старый документ. Для arbitrary asOf latest document выбирается по подтверждённым версиям; отсутствие строки в новом partial batch не доказательство удаления.

Перенос даты накладной требует invalidation старого и нового дня. Period coverage не становится свежим только потому, что мы повторно прочитали один detail. При изменении склад/единица также пересчитать оба прежних/новых scope.

Views/RPC:

- `v_poster_supply_history_latest`, `v_poster_supply_lines_latest` — один действующий документ, без дублей overlapping snapshots.
- `v_poster_supply_coverage` — проверка диапазона списков + всех деталей, включая подтверждённые empty дни.
- `read_ingredient_purchase_prices(...)` — weighted sums/quantities, daily trend, last purchase, quality; магазины через подтверждённый storage mapping.
- `read_product_price_history(...)` — отдельно observed прайс и фактическая цена продажи.

Индексы-кандидаты: `(supply_id, completed_at desc)` через metadata/version, `(storage_id,supply_date)`, `(ingredient_id,document_version_id,unit)`, `(product_id,spot_id,observed_at desc)`. Никаких UNIQUE по одному ingredient в накладной: возможны несколько строк.

036 snapshots остаются для совместимости. Миграция старых documents в историю выполняется идемпотентно с dedupe по supply_id+проверенной версии, не SUM overlapping snapshots. Старые данные не получают invented supplier/tax/netto values.

### 6.4. Миграция 045: полная чековая детализация

- `poster_receipt_import_runs`: день/сетевой scope, source counts/pages/hash, stage/status, verified_at.
- `poster_receipt_versions`: import_run × transaction_id, spot_id, date_close и source timezone, безопасные денежные поля и source statuses.
- `poster_receipt_line_versions`: receipt-version × source_line_no, product/modification, numeric quantity, source payment/discount/tax fields.
- `v_poster_receipts_latest`, `v_poster_receipt_lines_latest`, `v_poster_receipt_coverage` и paginated read RPC.

Сохранять повторные товарные строки, порядок и связь с версией чека. Уникальность чека проверять в пределах согласованного scope аккаунта, не по номеру кассы. Дополнение пользователя29.09: нужен полный источник, включая клиентские данные. Raw receipt payload и клиентские snapshots хранятся в отдельном защищённом контуре feedbackgb; публичные/обычные аналитические проекции не содержат PII. Полный контракт, индексы и ограничения месячных partitions: `POSTER_FULL_RECEIPT_IMPORT_CONTRACT_2026-09-29.md`. Source/API credentials не архивируются.

Poster pagination не даёт нам автоматически транзакционный snapshot источника. Сохранять manifest count/page IDs, отлавливать drift count/duplicates, повторять изменившийся дневной список перед публикацией и сверять контрольные деньги. Времена начала/конца fetch и границы проверки отражать в отчёте. `asOf` фиксирует уже опубликованные версии нашей БД, но не делает несколько HTTP страниц одним atomic Poster snapshot. При неподтверждённой стабильности imported day остаётся unverified, не получает ложный «полный» статус.

### 6.5. Материализованные view: не создавать без замера

На старте — indexed per-run aggregate tables + views/RPC. Это сохраняет asOf и не требует полного REFRESH всего года ночью.

Если после EXPLAIN и нагрузки не выполняется бюджет, отдельно оценить `mv_foodcost_sales_daily`/category mart. У MV обязательны unique key, SELECT-only ACL, версия публикации, refresh lease, lag/freshness и атомарный snapshot. UNIQUE key учитывает nullable категории. `REFRESH ... CONCURRENTLY` и его требования проверяются на реальной PG версии. MV не заменяет coverage и не считается свежей при незавершённом refresh. Не размножать одновременно одинаковые tables и MV без доказанной нужды.

### 6.6. Права, зависимости, триггеры

- На новых таблицах RLS включена; ни anon, ни authenticated не читают данные напрямую. Авторизованный backend сохраняет текущий минимум `super_admin`; расширение ролей — отдельное решение.
- Отозвать default/inherited grants явно, в том числе лишние CRUD service_role на journals и derived tables. RLS сама не ограничивает BYPASSRLS service_role.
- Read RPC EXECUTE только service_role; mutation RPC отдельно. SECURITY DEFINER с `search_path = feedbackgb, pg_temp`, квалифицированными источниками, проверенными args и bounded scope.
- FK version→run, line→document/receipt version, marts→sales run. Не ставить FK исторической продажи на active-only view.
- Триггеры только для безопасного аудита/updated_at/dirty-marker; дорогое чтение года или HTTP в триггерах запрещено.
- Прежние applied миграции не менять. CREATE OR REPLACE VIEW не переставляет существующие колонки; новая view версия при несовместимом контракте.
- Откат релиза — переключение reader на старый код и остановка новых jobs, не DROP исторических данных.

## 7. Ночной процесс и первая загрузка года

### 7.1. Разделить backfill и refresh

Missing-only остаётся для отсутствующих пар. Refresh вызывает существующий single-day sync **без missingOnly**, сравнивает все поля и создаёт новую completed версию только при изменении. При unchanged записывается новая успешная проверка/last_verified_at: старый `source_fetched_at` не должен делать свежую проверку невидимой.

Предлагаемая ночная приоритизация:

1. Вчера по всем применимым магазинам.
2. Пропуски последних 7/14/30 дней.
3. Скользящая сверка последних 7 дней, отдельный расширенный refresh последних 30 дней по бюджету.
4. Вчерашние/исправленные накладные, обновление каталога и наблюдаемых прайс-цен.
5. Чековые jobs вчерашнего дня и пропуски короткого окна.
6. Годовой backfill и постепенная циклическая перепроверка старой истории.

Старые исправления не гарантированно обнаруживаются 7-дневным refresh: нужны разрешённые source notifications/changed-data API либо плановая ротация старых периодов. До подтверждения этих интерфейсов использовать bounded ротацию; UI сообщает oldest/newest_verified_at, а не «всё актуально в моменте».

Недельные/годовые jobs не должны голодать: зарезервировать измеренную долю бюджета backfill, но вчера всегда приоритетнее. Идентификатор цикла refresh отличается от попытки; успешно завершённый цикл не запускается второй раз от другого cron слота.

### 7.2. Расписание и ограничения

Не создавать desktop-автоматизацию вместо серверного ingestion. Использовать существующие Vercel cron endpoints с Production-only guard и CRON_SECRET.

В коде сейчас sales: UTC 22:10, 23:10, 00:10, 01:10, 02:10; supplies: UTC 23:40, 01:40. Это не доказательство deployed расписания. На летнем киевском времени слоты sales приходятся на 01:10–05:10; зимой 00:10–04:10. Фиксировать обе зоны, DST и день, который реально загружается.

До расширения частоты проверить Vercel plan, maxDuration, допустимую частоту/количество cron, quotas, CRON_SECRET и deployment. Текущие 80 jobs — потолок, не гарантия throughput. Source retry 429/5xx с jitter/backoff и общим rate limiter, timeout/abort, renew-or-stop lease; не запускать бесконтрольный Promise.all.

Если измеренный throughput не укладывается в ночное окно и годовой initial backfill, выделить внешний worker только после утверждения инфраструктуры. API/UI не должны держать минутный запрос за весь год. Сначала замер, затем выбор платформы, не обещание «за одну ночь».

### 7.3. Первичное наполнение

1. Freeze один plan cutoff и подтверждённый scope магазинов/складов.
2. Посчитать все expected cells с 01.01.2026 до вчера и вывести pending/complete/not_applicable/blocked.
3. Сначала закрыть последние 30/60/90 дней, затем до января. Existing completed runs не дублировать.
4. Накладные выгружать малыми окнами с list manifest; не повторять сумму одного документа из overlapping старых snapshots.
5. Чеки выгружать по дням всей сети и страницам; перемещение/исправление чека учитывается версионно, invalidation прежнего и нового дня.
6. Сверять каждый batch: source count, row identity, деньги, units, stored readback и completed publication.
7. Прерванную загрузку продолжать из БД, не памяти процесса.
8. Публиковать accepted coverage по источнику/магазину, общий годовой статус — только после последнего gate.

Первый день календаря — 1 января; последний — сегодня. Из этого не следует, что historical API Poster доступен с января: это должно пройти проверку A-01. За недоступный день возвращать blocked, не ноль.

## 8. Вкладки и графики

Основной раздел сохранить `/admin/technologist/food-cost`; текущие вкладки не переименовывать без необходимости. Добавить «Продажі» и «Магазини» как аналитические вкладки внутри раздела; не дублировать существующий раздел справочника магазинов.

### Огляд

- Общий фильтр → coverage/freshness strip → оплачено/прибыль/FC_A/FC_B → тренд денег и фудкоста → магазины с отклонениями → категории/товары.
- Показатели и точки кликабельны; переход сохраняет период/магазины/методику.
- Экономические цвета только по утверждённым FC bands; проблемы данных — отдельные предупреждения.

### Продажі

- Оплачено, товарная сумма, количество отдельно кг/шт/л; чековый count/средний чек только при полном receipt coverage.
- Линии выручки и прибыли, день/неделя/месяц. Количества по единицам — отдельные серии/метрики.
- Рейтинг товаров/категорий + paginated все строки и выгрузка всего scope.
- Детализация выбранной даты и магазина до товаров, затем чеков с явным различием источников.

### Магазини

- Таблица всех выбранных точек: деньги, два FC, coverage, изменение к прошлому периоду.
- Heatmap X=даты/buckets, Y=магазины; переключатель оплачено/FC/количество/качество данных.
- Revenue heatmap не применяет пороги FC. Missing серый/штрих, confirmed zero отдельный нулевой цвет, not_applicable отдельный статус.
- Click ячейки → магазин/дата/товары/детальные продажи; tooltip включает дату, период bucket, суммы, методику, единицы, полноту.

### Ціни

- Сырьё/ингредиенты: weighted price, прошлый период, последняя закупка, её дата, объём, сумма, поставщик/склад при подтверждённом наличии.
- Line chart закупочной цены; stepped/observed chart прайс-цены реализации товара отдельно от average realized price.
- В выбранном магазине закупки центрального склада не становятся местными автоматически.

### Категорії, Позиції, Матриця и карточка товара

- Используют один фильтр и серверный контракт; не остаются «на последних 7 днях» при годовом Overview.
- Карточка: product sales trend, store breakdown, factual average sales price, observed price, оба FC, понятная разница методик.
- Матрица: те же принятые суммы/период; existing focus/full range поведение сохранить.

### Общие правила графиков

- До 31 дня daily по умолчанию, 32–120 weekly, больше monthly; пользователь может переключить. Bucket границы в Europe/Kyiv, неделя с понедельника.
- Bucket не выходит за selected range. Неполные крайние недели/месяцы подписаны; не сравнивать частичный месяц с полным как равные периоды.
- Missing данные — gap; ноль только после полного source check. Не соединять линией неизвестный участок по умолчанию.
- FC пересчитывается из сумм bucket, weighted закупочная цена — из сумм/количеств, не из средних.
- Выбор сегодня не дорисовывает completed daily line; provisional серия/маркер отдельно.
- Большие heatmaps получают server bucketing/виртуализацию, без отправки миллионов фактов в браузер.
- Сравнение «попередній рівний період» явно показывает свои даты; если начало до 01.01.2026 — comparison unavailable, current показатели остаются доступны. Можно выбрать comparison off/custom; current и comparison используют общий asOf.

## 9. Пошаговое исполнение: нельзя проходить следующий gate при провале предыдущего

Каждый шаг имеет статус `not started / passed / failed / blocked`, доказательство и список непроверенного. Код готов ≠ runtime passed.

| Шаг | Действие | Проверка / условие завершения |
|---|---|---|
| A-00 | Сверить ветку, user changes, миграции, docs; зафиксировать baseline | Source paths и live schema совпадают; посторонние файлы не включены |
| A-01 | Read-only source probe января/последнего дня, deleted SKU/точки, модификаций, чеков и накладных | Получены реальные ответы, contract/units/timestamps/pagination описаны; нет неподтверждённого поля |
| A-02 | Зафиксировать historical roster/storage mapping и source availability | Подтверждённые интервал/ID/evidence; неизвестные отмечены blocked; нет invented opening dates |
| A-03 | Утвердить period/today/comparison/full-sales contracts | Один источник диапазона, compatibility adapter, today не completed |
| A-04 | Реализовать period parser и date helpers с тестами | Валидные/невалидные даты, DST, месяцы, границы года покрыты |
| A-05 | Подготовить 042 + readback + обратимый rollback | Staging run на реальной PG, RLS/ACL/constraints/leases проверены |
| A-06 | Расширить missing queue + отдельный refresh workflow | 1 января допустим, старый completed audit сохранён, retry/lease/concurrency проверены |
| A-07 | Подготовить 043 marts/RPC/coverage | Старые и новые суммы на одном asOf равны; no silent SQL NULL/safe integer loss |
| A-08 | Заполнить marts прежних completed runs bounded | Counts/units/money равны facts; читатель не теряет данные во время перехода |
| A-09 | Подготовить 044 supply history/catalog observations | Изменение/удаление/перенос документа и zero-doc day проверены; пересечение snapshots не удваивает суммы |
| A-10 | Supply backfill и arbitrary-range prices | Source list/детали/деньги/единицы совпадают; central/store scope корректен |
| A-11 | Подготовить 045 receipts after source gate | Все страницы, manifest, изменённые/повторные строки и privacy проверены |
| A-12 | Проверить receipts↔dashboard bridges | Каждый тип расхождения объяснён; refund scope доказан или явно blocked |
| A-13 | Реализовать period read endpoints и exports | Авторизация, scope, server aggregation, paging, cancellation, schema_missing ошибки проходят tests |
| A-14 | Общий UI filter и навигация всех вкладок/карточки | Даты/магазины не теряются при кликах и перезагрузке URL |
| A-15 | Огляд/Продажі/Магазини/Ціни, trend/heatmap drilldowns | Правильные labels, colors, units, missing, mobile/dark; все суммы source-backed |
| A-16 | Реализовать isolated provisional today | Нельзя попасть в completed history; timestamp/source status видны; выключение не ломает closed data |
| A-17 | Ночной orchestrator/quotas/logging/alert state | Вчера приоритетно, backfill не голодает, shared DB Preview не пишет, abort действительно отменяет I/O |
| A-18 | Staging integrated tests + year-size нагрузка | Синтетические сбои на staging, не в рабочей базе; нет потерь/дублей/leaked secrets |
| A-19 | Production migrations/readback после разрешения | Applied SQL версии сохранены, ACL/RLS/sums verified; шаг не считается выполненным по `Success` |
| A-20 | Авторизованный реальный backfill с января | Expected/completed/blocked по всем источникам/точкам; контрольные ответы Poster и независимые sums сохранены |
| A-21 | Production deploy и первая/вторая ночи | Реальные cron logs/run IDs, continuity/no duplicate cycle, yesterday coverage/freshness |
| A-22 | Итоговый E2E всех маршрутов + документы/handoff | Все тест-карточки с доказательствами, known gaps, rollback и инструкция оператора |

Если отсутствует staging, fault-injection/конкурентные разрушительные тесты — blocked. Разрешённые реальные загрузки в общую рабочую базу не заменяют staging. Ничего не чистить «потом» без согласованного перечня targets.

## 10. Тесты: обязательный минимум 60

### Периоды и совместимость (unit)

| ID | Сценарий | Ожидание |
|---|---|---|
| T-01 | legacy days=7/14/30/60 | Прежний диапазон closed dates |
| T-02 | custom 01.01–28.09 | Inclusive без пропусков дат |
| T-03 | from=to | Ровно один день |
| T-04 | from>to | 400 / понятная validation ошибка |
| T-05 | 31 февраля, malformed/date repeated | Отклонены, не нормализованы молча |
| T-06 | до history_start / после today | Отклонены |
| T-07 | переход года | История сохраняется, YTD начинается 1 января |
| T-08 | UTC сегодня != Kyiv сегодня | Даты вычисляются по Kyiv |
| T-09 | переход DST весна/осень | Calendar dates без удвоения/потери |
| T-10 | custom до сегодня | Closed + отдельный provisional/unavailable segment |
| T-11 | январский previous до history_start | Current доступен, comparison Н/Д |
| T-12 | legacy и custom конфликтуют | 400, не произвольный выбор |

### SQL / источники / качество

| ID | Сценарий | Ожидание |
|---|---|---|
| T-13 | незагруженный spot/day | Missing, нет partial KPI |
| T-14 | valid empty Poster day | Completed empty, money=0, FC=NULL |
| T-15 | late-open store до открытия | Not applicable, нет искусственного missing/zero |
| T-16 | historical roster unknown | Scope qualification, не «полная историческая сеть» |
| T-17 | soft-deleted магазин / товар | Исторические деньги не исчезают |
| T-18 | несколько модификаций/повторных товарных строк | Все учтены, source_row_no сохранён |
| T-19 | новый failed/running run | Прежний completed остаётся видимым |
| T-20 | новая successful версия | Один latest run, сумма не удваивается |
| T-21 | fixed asOf между двумя версиями | Стабильные current/previous/read RPC |
| T-22 | одинаковый source response | Нет новой версии, successful verification записана |
| T-23 | один NULL netto | Netto итог/FC_B Н/Д |
| T-24 | paid<=0, отрицательные коррекции | Деньги сохраняются, процент Н/Д |
| T-25 | смесь кг/шт/л | Нет общей фиктивной суммы quantities |
| T-26 | деньги больше JS safe integer | Точные decimal strings; нет округления |
| T-27 | bucket FC | Ratio of sums, не average percentages |
| T-28 | weighted supply bucket/period | Sum money / sum quantity |
| T-29 | нет закупок при complete списке | Цена Н/Д, объём 0; last known отдельно |
| T-30 | перекрывающиеся 036 snapshots | Один supply version, не двойной документ |
| T-31 | edited/deleted/moved-date накладная | Коррекция всех affected дат/scopes с audit |
| T-32 | network vs direct-store supplies | Central не приписан магазину |
| T-33 | ambiguous storage mapping | Scope blocked, не guessed join |
| T-34 | актуальная техкарта для старого периода | Не выдана за historical recipe |
| T-35 | чековая пагинация count/pages/duplicate | Все страницы прочитаны, дубли rejected/retried |
| T-36 | mixed payment/free/return/delete receipt | Source-specific reconciliation, нет invented refund rule |

### Worker / security / нагрузка

| ID | Сценарий | Ожидание |
|---|---|---|
| T-37 | два worker одной пары | Один owner, другой не публикует |
| T-38 | два worker разных пар | Независимая корректная публикация |
| T-39 | старый owner после lease reclaim | Не завершает/не портит новую attempt |
| T-40 | падение после части facts | No completed publication, resume корректен |
| T-41 | 429/5xx/timeout | Bounded backoff, ошибка не zero day |
| T-42 | exhausted retries | Dead letter виден, не silent complete |
| T-43 | большая очередь года + ежедневные jobs | Вчера не голодает, backfill получает бюджет |
| T-44 | отсутствующий/wrong CRON_SECRET | Production 503/401, нет записи |
| T-45 | Preview с общей БД | Cron не пишет |
| T-46 | anon/authenticated/direct journal CRUD | Запрещено, verified ACL/RLS |
| T-47 | token/PII в payload/log/export | Не попадают в user surface/Git |
| T-48 | большой годовой диапазон +100 читателей | Нет unbounded JS facts/payload/connection flood; измерены p50/p95/errors |

### Браузерные E2E (real authenticated UI + staging data)

| ID | Сценарий | Ожидание |
|---|---|---|
| E-01 | Default Overview | 7 closed дней, правильная полнота |
| E-02 | 30/60/90/YTD presets | Правильные даты и source coverage |
| E-03 | custom Jan→yesterday, reload/back | Даты/URL сохраняются |
| E-04 | все/один/несколько магазинов | Overview/таблицы/графики используют тот же scope |
| E-05 | Overview→category→product→store | Период и методика не сброшены |
| E-06 | Ціни на том же custom range | Закупки привязаны к выбранным датам, не последнему snapshotTo |
| E-07 | недостающая дата/failed source | Warning с датами/магазинами, нет неполного полного KPI |
| E-08 | полная current + неполная previous | Current есть, delta Н/Д |
| E-09 | heatmap missing/zero/not_applicable click | Разные состояния и корректный drilldown |
| E-10 | today отдельно | Предварительный статус и обновление, не completed |
| E-11 | dark/mobile/keyboard | Существующий дизайн, читабельные графики, focus/calendar доступен |
| E-12 | export всех продуктов/чеков | Все страницы, суммы равны filtered API, не только текущая страница |

Дополнительные обязательные E2E: отмена медленного запроса при смене периода; новая ночь обновляет yesterday без ручного логина; возвращённый/удалённый чек виден согласно принятому контракту; отсутствие миграции даёт controlled unavailable, не Server Components crash.

## 11. Проверки маршрутов и производительности

Сохранить реальные существующие пути и составить route inventory до правок:

- `/admin/technologist/food-cost` для всех tab/query комбинаций.
- `/api/admin/technologist/food-cost/overview` и `/overview/recent-network`.
- `/api/admin/technologist/food-cost/categories/recent-network`.
- `/api/admin/technologist/food-cost/products/recent-network`.
- `/api/admin/technologist/products/[id]/food-cost`.
- `/api/cron/poster-foodcost-sales`, `/api/cron/poster-supply-cost`.

Новые sales/store/prices/history/export endpoints — под тем же защищённым namespace. Не добавлять публичный `/api/poster?...token=...`. Имена закрепить в A-13 и добавить route tests 200/400/403/503/controlled500, unknown ID, repeated/oversized scope, no-store приватных ответов.

Для SQL в staging: EXPLAIN (ANALYZE, BUFFERS) на 1/7/30/90/YTD дней, сети/одном магазине, category/product; фиксированные asOf и одинаковые данные до/после. Проверить row estimates, scans, сортировки, temp spill, missing index, total time. EXPLAIN запроса с записью на рабочей БД запрещён.

Предложенные бюджеты приёмки, не измеренные обещания: тёплый aggregate API p95 ≤2 с, product/detail page API ≤3 с; chart payload ≤500 KB без raw receipts; 100 параллельных read-запросов — 0 неверных ответов/утечек и отсутствие неконтролируемого pool exhaustion. Бюджеты пересмотреть по baseline, любые ослабления документировать. Export большой детализации — поток/queued artifact, не JSON всех чеков в браузер.

## 12. Отчётность и эксплуатация

Для каждого шага сохранять:

```text
ID, status, commit, environment, UTC+Kyiv время
команда/запрос, actual output, scope, expected/actual
evidence file, source run/hash/parser version
непроверенное/причина blocked, безопасный rollback
```

В админке блок состояния данных: диапазон истории, полный/неполный source coverage, historical roster status, latest verification, очередь по источникам/магазинам, last failed stage. Observability различает fetch/list/pages/parse/write/readback/aggregate/complete/publication. Request/correlation ID связывает API, orchestration, attempts и events. Нельзя логировать credentials, клиентские PII и полный ответ Poster без review.

Предлагаемые пороги эксплуатации: вчера missing после последнего ночного слота, свежая ошибка/expired lease, растущая очередь, catalog/supply verification старше согласованного SLA. Точные SLA и канал уведомлений утвердить до включения alerting; в этот план не включается отправка сообщений команде без разрешения.

## 13. Критерии готовности

- [ ] Все связанные вкладки и карточки поддерживают presets и custom календарь 01.01.2026→today.
- [ ] Никаких тихих границ 60/120 дней в period parser, SQL seed/claim/health, loader, exports и labels.
- [ ] Closed/current/provisional/comparison разделены; сегодняшний день не маскируется под completed.
- [ ] Годовые продажи по подтверждённому roster имеют все expected cells и все source rows.
- [ ] Receipts/pagination/refunds приняты отдельно; если заблокированы, нельзя сказать «все детальные продажи готовы».
- [ ] Исторические магазины/товары/модификации сохранены, центральные закупки не размазаны по магазинам.
- [ ] Проценты и цены вычислены из сумм и нормализованных quantities, NULL/missing не превращены в 0.
- [ ] Supply history корректирует edited/deleted/moved-date docs; прошлые snapshots не удваиваются.
- [ ] История прайс-цен честно начинается с наблюдения, историческая factual price — другой показатель.
- [ ] Refresh обнаруживает недавние исправления и постепенно перепроверяет старую историю.
- [ ] Runtime migrations/readback, SQL parity, 60+ tests и E2E имеют сохранённые доказательства.
- [ ] Две реальные Production ночи подтверждены, backlog/freshness видны, quotas проверены.
- [ ] Секреты/PII не попали в Git/ответы/экспорт; ACL/RLS проверены live.
- [ ] Откат читателя/worker не удаляет накопленную историю.

## 14. Что делать первым

**A-00 → A-01 → A-02 → A-03 → A-04.** Сначала доказать доступность января и историческую популяцию; затем периодный контракт. После этого миграции/worker/marts, календарь и вкладки.

Не начинать с добавления нескольких option в Select: это расширит обещание интерфейса, но не обеспечит ни полные продажи, ни произвольный диапазон закупочных цен.
