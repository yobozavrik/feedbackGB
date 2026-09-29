# Ночная загрузка foodcost: контракт и журнал внедрения

## Цель и границы

Восстанавливать отсутствующие продажи Poster и поддерживать полноту завершённых
календарных дней по текущему списку магазинов. Только схема `feedbackgb`.
Для выбора 60 дней и сравнения с предыдущими 60 требуется горизонт 120 дней.
Завершённые исторические версии не удалять и автоматически не пересчитывать.
Это не доказательство исторического состава сети: он по-прежнему не известен.

Исполнитель — Luna 6; review, проверки и приёмка — root.
Никаких изменений карточек, формул foodcost, календаря или сторонних схем.

## Уже существующие зависимости

- 036: `poster_supply_cost_runs/documents/averages`, снимок накладных за 30 дней.
- 037: `foodcost_sales_runs/facts`, обе методики Poster, деньги в minor units.
- 038: leases и атомарный `complete_foodcost_sales_sync_run`, сверка количества
  и сумм перед публикацией версии.
- `syncPosterSalesSpotDay`: разбор полного ответа Poster, запись фактов,
  readback, атомарное завершение; повтор неизменного ответа не создаёт версию.
- Текущие приложения читают только completed версии. Не подменять отсутствие
  данных нулями или частично зелёным обзором сети.

Read-only проверка 29.09: PG 15.8, существование 036–038 подтверждено;
контрольный run `e10f84dc-b7f2-46d0-a94b-1a40d8d896f2` совпал с рабочей БД.
За 22–24 сентября есть по 26 completed spot; 25–28 отсутствуют.
Несколько completed версий одной пары допустимы: читатель выбирает последнюю.

Контроль полноты перед изменениями, по текущим 26 магазинам и закрытым датам:

| Период | Ожидаемые пары | Completed пары | Пропуски |
| --- | ---: | ---: | ---: |
| 7 дней | 182 | 78 | 104 |
| 14 дней | 364 | 260 | 104 |
| 30 дней | 780 | 390 | 390 |
| 60 дней | 1560 | 390 | 1170 |
| 120 дней | 3120 | 390 | 2730 |

Это наличие completed снимков, а не независимое подтверждение их равенства
текущему ответу Poster. Обнаруженное ранее расхождение исторической версии
24.09 не исправляется скрыто этим missing-only worker.

## Новая миграция 040

Файл: `supabase/040_foodcost_sales_backfill_queue.sql`.
Таблицы: `foodcost_sales_backfill_jobs`, `foodcost_sales_backfill_attempts`,
`foodcost_sales_backfill_events`. Views: `v_foodcost_sales_backfill_coverage`,
`v_foodcost_sales_backfill_health`.

RPC: `seed_foodcost_sales_backfill_jobs`, `claim_foodcost_sales_backfill_job`,
`complete_foodcost_sales_backfill_job`, `fail_foodcost_sales_backfill_job`.
Статусы: pending → running → completed либо retryable_failed → running;
после восьмой неудачи — failed, без молчаливого признания периода полным.
Queue lease — 15 минут; завершение/ошибка проверяют owner и фактическое
время после получения блокировки строки. Backoff — 5 минут с удвоением
до ограниченного максимума. Журнал attempts/events только читается service_role;
запись выполняют защищённые функции/триггер.

1. Очередь на уникальную пару `business_date × spot_id`, статусы pending,
   running, completed, failed/retry согласно окончательному SQL.
2. Lease владельца, expiry, attempts, next_attempt_at, безопасный error_code,
   ссылка на подтверждённый completed run.
3. Функция seed: до 120 закрытых дат, bounded текущий roster (не более 100);
   добавить только пары без completed run; повтор seed идемпотентен.
4. Claim через `FOR UPDATE SKIP LOCKED`; newest missing сначала. Просроченный
   running возвращается в обработку, старый owner не может завершить новый lease.
5. Finish подтверждает run, пару и ownership; fail ставит backoff и сохраняет
   факт ошибки. Одна проблемная пара не блокирует другие магазины.
6. Триггер журнала переходов — только запись в БД, без HTTP или токена Poster.
7. Вью состояния очереди/покрытия и индексы claim/latest-completed.
8. RLS на новых таблицах; отзыв PUBLIC/anon/authenticated, только service_role;
   SECURITY DEFINER с фиксированным search_path, квалифицированными именами.
9. Readback и безопасный откат отдельно; не изменять применённые 036–039.

## Worker и расписание

- Production-only маршрут `/api/cron/poster-foodcost-sales`.
- Без CRON_SECRET — 503; неверный Bearer — 401; Preview/local не пишут.
- На каждом вызове проверять текущий roster Poster против `v_stores`.
- Seed пропусков; ограниченный worker: до 80 пар и бюджет обработки 210 секунд
  при maxDuration=300. Новую пару не начинать при остатке менее 110 секунд:
  claim до 8 секунд, job до 75, cleanup до 10, запись сбоя до 5 и health до 8.
  Cleanup имеет независимый короткий timeout, чтобы записать сбой даже после
  отмены основного worker. Grace не означает право продолжать новые jobs.
- Все операции одной пары должны иметь реальный deadline/abort, а не
  Promise.race, оставляющий фоновую запись. После timeout следующий worker
  восстанавливает работу через lease, но не объявляет её completed заранее.
- Очередь хранит прогресс между вызовами и после сбоя/таймаута процесса.
- Уже completed пара при повторном claim не должна перечитываться из Poster
  и автоматически создавать новую историческую версию.
- Итог ответа различает обработанный batch и полноту горизонта. HTTP 200
  не означает «все 120 дней загружены».

Пять ежедневных slots продаж: **22:10, 23:10, 00:10, 01:10, 02:10 UTC**.
Киев: 00:10–04:10 зимой, 01:10–05:10 летом. Отдельные daily expressions;
не рассчитывать на точность до минуты на Hobby. Фактический тариф не проверен.
Существующие два вызова поставок перенести на **23:40 и 01:40 UTC**;
контракт поставок остаётся 30 дней, не обещать этим полноту цен за 60+60.
Другие cron не изменять. Vercel сам не повторяет упавший вызов: повторные slots
и persistent очередь обеспечивают продолжение.

Источники платформенных ограничений проверены 29.09.2026:
[UTC и управление cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
[тарифы и точность расписания](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Последовательные gates

G1 — SQL и worker review → G2 — unit/API/static/build → G3 — ручное применение
040 и DB readback → G4 — bounded реальная запись и повтор/idempotency →
G5 — Production deploy, CRON_SECRET, первый ночной запуск и подтверждение БД.
Не считать G3–G5 passed по тестам с mock-БД.

Минимальные проверки:

1. Закрытые даты Europe/Kyiv, переход месяца/года/DST.
2. Диапазон 120 дней включает current60 + previous60, без сегодня.
3. Повтор seed не удваивает очередь.
4. Seed не добавляет completed пары.
5. Current roster проверен по обеим сторонам; mismatch останавливает seed.
6. Claim не отдаёт одну пару двум workers.
7. Просроченный lease восстанавливается.
8. Старый owner не завершает работу после reclaim.
9. Finished run соответствует дате/магазину и действительно completed.
10. Ошибочный ответ Poster не публикует run.
11. Readback количества/paid/profit/netto перед completed.
12. Ошибка пары → safe code/backoff; следующая пара доступна.
13. Ограничение числа jobs и времени; abort без fire-and-forget.
14. Нет CRON_SECRET / неправильный Bearer / spoofed header.
15. Preview/local → skipped, worker не вызван.
16. Supply cron имеет ту же fail-closed границу Production.
17. No-store ответы, отсутствие секретов и raw sale rows в ответе/журнале.
18. Полный suite, typecheck, lint, production build, diff check.
19. ACL/RLS, индексы, SQL-функции/триггер/view readback после миграции.
20. Повтор реальной bounded записи не меняет completed снимок.
21. Vercel actual execution и coverage/readback; E2E overview/matrix после полноты.

## Фактический статус

- SQL-доступ через подключённый инструмент — только SELECT/WITH/EXPLAIN;
  DDL не выполнялся и обход ограничения не предпринимается.
- Фактическая попытка `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` через этот
  connector вернула `syntax error at or near "analyze"`: обёртка не исполняет
  EXPLAIN как самостоятельную команду. Замер SQL-плана не подтверждён;
  выполнять его в SQL Editor после миграции, не считать статический review замером.
- Vercel CLI не авторизован; проверка Production env остановлена на login.
  Наличие CRON_SECRET на Vercel и actual deployment не подтверждены.
- G1: SQL/worker review завершён. G2: 74 test files / **583 tests passed**,
  `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` и
  `git diff --check` завершились с кодом 0. Lint имеет три прежних предупреждения
  в графиках/отсутствиях; новых предупреждений нет. Сборка не доказывает
  выполнение миграции или работоспособность реального cron.
- В unit-тестах проверены отдельные неправильные owner/date/lease, неверный
  historical flag, устаревший range, NULL counts; фикстуры сохраняют остальные
  корректные поля, чтобы отказ не маскировался другой ошибкой. Дополнительно:
  timeout с реальным AbortSignal, продолжение после сбоя, остановка при отказе
  журнала/отсутствующей схеме, лимит claim и distinction partial/complete.
- G3–G5: **blocked** до применения 040 и readback. В рабочую БД этой задачей
  пока не записывали. SQL-конкурентность, восстановление lease и ACL после
  применения ещё не проверены в runtime и не считаются passed по mock-тестам.
- CLI запущен без `--execute`: проверка roster пройдена, чтение новой health view
  вернуло `schema_missing` (040 отсутствует). Это read-only preflight, не синк.
- Проверено read-only: service_role имеет BYPASSRLS, anon/authenticated — нет;
  481 existing completed run сопоставлен с количеством и суммами фактов,
  внутренних mismatch — 0. Это не сверка с новым live-ответом Poster.
- Изменения расписания в файле начнут действовать только после Production deploy.
- Начальная история 120 дней заполняется постепенно; срок не обещается без
  замера actual throughput. Предыдущая проверка 78 пар за ~76 секунд не
  является SLA текущего worker или Vercel.

## Следующий шаг оператора

1. В SQL Editor рабочей базы выполнить **только**
   `supabase/040_foodcost_sales_backfill_queue.sql` целиком: BEGIN–COMMIT.
   Не запускать rollback. Не изменять уже применённые миграции.
2. Выполнить read-only `supabase/040_foodcost_sales_backfill_readback.sql`:
   три RLS-таблицы, два view, четыре RPC и trigger, права только service_role,
   соответствующий current-roster coverage и отсутствие внутренних mismatch.
   EXPLAIN в конце запускать отдельно в SQL Editor; это реальное выполнение SELECT.
3. Из `feedback-admin` сначала запустить без записи:
   `node scripts/sync-poster-foodcost-sales-nightly.mjs`.
   После подтверждения G3 выполнить ограниченную реальную загрузку:
   `node scripts/sync-poster-foodcost-sales-nightly.mjs --execute --max-jobs 1`.
   **Важно:** max-jobs ограничивает загрузку одной пары, но seed при этом создаёт
   очередь всех пропусков горизонта (до 120 × текущие магазины).
4. Сверить фактический новый completed run: дата/магазин, количество, суммы
   и source facts с live Poster. Повторно вызвать worker и проверить, что готовая
   пара пропущена: повтор может обработать следующую пропущенную пару,
   но не должен переписывать предыдущую. Конкурентность проверять отдельно,
   не тестовыми продажами на рабочих магазинах.
5. После приёмки — commit/push/deploy в Production по отдельному запросу.
   Проверить наличие `CRON_SECRET` (не выводить значение), Poster token и
   service_role на Production; подтвердить первый actual cron по logs + DB.
   Один HTTP 200 или наличие расписания в Git не считается ночным запуском.

## Readback после применения 040 — 29.09.2026

- Фактически подтверждены: 3 таблицы с RLS, 2 security-invoker view,
  4 SECURITY DEFINER RPC с фиксированным search_path, trigger журнала,
  6 индексов (включая PK), отсутствие доступа anon/authenticated.
- CLI dry-run: `dateFrom=2026-06-01`, `dateTo=2026-09-28`, `spotCount=26`,
  `healthAvailable=true`, `writes=false`, exit 0.
- Health: 3120 ожидаемых пар / 390 completed / 2730 пропусков.
  Jobs / attempts / events = 0 / 0 / 0. Seed/реальная загрузка не запускались.
- **G3 failed:** фактический ACL `service_role=arwd/supabase_admin`
  на attempts/events и обеих view. Причина: существующие default privileges
  выдали CRUD при создании; `GRANT SELECT` в 040 не снимает ранее выданные права.
  Это недочёт 040, а не ошибка пользователя. Публичный доступ при этом закрыт.
- Подготовлена forward-only **041_foodcost_backfill_journal_acl.sql**:
  revoke всех прав на эти четыре объекта и grant только SELECT service_role.
  Данные, функции, триггер, таблица jobs и default privileges схемы не меняются.
  Применённую 040 не редактировали. 041 пока **не применена**.
- G4 заблокирован до подтверждения SELECT-only ACL; нельзя считать readback
  успешным по одному наличию объектов или запускать следующий gate заранее.

## Приёмка после 041 и реальная дозагрузка — 29.09.2026

Этот раздел обновляет предыдущий статус: **041 применена и проверена**.
У service_role на attempts/events и обеих view фактически только SELECT;
INSERT/UPDATE/DELETE false. У anon/authenticated все четыре права false.
G3 по объектам/RLS/ACL пройден; EXPLAIN/runtime fault-injection не выполнялись.

### Ограниченная приёмка

1. `sync-poster-foodcost-sales-nightly.mjs --execute --max-jobs 1`:
   seed 2730 / processed 1 / completed 1 / failed 0 / timedOut 0.
   Кварц, 28.09, run `d8633d1a-1b5a-4d78-9cbc-fd648c2401c1`, 94 строки.
2. `verify-poster-foodcost-sales-pair.mjs 2026-09-28 1 --check-idempotency`:
   fresh Poster response, все нормализованные поля 94 строк совпали;
   суммы raw fields независимо просуммированы через BigInt и совпали с run:
   paid=2940580 / profit=1780362 / netto=1796027 minor units.
   SHA-256 raw response: `e089932fcef5bbb336b651e10adf586678a2fadb9359a69b2758a187069ec08b`.
   Повтор missing-only: тот же run, completed count 1→1, повтор seed добавил 0.
3. Два параллельных worker с max-jobs=1 обработали разные пары:
   Шкільна/116 строк и Герцена/85 строк за 28.09. Интервалы attempts
   реально перекрылись в БД: 11:27:29.838–11:27:30.697 UTC и
   11:27:29.882–11:27:30.706 UTC. Два разных owner, две успешные attempts.
   Обе пары дополнительно сверены с fresh Poster по всем нормализованным
   полям и независимым raw денежным суммам. Дубли не появились.
   Это ограниченная реальная конкурентная проверка, не доказательство всех
   аварийных сценариев lease/reclaim/падения процесса.

### Восстановление недели

- После первых трёх пар выполнена партия max-jobs=80:
  processed=80 / completed=80 / failed=0 / timedOut=0.
- Readback: 161/182 пары недели, 21 пропуск за 25.09.
- Выполнена партия max-jobs=21: все 21 completed, failed/timedOut=0.
- Всего этой задачей записано **104 новых completed пары** реальных продаж.
  Jobs: completed=104 / pending=2626, нет running/retryable_failed/failed.
  Completed coverage за 120 дней: 494/3120; исторический roster не подтверждён.
- Неделя 22–28.09: **182/182**, previous7 15–21.09: **182/182**.
  Current14 15–28.09: **364/364**; previous14 01–14.09: **130/364**.
  Current30: 494/780; current60: 494/1560. Длинную историю сейчас не дозагружали.

### Проверка пути чтения приложения

`node scripts/check-foodcost-plan-readback.mjs --read-model-days 7` завершился
exit 0, read-only. Использован реальный `loadFoodcostRecentBreakdown`, тот же
server loader, что обслуживает фудкост. Он вернул:

- status=complete, expectedCells=completedCells=182;
- 26 категорий, 275 продуктов, 7 дат категории;
- paid=486814868 / profit=290362882 / netto=292479005 minor units.

Независимый SQL по latest completed парам подтвердил те же суммы,
182 пары и 15920 строк фактов. Проверка metadata↔facts всех 585 completed
versions в БД: **0 внутренних mismatch**. Это не fresh Poster сверка всех
585 versions: отдельно fresh сверены только три контрольные пары, как выше.
Старые исторические версии не пересчитывали; прежнее известное расхождение
24.09 не объявляем исправленным этим missing-only worker.

G5 остаётся не принят: Production deploy, наличие CRON_SECRET и actual
ночной запуск в Vercel этой проверкой не подтверждены. Наличие очереди
или успешный локальный CLI не заменяет фактического Production cron.

### Локальная визуальная проверка

В авторизованной in-app browser вкладке открыта
`http://localhost:3211/admin/technologist/food-cost?tab=overview&days=7`.
Первый переход задержался на cold dev compilation (33,5 с в журнале Next),
после компиляции HTTP 200 и видимый экран подтверждены; таймаут навигации
не принимали за успешную отрисовку.

На экране подтверждены: 7 завершённых дней, current и previous 182/182,
оплачено 4 868 148,68 грн, фудкост 40,35% / 39,92%, график, тепловая
карта на все 7 дат и рейтинги категорий/продуктов. Сообщения о неполном
снимке недели больше нет. Это проверка локального Overview; все остальные
вкладки и Production UI в этой итерации заново не проверялись.
