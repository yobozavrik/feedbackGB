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
