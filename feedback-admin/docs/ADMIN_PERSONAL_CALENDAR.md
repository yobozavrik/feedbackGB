# Особистий календар адміністратора

## Призначення та межі

Головна `/admin` вітає адміністратора ім'ям з перевіреної підписаної сесії.
PIN перевіряється існуючим login-маршрутом; календар не отримує і не зберігає PIN.
Окремий пункт «Календар» у групі «Робота»: `/admin/calendar`.
Використовуються чинні AdminPageContainer, AntD, токени світлої/темної теми.

Кожен admin/super_admin має тільки власний календар. Super_admin у цій версії
не отримує доступ до чужих календарів. Календар не змінює «Мої завдання»
(призначені заявки feedback), графіки продавців і HR-відсутності.

## Механіка

1. Admin входить існуючим PIN, login створює сесію з `uid/full_name/role`.
2. API перевіряє сесію та актуальний активний admin/super_admin у `users`.
3. GET/POST/PATCH використовують тільки `session.uid` як `owner_id`.
4. Admin створює назву, опис, дату/час задачі, необов'язковий час нагадування.
5. Задача має статус `planned` або `done`. Редагування і виконання — у формі.
6. При PATCH перевіряються ID + owner_id + row_version. Конкурентна зміна дає 409,
   а не перезапис чужої версії. Чужий/відсутній ID дає той самий 409.
7. SQL-тригер атомарно збільшує версію й записує попередній/новий стан у журнал.
8. Нагадування перевіряються раз на 60 секунд на всіх сторінках відкритої адмінки,
   також при поверненні у вкладку. Прострочені непідтверджені теж показуються.
9. «Зрозуміло» зберігає підтвердження в БД. Хрестик закриває тільки поточне
   повідомлення; після нового відкриття адмінки воно може повторитись.
10. Зміна часу нагадування або повернення `done → planned` скидає підтвердження.

Немає видалення задач у v1: зберігаємо історію, виконані задачі позначаємо done.
Немає email, Telegram, web-push або фонового планувальника. При закритій адмінці
повідомлення не доставляються. Це не гарантія доставки точно в задану секунду.
UI використовує часовий пояс браузера, API і БД — timestamptz/UTC; UI явно
показує часовий пояс. Є місячна сітка, вибір дня та повний список задач дня.

## Структура

- `src/lib/admin/calendar.ts`: тип, поля та валідація.
- `src/app/api/admin/calendar/route.ts`: приватний API (no-store).
- `src/app/(admin)/admin/calendar/`: сторінка й клієнт.
- `src/components/admin/CalendarReminders.tsx`: повідомлення у спільному App.
- `supabase/039_admin_calendar.sql`: tasks, events, індекси, тригери, ACL.

Усе нове — у `feedbackgb`, нічого у схемі `public`. RLS увімкнений,
anon/authenticated/PUBLIC не мають доступу. Вхід у проекті не Supabase Auth,
тому RLS не використовує `auth.uid()` як ідентифікатор нашої cookie-сесії.
Доступ виконує серверний service_role; приватність між admin забезпечується
обов'язковим owner-фільтром API. Service_role — довірений контур, не користувач.
Токени/PIN не потрапляють у записи задач чи журнал.

## Впровадження — по кроках

1. Перед застосуванням перевірити, що номер 039 не зайнятий іншою міграцією.
2. На staging застосувати `039_admin_calendar.sql` одним блоком BEGIN/COMMIT.
   Застосовані міграції не редагувати. Цей файл не призначений для повторного запуску.
3. Виконати readback нижче: 2 таблиці, RLS true, service true, anon/auth false.
4. Запустити typecheck та цільові tests, production build.
5. Увійти admin A, перевірити ФІО в привітанні, відкрити календар.
6. Створити задачу і нагадування на найближчу хвилину, перезавантажити сторінку.
7. Перейти на іншу вкладку адмінки, перевірити повідомлення, підтвердити,
   перезавантажити — повторного повідомлення немає.
8. Увійти admin B: задачі A не видно. Запит PATCH задачі A від B → 409,
   стан A незмінний. Перевірити також super_admin як окремого власника.
9. Перевірити 2 паралельні редагування: перший успішний, другий 409.
10. Перевірити done не нагадує, повернення planned скидає підтвердження.
11. Перевірити межу місяця, часовий пояс, мобільний розмір та темну тему.
12. Перевірити events: create/update/ack та збільшення row_version.
13. Тільки після приймання застосовувати міграцію на робочому контурі.

```sql
select c.relname, c.relrowsecurity,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  has_table_privilege('service_role', c.oid, 'SELECT') as service_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'feedbackgb'
  and c.relname in ('admin_calendar_tasks','admin_calendar_events');

select event_object_table, trigger_name
from information_schema.triggers
where event_object_schema = 'feedbackgb' and event_object_table = 'admin_calendar_tasks';
```

## Поточні перевірки

- TypeScript: passed.
- ESLint нових файлів календаря: passed, без warnings/errors.
- Unit/API: 35 passed; mocks, не live SQL/E2E.
- Production build: failed через чотири `react-hooks/rules-of-hooks` помилки
  у раніше зміненому `food-cost-matrix.tsx:155–160`. Календар пройшов компіляцію;
  це не підтвердження успішної збірки всього проекту. Foodcost у цій задачі не змінювали.
- Міграція тут не застосовувалась; live SQL/readback/E2E не виконані.
- Наявні незакомічені зміни foodcost та документації збережені без втручання.

Команди:

```powershell
npm.cmd run typecheck
npm.cmd run test -- src/lib/admin/__tests__/calendar.test.ts src/app/api/admin/calendar/__tests__/route.test.ts
npm.cmd run build
```

## Відкат

Спочатку відкотити UI/API-код. Нові таблиці можна залишити для збереження задач
і журналу: вони не змінюють existing feedback/users. Не видаляти дані автоматично.
При schema_missing API дає 503 з повідомленням про 039, а не порожні вигадані дані.
