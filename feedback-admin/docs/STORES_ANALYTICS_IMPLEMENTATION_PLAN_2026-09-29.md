# Магазини → Аналітика: структура и план реализации

Дата: 29.09.2026. Статус на 30.09.2026: первый вертикальный срез `Огляд`/`Якість даних` реализован в коде; runtime blocked до применения миграции 050. Фактический журнал и границы доказательства: `STORES_ANALYTICS_IMPLEMENTATION_LOG_2026-09-29.md`.

## 1. Цель и границы

Руководитель за 15–30 секунд видит состояние выбранной сети: сколько продали, как изменились продажи, какие магазины/категории/товары внесли вклад в изменение, где требуется разбор. Затем переходит к конкретному магазину и позиции, сохраняя период.

Место: **Мережа → Магазини → Аналітика**, а не дополнительная вкладка в фудкосте. Общая инфраструктура загрузки Poster остаётся общей для продаж/цен/фудкоста. Не создавать второй независимый sales sync.

Не смешивать продажи с обращениями продавцов. Существующие «Магазини» и «Звіти» сохраняются: последняя показывает feedback, а не продажи Poster. Закупки, остатки и фудкост открываются как связанные подробности, не подменяют показатели продаж.

## 2. Что подтверждено текущим кодом

- `stores/stores-tabs.tsx`: вкладки «Магазини», «Звіти», «Аналітика»; последняя — `PlannedDataPlaceholder`.
- `stores/page.tsx` читает v_stores, feedback_feed за 90 дней, users. Это **не источник продаж**; не вычислять новую аналитику из feedback_feed.
- `lib/admin/foodcostSalesRead.ts`: latest completed version per date×spot с фиксированным asOf, контроль полноты перед чтением фактов; текущее ограничение 60 дней. Произвольный годовой диапазон пока не поддержан reader.
- `foodcostRecentNetwork.ts`: сверка текущих Poster/v_stores IDs; historicalRosterVerified=false. Подтверждённых дат открытия/закрытия в этом контракте нет.
- Новые локальные `analyticsPeriod.ts`/`analyticsScope.ts` проверены unit-тестами, но не подключены к UI/действующим маршрутам. Это заготовки, не работающий календарь.
- Общий годовой план: `FOOD_COST_SALES_PRICES_YEAR_HISTORY_PLAN_2026-09-29.md`, этапы 042–045 пока проектируются. Применённые миграции не редактировать.
- Дизайн: `lib/admin/theme.ts`: Inter, AntD 5, размер 14, контейнеры radius12, controls36, нейтральные поверхности, розовый акцент #c93a6f / #f0719f, светлая/тёмная темы.

Проверка структуры исходников не доказывает полноту данных в рабочей БД. Здесь нет новых live-итогов сети.

## 3. Навигация и фильтры

```text
Мережа / Магазини
  Магазини | Звіти | Аналітика
    Огляд | Магазини | Категорії | Товари | Проникнення | Порівняння | Якість даних
```

Один общий верхний блок:

1. Период: вчера, 7/14/30/60/90 завершённых дней, текущий/предыдущий месяц, квартал, с начала года, вся доступная история, календарь «від — до». По умолчанию 30 завершённых дней.
2. Магазины: вся доступная сеть / один / несколько; кнопки «обрати всі», «очистити». «Все» берётся из проверенного реестра, не константы 26.
3. Сравнение: предыдущий равный период / свой диапазон / выключено. Показывать обе пары дат. Сравнение с прошлым годом — только при наличии источника и отдельной спецификации.
4. Шаг графика: день / неделя / месяц; недельные неполные buckets не нормализовать незаметно.
5. Данные: closed coverage, oldest/newest verification timestamps, asOf, кнопка детализации качества. Обновление страницы не равно обновлению Poster.

Даты Kyiv, обе границы включены, старт истории 01.01.2026, прошедшие годы сохраняются. Сегодня — отдельное provisional-состояние, не часть закрытого полного итога; на первом этапе не показывать пресет «сьогодні» до готовности provisional pipeline.

Локальные category/product filters применяются к соответствующим вкладкам; рядом всегда виден активный scope. Для доли и проникновения знаменатель не должен незаметно сузиться до выбранного товара. Глобальное изменение магазинов/периода применяется ко всем вкладкам. URL хранит `tab=analytics`, `view`, `period/from/to`, `spot_ids`, `comparison/compare_from/compare_to`, `grain`, `category_id/product_id`.

Browser Back и deep-link восстанавливают выбор. По клику «назад к сети» снимается только store-фильтр. Мокап-клики демонстрируют навигацию, не реальные API.

## 4. Словарь метрик: не путать разные сущности

| Метрика | Определение / правило |
|---|---|
| Виручка від продажів | Сумма проверенного Poster `payed_sum_minor` из latest completed товарных фактов; UAH через minor units, название и сверка с Poster обязательны |
| Оборот до знижок | Отдельный показатель **только после** проверки семантики product_sum/discount/bonus/cert и возвратов. Не автоматически «выручка + discount». До проверки скрыт/недоступен |
| Кількість чеків | DISTINCT transaction ID на принятом receipt population; товарный row count не равен числу чеков |
| Середній чек | Проверенная receipt paid total / количество тех же чеков. До сверки receipt total с товарной выручкой не делить разные популяции |
| Продано | Отдельные кг / шт / л и другие подтверждённые единицы. Нельзя складывать 100 кг + 50 шт в 150 товаров |
| Частка у виручці | Выручка категории или товара / выручка всех продаж выбранных магазинов в том же периоде ×100; при нулевом знаменателе N/A |
| Охоплення магазинів продажами | Магазины с положительными продажами выбранной позиции / применимые выбранные магазины с полной coverage ×100. Это не наличие на полке и не выполнение ассортиментной матрицы |
| Проникнення в чеки | DISTINCT eligible чеки с выбранной категорией/товаром / DISTINCT все eligible чеки выбранных магазинов и дат ×100 |
| Зміна, % | (current−previous)/previous ×100 при positive previous; previous=0 — «нові продажі»/N/A, не бесконечность |
| Зміна частки | current share−previous share, **процентные пункты**, не процент изменения выручки |
| Внесок у зміну | Current revenue entity − previous revenue entity в ₴. Сумма всех вкладов вместе с unknown bucket совпадает с изменением scope |
| Виручка на застосовний день | Выручка / подтверждённые применимые дни, отдельно от суммы периода. Не делить на дни с продажами и не скрывать нулевые дни |

Revenue, profit, себестоимость, foodcost — не синонимы. Poster foodcost/profit при переходе к карточке сохраняет свою методику; не добавлять неподтверждённый «чистый доход».

Один чек с двумя товарами одной категории считается один раз для категории. Чек с тремя категориями входит в каждую: сумма penetration по категориям **может превышать 100%**. Donut для penetration запрещён. Revenue shares суммируются до100% с bucket «Без категорії» при допустимой базе; для отрицательных частей использовать таблицу/бар, не круг.

Для receipt penetration требуется полный receipt+line pipeline и зафиксированное правило eligible/void/deleted/refund. Продажи минус возвраты могут давать отрицательные количества/выручку; не обрезать silently. Для корзины «куплено» возврат-only line не считается покупкой; окончательное predicate принятия чеков подтверждается на live-примерах до релиза. Не называть чек «клиентом»: уникальных покупателей не вычисляем.

## 5. Структура экранов

### 5.1. Огляд — сеть или выбранный набор магазинов

Первый экран: фильтры → freshness/coverage → 4 KPI: выручка, динамика, чеки, средний чек. Если receipts не готовы, последние два блока показывают причину недоступности, не 0.

Далее:

- Line chart выручки текущего/сравниваемого периода; календарные даты в tooltip, предыдущее окно сопоставляется по порядковому дню. Несовпадающая длина — явная пометка, не искусственное растягивание.
- Горизонтальные бары «Внесок магазинів у зміну»; отрицательные/положительные суммы вокруг нуля. Клик → магазин.
- Структура выручки: максимум5 категорий + «Інші», donut только для положительных частей; клик → категории.
- «Потребує уваги»: наибольшие абсолютные падения, потери доли, качество источника; факт с датами и переходом, не выдуманная причина.
- Compact ranking магазинов: выручка, доля сети, Δ₴/Δ%, чеки/средний чек (если доступны).

Рост выручки не объявлять успехом прибыли. Без целей нет arbitrary «магазин хороший/плохой»: цвет знака изменения — направление, не выполнение бюджета. Пороги 35/45% относятся к foodcost, не к продажам.

### 5.2. Магазини — рейтинг и карточка магазина

Слева/сверху выбирается магазин; default — таблица всех выбранных, не 26 отдельных тяжёлых графиков. Колонки: магазин, выручка, Δ₴, Δ%, доля выбранной сети, чеки, средний чек, coverage. Сортировка на сервере; суммы по всем выбранным, не только странице.

Карточка выбранного магазина внутри аналитики:

- Header название/адрес, период, chip scope и «До всіх магазинів».
- Те же KPI и trend, top categories с долями, top/declining products, penetration внутри магазина.
- Сравнение с сетью: доля категории магазина vs взвешенная доля категории всей выбранной сети; вторично peer baseline **без выбранного магазина**, явно обозначенный. «Среднее процентов магазинов» запрещено.
- Ссылки на товары, соответствующие остатки/фудкост. Нет утверждения «причина падения — нет остатков» без исторического stock source.

### 5.3. Категорії

Ranking категорий: выручка, доля, Δ₴, Δ%, Δдоли п.п., охват магазинов, penetration (если receipts готовы).

Выбор категории → её trend, stacked distribution по магазинам, таблица продуктов категории. Unknown category остаётся в totals, current names отмечаются как справочный fallback, исторические IDs не перезаписываются.

Heatmap магазин×категория: переключатель выручка/доля/Δдоли; легенда единиц, одинаковая шкала всего grid. Нельзя окрашивать revenue как «качество». Клик ячейки фиксирует store+category и открывает товары.

### 5.4. Товари

Поиск, категория, сортировка; таблица: продукт, единица, объём, выручка, доля, Δ₴/Δ%, охват, penetration, effective sale price на проверенном unit basis. Модификации не объединять, пока финансовые поля/единицы неоднозначны; раскрываемые строки сохраняют исходную идентичность.

Карточка «Пельмені зі свинини»: trend выручки и отдельный trend кг, магазины ranking, доля категории/всех продаж с именованным denominator, penetration, фактическая средняя цена реализации. Средняя цена = выручка / количество на одной допустимой signed population/unit basis; quantities<=0 → N/A, не деление. Изменение микса не называть изменением прайса.

Переход к существующей карточке технолога с сохранением return URL. Историческую техкарту и закупочную себестоимость не вычислять по сегодняшнему рецепту.

### 5.5. Проникнення

Два явно разных режима: **«У чеки»** и **«Охоплення магазинів продажами»**. Первый disabled/unavailable при отсутствии полной чековой детализации; второй работает по принятым товарным фактам, не выдаётся за ассортимент.

Heatmap: строки магазины, столбцы категории (или выбранные товары). Ячейка — % + доступный tooltip: numerator/denominator, выручка, change п.п., качество. missing — штриховка/«—», genuine zero — 0%; не смешивать.

Под heatmap: бары leaders/laggards выбранной категории и trend penetration. Сеть считается по DISTINCT чеков всей сети, не AVG(store_percent).

Ассортиментное проникновение «где товар должен быть, но не продаётся» — отдельная будущая метрика после подтверждённой ассортиментной матрицы; без неё только «продажи не зафиксированы», не «магазин не выполняет ассортимент».

### 5.6. Порівняння

Два периода, один scope; режим сравнения магазинов — до4 выбранных магазинов и сеть как именованный benchmark. Absolute totals и revenue/day отдельно; не сравнивать 7д и30д как равные итоги.

Таблица current/previous/Δ₴/Δ%; waterfall вкладов store/category/product, top gainers/decliners; ratio metrics через ratio of sums. Декомпозиция price/volume/mix — P2 после подтверждения unit/returns/common SKU identity, не арифметическая «причина» в первой версии.

Like-for-like cohort только по подтверждённым интервалам работы/одинаковой availability обоих окон. Пока historical roster неизвестен, подпись «порівняння поточного вибраного складу», не LFL. Не исключать missing/закрывшиеся точки без сообщения.

### 5.7. Якість даних

Coverage дат×магазинов, отдельный receipt coverage, freshness, source/methodology/parser version, missing days, retry/failure codes, last successful run. Squares heatmap магазин×день; missing ≠ empty verified ≠ not applicable ≠ provisional.

Read-only для обычного просмотра; «запустить sync» не добавлять всем админам. Refresh/backfill только через текущий защищённый операторский workflow. На missing_PERIOD обзоре скрыть неполный общий итог, предложить открыть полностью проверенный магазин/подпериод; этот переход требует явного клика и подписи новых границ.

## 6. Данные и архитектура

Poster → общий bounded nightly/backfill worker → versioned facts feedbackgb → SQL run marts/RPC → protected server endpoints → AntD UI. Не делать Poster HTTP fan-out при каждом открытии магазина. Не дублировать факты в отдельную shops-sales базу.

Переиспользовать годовой план042–045; эта аналитика становится **основным sales consumer**. В фудкосте сохраняется экономика; shared history/period/scope не размножаются.

### Подтверждённое решение: чековая история

29.09.2026 пользователь подтвердил отдельную загрузку чеков и их товарных строк из Poster в **feedbackgb**, а не live fan-out при открытии аналитики.

- Исторический backfill с01.01.2026, постепенно и с bounded budget. Не считать историческую применимость магазинов подтверждённой только по чековым данным.
- Ночная загрузка завершённого дня и повторная проверка недавнего окна на исправления/возвраты. Глубина refresh и ротация старой истории определяются после проверки API и лимитов, а не произвольным бессрочным reread всех чеков каждую ночь.
- Отдельные versioned import runs, receipt headers и ordered receipt lines; повторные строки продукта не схлопываются. Чеки не заменяют уже существующий товарный sales source и не суммируются с ним в двойную выручку.
- Manifest страниц/count/ID/hash, проверка drift, duplicates и контрольных денег обязательны перед публикацией completed day. На ошибке сохраняется предыдущая принятая версия; partial не получает статусcomplete.
- Число чеков, средний чек и penetration читаются из этой проверенной истории. Правила eligible/void/deleted/refund и денежные единицы проверяются отдельно. До принятия — unavailable, не приблизительное число из товарных totals.
- Poster live остаётся read-only источником сверки; сегодняшний день — отдельный provisional pipeline с timestamp, не completed history.
- Дополнение пользователя29.09: импортировать всю доступную детализацию чеков, включая клиентов. Клиентские snapshot/PII и полный source payload хранить в отдельном защищённом контуре внутри feedbackgb; не публиковать их через общие analytics views/exports/logs. Credential-bearing URL и токены не являются чековыми данными и не сохраняются. Спецификация: `POSTER_FULL_RECEIPT_IMPORT_CONTRACT_2026-09-29.md`.

Подтверждение архитектуры не означает, что загрузка выполнена, SQL проверен или staging gate закрыт. Номер чековой миграции — после проверки свободных номеров; схема и worker внедряются отдельным проверенным этапом S-11.

Предлагаемые расширения (названия — спецификация, пока объектов нет):

- Store/day revenue mart на run_id поверх общих sales totals; category/product marts должны сохранять spot_id, date, unit, historical identity.
- Receipt run store/day totals; receipt×category distinct bridge и receipt×product/modification bridge. Grain без дублей, version/run FK, без PII клиентов. Category mapping по историческому source evidence, не тихий JOIN сегодняшнего каталога.
- `read_store_sales_overview`, `read_store_sales_ranking`, `read_store_category_sales`, `read_store_product_sales`, `read_store_penetration`, `read_store_sales_comparison`, `read_store_sales_quality`: suggested RPC, проверенные date/scope/asOf/grain, bounded server pagination. Можно объединить RPC после EXPLAIN, не обязательно создавать7 одинаковых scans.
- Во всех envelope: requestedPeriod/closedPeriod, spotIds, historicalRosterVerified, asOf, sourceVerifiedOldestAt/newestAt, coverage, comparisonCoverage, status, denominatorScope, methodologyVersion.
- Все money bigint/numeric → decimal strings через API; formatting в UAH только на границе. Проценты precision-safe; nullable источники не превращать в0.
- FK/version indexes; candidates `(spot_id,business_date,run_id)`, product/category drilldown и receipt-ID unique bridges. Точный порядок по EXPLAIN (ANALYZE,BUFFERS) на staging, не угадывать индексы или materialized views заранее.
- New objects только feedbackgb, RLS включена, revoke public/anon/authenticated; SECURITY DEFINER qualified references/search_path feedbackgb,pg_temp; minimum grants. Existing036–041 не менять.
- Migration number определить после проверки следующего свободного номера: не фиксировать новые магазины на042, если042 уже занята shared queue.

Предлагаемые read-only routes `/api/admin/stores/analytics/{overview,stores,categories,products,penetration,comparison,quality}`. Source-token/service-role не идут в браузер. Legacy `/api/stores` не расширять sales data без проверки его auth-контракта. RBAC: на первом этапе сохранять minimum super_admin текущего foodcost backend; открытие sales analytics для admin — отдельное явное решение, не следствие видимости меню.

## 7. Поэтапная реализация: каждый gate проверяется

| Шаг | Сделать | Проверка / gate |
|---|---|---|
| S-00 | Зафиксировать branch/status, исходники stores, shared план и данные | Список фактически applied migrations, без пользовательских изменений |
| S-01 | Утвердить страницы и метрики, revenue/turnover/penetration population | Контракт, unavailable правила, никакой имитации чеков из товарных totals |
| S-02 | Проверить Poster поля/units/refund/void/category IDs | Live samples + точная сверка денег; failed семантика блокирует зависимые KPI |
| S-03 | Завершить shared period/scope adapters | Unit и route query validation, DST/year boundaries, URL roundtrip |
| S-04 | Shared year queue/refresh schema и worker | Миграция staging/readback, RLS/ACL/lease/concurrency/rollback; не проверять destructive rollback на рабочей БД |
| S-05 | Versioned sales marts/read RPC на год | Суммы фактов == marts == RPC на одинаковом asOf; coverage positive/empty/missing |
| S-06 | Read-only overview/stores/category/product routes | Auth401/403, invalid400, schema503, no secrets, pagination/scope parity |
| S-07 | Общий фильтр и lazy tabs внутри stores | «Звіти» и карточки магазина не ломаются; inactive tabs не грузят sales |
| S-08 | Огляд и ranking/карточка магазина | Screenshot light/dark, default all, реальный drilldown, сравнение scope/дат |
| S-09 | Категории и товары, unit-safe trends | Known/unknown IDs, modifier identity, denominator labels, longnames |
| S-10 | Периодные сравнения/вклады | Сумма вкладов == Δобщего scope, prior incomplete не даёт ложный trend |
| S-11 | Чековая история и bridges после принятия S-02 | Все страницы/count/drift, refund population, idempotence; store+network parity |
| S-12 | Проникновение в чеки + heatmap | DISTINCT numerators/denominators, overlap categories >100%, missing ≠0 |
| S-13 | Quality UI и защищённые exports | Coverage/detail proof, export scope совпадает, no PII, excel formula injection guard |
| S-14 | Performance/concurrency | EXPLAIN, warm/cold API p50/p95, 20 readers+sync, fixed asOf, no year facts in browser |
| S-15 | E2E/staging UAT и release | Все обязательные tests passed либо dependent feature disabled; preview не равно acceptance |

S-11/S-12 могут быть вторым релизом: первый выпускает продажи/trends/доли и охват магазинов, но явно сообщает недоступность чекового penetration. Не выпускать receipts KPI с приблизительным знаменателем.

Proposed budgets для приёмки, не результаты замеров: initial compressed analytics payload ≤250KB без графических библиотек; overview/ranking API p95≤2с на year×current roster в staging; UI meaningful-state≤3с на agreed desktop/network. Точные baseline фиксируются S-00; если бюджет не подтверждён, документировать actual и причину, не объявлять passed. Тяжёлые plots lazy; cache scope/user permission/asOf aware, protected ответ не публичный ISR.

## 8. Обязательные tests

| ID | Проверка | Ожидается |
|---|---|---|
| T01 | 7/14/30/60/90/YTD/custom | Одинаковые dates для всех consumers |
| T02 | Kyiv DST/UTC midnight/leap/year boundary | Нет пропуска/дублирования дня |
| T03 | Today/first day of month | Provisional отдельно, closed-empty честно |
| T04 | Future/reversed/duplicate query |400 |
| T05 | Multi-store/unknown store | Membership guard, no silent fallback all |
| T06 | Latest completed/asOf/new sync concurrent | Одна версия, стабильный snapshot |
| T07 | Failed/partial run | Не становится complete |
| T08 | Verified empty vs missing |0 только для verified empty |
| T09 | Category/product/store/network parity | Все суммы согласованы |
| T10 | Unknown category/current fallback | История и totals сохранены |
| T11 | Modifiers/repeated source lines | Нет потерь/дублей |
| T12 | Kg/pieces/liters | Раздельные volumes |
| T13 | Minor bigint beyond JS safe integer | Exact API strings, без float loss |
| T14 | Negative returns/signed totals | Принятая семантика, не clamping |
| T15 | Previous=0/negative/incomplete | Новые продажи/N/A, не ±∞ |
| T16 | Revenue share denominators | Store/category filter не меняет знаменатель незаметно |
| T17 | Δshare | П.п., не % |
| T18 | Sum of contributions | Равна общему Δ₴ |
| T19 | Partial weeks/unequal windows | Реальная длина/day-rate подписана |
| T20 | Historical roster unknown | Не показывает LFL/full historical network |
| T21 | Один чек, две строки одной категории | Numerator1 |
| T22 | Один чек, несколько категорий | Каждая numerator1, сумма penetration может >100% |
| T23 | Network penetration | Ratio of distinct totals, не среднее store ratios |
| T24 | Zero receipt denominator | N/A |
| T25 | Missing receipt pages/drift/count duplicate | Publication blocked |
| T26 | Cancelled/deleted/refund-only receipt | Принятый eligibility predicate |
| T27 | No assortment/stock history | Нет неподтверждённого OOS/assortment вывода |
| T28 |401/403/RLS/ACL | Нет unauthorized analytics и source credentials |
| T29 | Server pagination/sorting | Summary не зависит от страницы |
| T30 | Export parity/formula cells | Совпадает scope, нет выполнения формул из source text |
| T31 | DB absence/API timeout | Error/unavailable, не нули |
| T32 | Stale source/partial previous | Отдельные quality/comparison statuses |
| E01 | Магазини→Аналітика→Огляд | Default30/all, source freshness видна |
| E02 | Preset→custom calendar→reload | Одинаковые selection/границы |
| E03 | Несколько магазинов | Все экраны сохраняютscope |
| E04 | KPI/bar→store→category→product→Back | URL/период/scope восстанавливаются |
| E05 | Heatmap mouse/keyboard/touch | Details и drilldown доступны без hover |
| E06 | Receipt pipeline unavailable | UI не выдаёт revenue share за penetration |
| E07 | Light/dark/320/768/1440/1920 | Читаемо; таблица только со своим overflow; текст не обрезан без full-name доступа |
| E08 | Missing cell→quality→explicit valid subperiod | Никакого silent period trim |
| E09 | 20 параллельных viewers+refresh | Snapshot invariant, budgets measured |
| E10 | Existing stores/reports/photo/schedules | Нет регрессии навигации/источников |

## 9. Макеты и приёмка

Отдельная спецификация: `STORES_ANALYTICS_MOCKUPS_2026-09-29.md`. Числа в интерактивном макете синтетические и видимо подписаны; они не отчёт Poster. Production должен использовать реальные approved records или unavailable states.

Карточки/таблицы/Tabs/DatePicker/Drawer — существующие AntD компоненты с AdminThemeProvider. Макет наследует проверенные токены, но не считается точным browser screenshot действующего UI.

Каждый этап возвращает: changed files, test command/output, source/date/scope, readback, measured limits, statuses passed/failed/blocked/not started, rollback. При critical failed gate следующий зависимый этап не начинается. SQL применять отдельно после проверки; commit/push/deploy — отдельная команда пользователя.
