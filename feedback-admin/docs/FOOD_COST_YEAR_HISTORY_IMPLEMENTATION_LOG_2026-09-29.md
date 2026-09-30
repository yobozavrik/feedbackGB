# Исполнение годовой истории цен/продаж/фудкоста

Дата: 29.09.2026. План: `FOOD_COST_SALES_PRICES_YEAR_HISTORY_PLAN_2026-09-29.md`.
Ветка: `codex/technologist-product-cards`, baseline commit `2bda13d`.

## Статус и граница выполненного

| Шаг | Статус | Доказательство |
|---|---|---|
| A-00 | passed | Ветка/commit/status проверены; applied 036–041 не редактируются; live schema прочитана SELECT |
| A-01 | blocked | Доступность выбранных январских источников прошла; полная семантика возвратов/удалений и всех receipt money fields ещё не подтверждена |
| A-02 | not started | Preflight обнаружил отсутствие исторических интервалов; историческую сетевую полноту не утверждаем |
| A-03 | passed для календарного/scope контракта | Единый parser и query adapters; today отделён от closed; full receipt semantics остаётся блокером A-01 |
| A-04 | passed | 87 новых unit tests; общий suite 77 files / 703 tests; typecheck exit 0 |
| A-05…A-22 | not started | Новые SQL/worker/reader/UI ещё не реализованы; календарь не выдаёт неподдерживаемый диапазон |

Рабочая БД и Poster **не изменены**. Код интерфейса/cron не изменён. Миграции 042–045 не созданы/не применены. План, инструмент диагностики, его tests и предыдущая версия журнала закоммичены/отправлены: `21d46a8`, ветка `codex/technologist-product-cards`. Новые календарные/scope файлы и этот update журнала пока не входят в указанный коммит.

Не затронуты пользовательские untracked `docs/PROJECT_DOCUMENTATION_MASTER_PLAN.md`, `docs/architecture/`, `feedback-admin/.playwright-cli/`.

## A-01: исполненный read-only source probe

Команды из `feedback-admin`:

```text
npm test -- src/lib/admin/__tests__/analyticsHistoryProbe.test.ts
node --check scripts/probe-poster-analytics-history.mjs
node scripts/probe-poster-analytics-history.mjs
npm run typecheck
npm run lint
```

Первый запуск 12:24:59–12:25:00 UTC завершился exit 1: receipt-page checks получили `probe_invalid_money`. Не принимали за passed. Диагностика фактического формата показала major decimal strings в `transactions.getTransactions`. Исправлен только новый probe parser, не рабочая финансовая логика. Добавлены tests для conversion/factor/missing match/precision.

Повтор 12:27:09.085–12:27:11.190 UTC (15:27 Kyiv): exit 0, status=passed, 16 ограниченных read checks. Это status **инструмента**, не полного A-01 и не годового backfill.

| Источник / дата | Фактический результат |
|---|---|
| access.getSpots | 26 текущих IDs 1–26; historicalIntervalsConfirmed=false |
| network sales 01.01.2026 | Пустой массив, SHA-256 `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| network sales 15.01.2026 | 223 строки / 209 товаров / 20 modifier rows, units kg,p; paid=68841340 / profit=38905178 / netto=38945010 minor |
| spot1 sales 15.01.2026 | 87 строк, paid=2812990 minor |
| supplies 15.01.2026 | 42 active documents; aggregate supply_sum=27662056 minor; один проверенный detail #50689: 2 строки, 676345 minor |
| network sales 28.09.2026 | 274 строки / 255 товаров / 24 modifier rows, paid=65353903 / profit=38749250 / netto=39053600 minor |
| spot1 sales 28.09.2026 | 94 строки, paid=2940580 minor |
| supplies 28.09.2026 | 32 active documents, aggregate supply_sum=24777396 minor; один detail #58241: 1 строка, 306000 minor |
| receipts 15.01.2026 | declared=2414, page1/per_page2 проверена, только 2 sampled receipts |
| receipts 28.09.2026 | declared=2188, page1/per_page2 проверена, только 2 sampled receipts |
| Receipt money bridge | По 2 receipt IDs каждого дня найдено в dash.getTransactions; major→minor ×100 точно совпало, float не использован |

Дополнительные SHA-256 raw response (raw responses и PII не сохранялись):

- network sales 15.01: `1b16ea0a32ced605d2f429e3c7de031f40a614a530bb46a86e9d90e6083fde5b`.
- spot1 sales 15.01: `336c6e6fbdfe931b6fdcccb45e27635890c2ae5e3d506612af363074e083dc1b`.
- supplies 15.01: `81d4ab8f9c73ee43466e286ecf8540465f3110e9b5e830129947b45fd8de11b6`.
- supply detail 50689: `8a97b6d1ab162c3f087f699bc8dc8cb46cb24ec08290a501079eafd5eeaea147`.
- network sales 28.09: `e1a3330f9487955cd2c5dcb2c696f26a2d30ffc9424326d5bf02afc9cda2c16e`.
- receipt page 15.01: `82216608d904f3916afdb6b26588f5ee40fb284ed96bb02028313533a185b361`.
- receipt page 28.09: `5c4897e70da3e5b039c08f802184922574833896dc7f41506ff2c82ed9c38974`.
- dashboard receipts 15.01: `a681ff738383a81e7afd1023152a6b228dfad2ee72edb7d13b22ad89a731be0f`.
- dashboard receipts 28.09: `ac4b14a04c1851cd71f64b35b08c55ec0c4b9d265c906c9aa6baabfb9e04c6b9`.

Пустой ответ 1 января не доказывает открытие/закрытие магазина и не объясняет причину отсутствия продаж. Все чеки за эти дни не импортированы и полная pagination не проверена. Редкие кейсы deleted/refund не попали в sample — не считаем их принятыми.

## Историческая популяция и расхождение складов: SELECT preflight

В `categories.spots` нет дат открытия/закрытия; таблиц `feedbackgb.analytics_*` пока нет. `categories.storages` имеет текущие ID/storage_name/address/spot_id/is_deleted, но не интервалы исторического mapping.

```sql
select storage_id, spot_id, is_deleted
from categories.storages
where storage_id = 59 or spot_id = 26
order by storage_id;
```

Actual row: `{storage_id:59, spot_id:null, is_deleted:false}`.
Poster access.getSpots одновременно: `{spotId:26, storageId:59}`.
Текущие пары 1–25 совпали с ERP SELECT; для 26 ERP mapping не задан. SQL обновления не выполнялись. Нельзя молча назначить этому складу исторический магазин с 1 января.

## Что нужно для следующего gate

1. Подтверждённые реальные примеры возврата/удалённого/отменённого чека в Poster (ID/даты без клиентских данных) или расширенный bounded read-only поиск таких кейсов по истории. Дополнительного разрешения для обычной безопасной read-only проверки не требуется; она сама не восстанавливает отсутствующие даты открытия магазинов.
2. Даты открытия/закрытия/переносов точек и складов, если требуется именно полная историческая сеть, а не scope текущих выбранных магазинов.
3. Для магазина 26 уточнить источник и дату начала связи склад59→магазин26. Текущую связь Poster можно хранить как observation с текущей датой, но не выдумывать validity с января.
4. Альтернативный явно согласованный порядок: реализовать календарь и history reader для scope **текущих выбранных магазинов**, с historicalRosterVerified=false, не выдавая это за подтверждённую сеть с января. Это изменение strict gate-порядка плана, не скрытый обход.

## Проверки нового кода

- 33 unit tests нового probe: passed.
- Повторный real source probe: exit 0, 16 read checks passed, границы проверки описаны выше.
- Typecheck: passed, exit 0 после money-fix.
- Lint: exit 0; три warning в ранее существующих absences/schedules файлах (dependencies и img), новые probe-файлы warning не получили.
- Полный unit suite: 75 test files / 616 tests passed, exit 0, 63.38 s.
- UI/E2E/build не запускались: UI и рабочие маршруты этой итерацией не изменены.

Откат локальной итерации: исключить новые probe-файлы из релиза. Applied миграции и рабочие данные не затронуты.

## Продолжение после commit/push: A-03/A-04

После ответа пользователя «комит+пуш. продолжай» продолжение явно объявлено для **текущих выбранных магазинов** с `historicalRosterVerified=false`. Это ограниченный альтернативный порядок из пункта 4 выше, не закрытие A-01/A-02 и не разрешение выдумать исторические даты или изменить mapping склада 59.

Добавлены pure modules `analyticsPeriod.ts` и `analyticsScope.ts` (пока не подключены к действующим routes/UI):

- Пресеты 7/14/30/60/90, вчера/сегодня, месяц/предыдущий месяц, квартал, YTD, вся история и произвольный календарь; история от 01.01.2026, прошлые годы не отбрасываются.
- Обе границы включены, календарные даты Kyiv не зависят от UTC/DST длительности суток. Один supplied clock фиксируется в `resolvedAt`.
- Сегодня выделено как provisional; закрытые дни и сравнение не смешиваются с ним. На первом дне месяца/года closed-only preset явно возвращает `analytics_closed_period_empty`, а не чужие даты.
- Сравнение previous/custom/off; период до доступной истории остаётся unavailable с исходными endpoints и пустым `dates`, без подрезания и без попытки читать/выделять огромное количество недоступных дат.
- Старые `days=7/14/30/60`, `spot_id=ID|all` адаптируются; новые `spot_ids` поддерживают несколько магазинов; membership проверяется по verified current roster.
- Дубликаты/conflicts, неверные даты, future dates, недопустимые IDs отклоняются. Query helpers сохраняют tab/category/method и не меняют caller query.

Первый targeted запуск: 85 passed / 2 failed. Причина — неверная параметризация пустых массивов в `it.each`, а не скрытая смена business logic. Первый typecheck также выявил соответствующую ошибку типов. Исправлена параметризация, повторные проверки:

```text
npm test -- src/lib/admin/__tests__/analyticsPeriod.test.ts src/lib/admin/__tests__/analyticsScope.test.ts
2 files / 87 tests passed, exit 0

npm test
77 files / 703 tests passed, exit 0, 7.28 s

npm run typecheck
exit 0

npm run lint
exit 0, те же 3 existing warnings absences/schedules
```

UI/E2E/build не выполнялись для новых pure modules: действующие страницы/маршруты и отображение периода не менялись. Эти tests **не доказывают** полноту истории, реальные SQL permissions/leases, загрузку года или работу календаря в браузере. Следующий шаг — 042 с отдельными readback/rollback и реальной проверкой SQL перед переходом к worker; применять SQL без проверки текущей структуры нельзя.
