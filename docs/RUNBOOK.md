# RUNBOOK

> Як запустити, задеплоїти, прокачати і відремонтувати FeedbackGB.
> Якщо щось зламалось у проді — починай тут.

Зміст:

1. [Локальний запуск](#1-локальний-запуск)
2. [Змінні середовища](#2-змінні-середовища)
3. [Базова налаштування Supabase](#3-базова-налаштування-supabase)
4. [Налаштування Telegram-боту](#4-налаштування-telegram-боту)
5. [Налаштування Google Drive (опційно)](#5-налаштування-google-drive)
6. [Деплой на Vercel](#6-деплой-на-vercel)
7. [Cron і моніторинг](#7-cron-і-моніторинг)
8. [Операції](#8-операції)
9. [Типові інциденти](#9-типові-інциденти)

---

## 1. Локальний запуск

### Передумови

- Node.js ≥ 18.18 (Next.js 14 ставить такий мінімум).
- npm ≥ 10.

### Кроки

```bash
git clone https://github.com/yobozavrik/feedbackGB.git
cd feedbackGB
cp .env.example .env.local         # потім заповни
npm install
npm run dev                        # http://localhost:3000
```

### Скрипти

| Скрипт | Що робить |
|---|---|
| `npm run dev` | Next.js dev server з HMR |
| `npm run build` | Production build (Next 14 standalone) |
| `npm run start` | Запуск production-build локально |
| `npm run lint` | `next lint` (eslint-config-next) |
| `npm run typecheck` | `tsc --noEmit` (strict + plugin Next.js) |

### Smoke-перевірка (без Telegram/Supabase)

Без env-ів API не падає, тільки повертає `{persisted:false}` (див.
`isSupabaseConfigured()` у `src/lib/supabase.ts`). Це достатньо, щоб
переконатись, що UI рендериться.

---

## 2. Змінні середовища

Усі змінні задокументовані у [`.env.example`](../.env.example). Коротко
по групах:

| Group | Змінна | Required | Призначення |
|---|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL` | ✅ | endpoint Supabase REST/Storage |
|  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | для шару клієнт-фронту (зараз app користується тільки server-side, але Next-білд просить публічний ключ) |
|  | `SUPABASE_SERVICE_ROLE_KEY` | ✅ | server-only, BYPASSRLS; ніколи не у браузер |
| Telegram | `TELEGRAM_BOT_TOKEN` | ✅ | для HMAC `initData` + надсилання звітів |
|  | `TELEGRAM_REPORT_CHAT_ID` | ✅ | куди cron шле звіт (negative для group; supergroup починається з `-100`) |
| Session | `SESSION_SECRET` | ✅ (prod) | HMAC ключ для cookie `fbgb_session`. ≥32 байтів. **Не reuse** з SUPABASE_SERVICE_ROLE_KEY. Згенеруй: `openssl rand -hex 32` |
| Cron | `CRON_SECRET` | ✅ (prod) | bearer для `/api/cron/*` (Vercel Cron шле). Згенеруй: `openssl rand -base64 48` |
| POS | `NEXT_PUBLIC_POSTER_CDN_BASE_URL` | recommended | base для `v_products.photo` (Poster API) |
| Photo links | `REPORT_PHOTO_LINK_MODE` | optional (default `supabase`) | `supabase` / `drive` / `telegram` |
|  | `PHOTO_REDIRECT_BASE_URL` | optional | override base для `/api/r/photo/<id>`. На Vercel детектиться автоматично через `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` |
| Google Drive | `GOOGLE_DRIVE_FOLDER_ID` | optional | id папки, куди дзеркалити |
|  | `GOOGLE_DRIVE_SA_KEY` | optional | повний JSON service-account (1 рядок або з \n) |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY` | optional | `phc_…` project key (не personal) |
|  | `NEXT_PUBLIC_POSTHOG_HOST` | optional | default `https://eu.i.posthog.com` |

**Перевірка перед prod-деплоєм:**

```bash
# Усі required — заповнені?
grep -E '^(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|TELEGRAM_BOT_TOKEN|TELEGRAM_REPORT_CHAT_ID|SESSION_SECRET|CRON_SECRET)=' .env.local
```

### Ротація `SESSION_SECRET`

При зміні всі чинні сесії інвалідуються (HMAC більше не пройде). Юзери
будуть перенаправлені на `/login`. Не страшно — логін PIN-ом займає 5 сек.

### Ротація `CRON_SECRET`

1. Згенерувати новий: `openssl rand -base64 48`.
2. Оновити Vercel ENV, **deploy**.
3. Vercel Cron з наступного запуску використовує новий bearer.

---

## 3. Базова налаштування Supabase

### 3.1 Проєкт + схема

1. Створи проект Supabase (Cloud або self-hosted — work-flow ідентичний).
2. Зайди у **SQL Editor**.
3. Виконай послідовно:
   - `supabase/schema.sql`
   - `supabase/003_v1_priority_flow.sql`
   - `supabase/004_photo_mirror.sql`
   - `supabase/005_per_category_views.sql`
   - `supabase/006_audit_log_full.sql`
   - `supabase/007_feedback_lifecycle.sql` (assigned_to + audit feedback.assign)

Усі ідемпотентні, можна повторювати.

### 3.1.1 Self-hosted Supabase: `pgrst.db_schemas` має містити `feedbackgb`

Актуально, якщо ваш Supabase — self-hosted і на одному інстансі вже
живе кілька проєктів зі своїми схемами поруч із `feedbackgb`.

PostgREST коннектиться до Postgres під роллю `authenticator` і бачить
тільки ті схеми, що перелічені в її параметрі `pgrst.db_schemas`. Якщо
`feedbackgb` у цьому списку немає — будь-який запит з Vercel
(`/api/auth/users`, `/api/feedback`, …) повертає `500` з кодом
`db_error`, навіть якщо у БД дані є і view-и працюють.

Перевірка (виконати у Supabase Studio → SQL Editor):

```sql
select rolname, rolconfig
  from pg_roles
 where rolname = 'authenticator';
```

У відповіді шукай рядок `pgrst.db_schemas=...` — `feedbackgb` має бути
у списку.

Фікс — додати схему до існуючого списку (саме `set`, не `reset` — щоб не
знести інші проекти), і попросити PostgREST перечитати конфіг:

```sql
-- 1) подивитись поточне значення
select rolconfig from pg_roles where rolname = 'authenticator';

-- 2) ALTER ROLE з НОВИМ повним списком: усі попередні схеми + 'feedbackgb'.
--    Зразок (підстав свої актуальні схеми зі step 1):
alter role authenticator
  set pgrst.db_schemas = 'public, <other-schemas>, feedbackgb';

notify pgrst, 'reload config';
```

Через ~5 секунд `/api/auth/users` має ожити. Перевірити можна curl-ом
по вашому prod-домену:

```bash
curl -s https://<your-prod-host>/api/auth/users | head -c 80
# очікується: {"users":[{"id":"...","full_name":"..."
```

Як ця проблема могла зʼявитись: значення `pgrst.db_schemas`
перепрописується **повністю** при `alter role authenticator set
pgrst.db_schemas = '...';`. Додавання нового стороннього проєкту до
того ж Supabase (без копіювання попередніх схем у нову команду) тихо
затирає `feedbackgb` з listу. Завжди робити `set` зі **всім** наявним
списком.

### 3.2 Bucket для фото

1. **Storage** → New bucket → `feedback-photos`, **private**.
2. Policies — НЕ створюємо. Доступ тільки через `service_role`.
3. (Опц.) встановити file-size limit 5 MB у налаштуваннях бакету.

### 3.3 Перший адмін

Користувачі створюються через SQL (адмінки `/admin/users` поки що тільки
показує — створення ще не зроблено):

```sql
insert into feedbackgb.users (full_name, role, store_id)
values ('Галя', 'admin', null)
returning id;
-- запам'ятай UUID, далі задаси PIN

select feedbackgb.set_user_pin(
  '00000000-0000-0000-0000-000000000000'::uuid,    -- сюди UUID
  '123456'                                          -- 6-цифровий PIN
);
```

Потім — увійти в `/login`, обрати "Галя", ввести `123456`.

### 3.4 Зовнішні ERP-таблиці

`categories.spots` і `categories.products` створюються поза цим репо.
Якщо їх ще нема:

- `categories.spots` — імпортувати з POS / заповнити вручну.
- `categories.products` — те саме.

API має fallback на `store_label` (вільний текст), якщо `store_id`
порожній. Без `categories.products` `missing_item`/`overstock`/`defect`
форми не зможуть прив'язати товар.

---

## 4. Налаштування Telegram-боту

### 4.1 Bot

1. `@BotFather` → `/newbot` → відобрази token у `TELEGRAM_BOT_TOKEN`.
2. `/setdomain` → `https://<your-domain>` (Telegram перевіряє домен Mini App).
3. `/setmenubutton` (опц.) → URL Mini App (`https://<your-domain>/`).

### 4.2 Звітний чат

1. Додай бота у потрібний чат (group або supergroup).
2. Зроби бота адміном (без обов'язкових прав, але потрібно для
   надійного `sendPhoto`).
3. Дізнайся `chat_id`:
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"
   ```
   Знайди `"chat":{"id":-...}`. Запиши у `TELEGRAM_REPORT_CHAT_ID`.
4. Якщо id має префікс `-100…` — це supergroup, можеш увімкнути
   `REPORT_PHOTO_LINK_MODE=telegram` для t.me/c/ deep-link.

### 4.3 Превью звіту

Адмінка (`/admin`) має кнопку "Надіслати звіт зараз" → POST
`/api/admin/send-report-now`. Викликає `buildAndSendDailyReport` без
де-дюпу часу. Корисно для smoke після деплою.

---

## 5. Налаштування Google Drive

(Опційно. Без цього `mirrorPendingPhotos()` повертає `drive_env_missing`
і нічого не ламає.)

1. **Google Cloud Console** → IAM & Admin → Service Accounts → **Create
   service account**.
2. Назва, наприклад, `feedbackgb-mirror`.
3. Без grants на проект (Drive ACL — окремо).
4. **Keys** → Add key → JSON. Скачай файл.
5. Скопіюй увесь вміст у `GOOGLE_DRIVE_SA_KEY` (Vercel з `\n` працює;
   або одним рядком).
6. У Drive створи папку, відкрий її → URL `…/folders/<ID>`. Запиши
   у `GOOGLE_DRIVE_FOLDER_ID`.
7. Розшарь папку на email сервіс-акаунту (видно у JSON-у як
   `"client_email": "feedbackgb-mirror@…iam.gserviceaccount.com"`).
   Поставь "Editor".
8. (Якщо плануєш `REPORT_PHOTO_LINK_MODE=drive`) розшарь папку
   ще й на учасників звітного чату. Інакше при кліку Drive відповість
   "Доступ заборонено".

Перевірка:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" \
  https://<your-domain>/api/cron/mirror-to-drive
```

Має повернути `{ok:true, mirrored: <N>, skipped: <M>}`.

---

## 6. Деплой на Vercel

### 6.1 Перший раз

1. **New Project** → Import Git Repository → `yobozavrik/feedbackGB`.
2. Framework Preset → Next.js (auto).
3. Build Command → залишити default (`next build`).
4. Output Directory → залишити default.
5. **Environment Variables** — додати все з [секції 2](#2-змінні-середовища).
   Production scope. (Preview за бажанням з тими ж значеннями або іншою
   Supabase-проектом.)
6. Deploy.

### 6.2 Custom domain

Settings → Domains → Add → DNS. Якщо домен не в Vercel — `CNAME`
на `cname.vercel-dns.com`.

### 6.3 Перший адмін після прод-деплою

Те саме, що у [3.3](#33-перший-адмін), але SQL виконуємо у production-Supabase.

### 6.4 Перевірка після деплою

| Що | Як |
|---|---|
| UI відкривається | `https://<host>/` → редірект `/login` |
| Login picker заповнений | `/login` показує імена з `feedbackgb.users` |
| Login працює | обрати юзера, ввести PIN, потрапити на `/` |
| API auth/me | `curl -b "fbgb_session=..." https://<host>/api/auth/me` |
| Cron-хедер працює | `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/daily-report` повертає або `{ok:true,...}` або `{skipped:true, reason:"not_kyiv_21h"}` |
| Звіт надсилається | через адмінку `Send report now` |
| 📷 у звіті клікається | hover-preview має бути `/api/r/photo/<uuid>` (без token-у) |

---

## 7. Cron і моніторинг

### 7.1 Розклад

`vercel.json`:

```jsonc
{
  "crons": [
    { "path": "/api/cron/daily-report", "schedule": "30 18 * * *" },
    { "path": "/api/cron/daily-report", "schedule": "30 19 * * *" }
  ]
}
```

- 18:30 UTC = 21:30 Kyiv у літо (EEST = UTC+3).
- 19:30 UTC = 21:30 Kyiv у зиму (EET = UTC+2).
- Handler сам перевіряє `kyivNow.hour === 21` → один з двох викликів
  повертає `{skipped:true}`, інший шле звіт.

`/api/cron/mirror-to-drive` поки **НЕ** зареєстрований у `vercel.json`.
Виконується вручну (адмінка) або синхронно з drive-mode звіту. Якщо
треба регулярний — додати окремий `crons` рядок (наприклад, кожні
30 хв).

### 7.2 Моніторинг

- **Vercel → Logs** → фільтр по `cron`. Кожен виклик cron-у залишає
  запис.
- **Vercel → Crons** (нова вкладка): історія, останній статус.
- **Adminка `/admin/audit`** → дії `admin.send_report` /
  `admin.mirror_to_drive` (написуються через `logAudit` з cron теж).
- **Telegram чат** — фактом доставки звіту.

### 7.3 Якщо звіт НЕ прийшов

Чек-лист:

1. Vercel Logs → є виклик о 18:30/19:30 UTC?
2. Якщо є, але `{skipped:true, reason:"not_kyiv_21h"}` — DST-флип може
   бути не там. Передивитися Logs за обидва часи; має бути 1 успіх + 1 skip.
3. Якщо є помилка — копіювати з Logs `code` (`telegram_send_failed_*`,
   `supabase_query_failed_*`, ...).
4. Перевірити, що `TELEGRAM_REPORT_CHAT_ID` коректний:
   ```bash
   curl -X POST "https://api.telegram.org/bot$TOKEN/sendMessage" \
     -d "chat_id=$ID&text=test"
   ```
5. Якщо `chat not found` — бот видалили з групи. Додати знову.

---

## 8. Операції

### 8.1 Створити адміна

Див. [3.3](#33-перший-адмін).

### 8.2 Скинути PIN користувачу

`/admin/users` → поряд з юзером "Скинути PIN". Викликає
`POST /api/admin/users/<id>/pin`. Скидає `failed_attempts`,
`locked_until` атомарно через `set_user_pin` RPC.

Або SQL:

```sql
select feedbackgb.set_user_pin('<uuid>'::uuid, '654321');
```

### 8.3 Розблокувати акаунт після 10 невдалих спроб

`/admin/users` → "Розблокувати". Викликає
`POST /api/admin/users/<id>/unlock` →

```sql
update feedbackgb.users
   set failed_attempts = 0, locked_until = null
 where id = '<uuid>';
```

### 8.4 Експорт фідбеку у CSV

`GET /api/feedback?format=csv` (admin only). Повертає
`text/csv; charset=utf-8`. Поля з префіксами `=/+/-/@` екрануються
(`'`-prefix) для захисту від CSV-injection.

### 8.5 Ретригерити Drive mirror

```bash
curl -X POST -H "x-admin-cron-secret: $CRON_SECRET" \
  https://<host>/api/admin/mirror-to-drive-now
```

Або з адмінки. Запускає `mirrorPendingPhotos()` синхронно. Якщо в
`photo_mirror.attempts >= 5` — рядок пропускається. Щоб скинути:

```sql
update feedbackgb.photo_mirror
   set attempts = 0, error = null
 where attempts >= 5;
```

### 8.6 Подивитись audit log

`/admin/audit` → відсортовано від найсвіжіших. Або SQL:

```sql
select * from feedbackgb.v_audit_log
 order by occurred_at desc limit 100;
```

### 8.7 Перемикання `REPORT_PHOTO_LINK_MODE`

| Режим | Що змінюється | Що треба підготувати |
|---|---|---|
| `supabase` (default) | 📷 → `/api/r/photo/<id>` → 302 Supabase signed URL (TTL 10 хв) | нічого |
| `drive` | 📷 → `/api/r/photo/<id>` → 302 `drive.google.com/file/d/<file-id>/view` | `GOOGLE_DRIVE_*` env-и + папка розшарена на учасників. Mirror тригериться синхронно перед звітом |
| `telegram` | 📷 → `t.me/c/<chat>/<message_id>` (всередині Telegram) | `TELEGRAM_REPORT_CHAT_ID` має бути supergroup (id з `-100`); бот шле фото ПЕРШИМИ, ловить `message_id`, потім текст |

Перемикач — звичайна env-зміна + redeploy.

---

## 9. Типові інциденти

### 9.1 "Login picker порожній"

- Перевір `feedbackgb.users` — `is_active = true` хоча б у одного.
- Якщо база порожня — створи першого адміна (3.3).

### 9.2 "Login повертає `locked`"

Користувач промахнувся 10 разів:

```sql
select id, full_name, failed_attempts, locked_until
  from feedbackgb.users
 where locked_until > now();
```

Адмінка → "Розблокувати" або SQL із 8.3.

### 9.3 "POST /api/feedback повертає 500"

- Перевір Vercel Logs — `code` буде у JSON (`db_insert_failed`,
  `storage_upload_failed`, `tg_validation_failed`, …).
- `db_insert_failed` — найчастіше міграції не накатані (e.g. `feedback`
  без `product_id`). Запусти 003.
- `storage_upload_failed` — bucket `feedback-photos` відсутній або
  неприватний.
- `tg_validation_failed` — `TELEGRAM_BOT_TOKEN` не той самий, що у
  батька Mini App. Або клієнт надіслав застарілий `initData`
  (>24 год).

### 9.4 "Photo redirect повертає 404 на свіжому фідбеку"

`/api/r/photo/<id>` → 404 → причини:

- UUID не валідний (типу обірвали клік) → `{error:"bad_id"}`.
- Запис є, але `photo_url is null` → `{error:"no_photo"}` (фідбек без фото — наприклад, ідея або голос клієнта).
- Запис в `feedback` відсутній → `{error:"not_found"}`. Перевір логи бота, чи правильний UUID у звіті.

### 9.5 "Drive mirror лежить, attempts=5"

```sql
select feedback_id, attempts, error
  from feedbackgb.photo_mirror
 where attempts >= 5;
```

Дивись `error`. Часті:

- `auth_error` — service-account JSON неправильний; або email не доданий
  до папки.
- `quota_exceeded` — Drive quota; зачекати 24 год.
- `not_found` — `GOOGLE_DRIVE_FOLDER_ID` неправильний.

Після виправлення: скинути `attempts`/`error` (8.5) і ретригерити cron.

### 9.6 "Cron-ендпоінт повертає 401"

- bearer не збігається з `CRON_SECRET`. Якщо ти руками — додай
  `Authorization: Bearer $CRON_SECRET` або `x-cron-secret: $CRON_SECRET`.
- Якщо це Vercel Cron — перевір, що `CRON_SECRET` у Vercel ENV
  виставлений (Settings → Environment Variables).

### 9.7 "Усе впало — `/api/auth/users` віддає 500 `db_error`"

Це коренева перевірка для всіх "адмінка не вантажиться" / "логін не
відкривається" симптомів. `/api/auth/users` — єдиний public-ендпоінт,
що ходить у БД, тому він — лакмусовий папір.

```bash
curl -s https://<your-prod-host>/api/auth/users
```

Якщо відповідь `{"users":[],"error":"db_error"}` зі статусом `500` —
далі за списком, у порядку ймовірності, від найдешевшого до
найдорожчого:

1. **Self-hosted: `pgrst.db_schemas` без `feedbackgb`** (див. **3.1.1**).
   Перший підозрюваний на multi-project self-hosted Supabase. Лікується
   одним SQL у Studio, без рестартів і деплоїв.
2. **PostgREST контейнер впав / у crash-loop**:
   ```bash
   docker ps --format 'table {{.Names}}\t{{.Status}}' | grep supabase
   docker logs --since 5m supabase-rest-<id> 2>&1 | tail -50
   ```
   Якщо краш-loop — `docker restart supabase-rest-<id>`. Якщо OOM —
   підняти memory limit у `docker-compose.yml`.
3. **Postgres засіпаний (statement_timeout)** — у логу PostgREST код
   `57014: canceling statement due to statement timeout`. Переконатись:
   ```sql
   -- 1. чи висить щось довге
   select pid, now() - xact_start as runtime, state, left(query, 120)
     from pg_stat_activity
    where state != 'idle' and now() - xact_start > interval '5 seconds';

   -- 2. чи є lock-chain
   select blocked.pid as blocked, blocking.pid as blocking, blocked.query
     from pg_stat_activity blocked
     join pg_stat_activity blocking
       on blocking.pid = any(pg_blocking_pids(blocked.pid))
    where blocked.wait_event_type = 'Lock';

   -- 3. чи у конкретної ролі немає малого statement_timeout
   select rolname, rolconfig
     from pg_roles
    where rolname in ('anon','authenticated','authenticator','service_role');
   ```
   Гасити висячий запит: `select pg_terminate_backend(<pid>);`. Підняти
   `statement_timeout` для ролі: `alter role <name> set
   statement_timeout = '8s';`.
4. **`SUPABASE_SERVICE_ROLE_KEY` ротувався, але у Vercel ENV
   старий**. Vercel → Settings → Environment Variables → `Edit` →
   redeploy. Симптом — у логу PostgREST `JWSError`/`401`.
5. **Schema drift** — `v_login_users` зламана/відсутня. Перевірити
   напряму у Studio:
   ```sql
   set role service_role;
   select count(*) from feedbackgb.v_login_users;
   reset role;
   ```
   Якщо помилка `relation does not exist` — накатити міграції 3.1
   повторно (всі ідемпотентні).
6. **VPS лежить / диск повний** (для self-hosted): `df -h /` і
   `systemctl status docker`.

Перші три пункти покривають 90% інцидентів і всі лікуються без
деплою.

### 9.8 "Telegram preview все ще показує JWT"

Перевірити:

1. У `dailyReport.ts` має бути `<a href="https://<host>/api/r/photo/...">📷</a>`. Якщо все ще signed URL — пере-deploy.
2. `PHOTO_REDIRECT_BASE_URL` (або `VERCEL_*` envs) детектує живий host.
3. Старі повідомлення у чаті — НЕ переписуються. Свіжий звіт має бути чистий.

### 9.9 "Колонка «Звідки» в /admin/audit пуста для свіжих логінів"

**Симптоми:** свіжі рядки у `/admin/audit` показують `—` замість міста/країни;
`/admin/users` показує IP без локації; колонки `users.last_login_*` залишаються NULL.

**Перевірити:**

1. **Лог сервера** — шукати `[geoip] ipinfo non-2xx` (Vercel → Functions → Logs).
   - `status: 401` або `403` — токен `IPINFO_TOKEN` невалідний / відкликаний.
     Перевипустити на https://ipinfo.io/account/token (Rotate), вставити новий
     у Vercel env (Production + Preview), Redeploy.
   - `status: 429` — місячна квота 50k запитів вичерпана. Перевір на
     https://ipinfo.io/account → Usage. Поки нова квота не відкриється
     1-го числа місяця, можна:
       - тимчасово підняти план (платно), або
       - просто прийняти що `last_login_*` буде NULL до наступного місяця
         (бо все працює fail-open: відсутність гео ≠ блокування логіну).
   - `status: 5xx` — провайдер тимчасово лежить. Чекаємо, кеш помилок 5хв
     означає що ми спробуємо ще раз за 5хв.

2. **`IPINFO_TOKEN` взагалі не виставлений** — `lookupIp` повертає EMPTY,
   а на першому виклику після старту процесу пишеться один warning у логах:
   `[geoip] IPINFO_TOKEN unset — geo enrichment disabled`. У `vercel env ls`
   має бути `IPINFO_TOKEN` для Production + Preview. Якщо warning є, а
   значення в env є — перевір чи не закешувалась стара деплойка (Redeploy).

3. **IP клієнта приватний/CGNAT** — у логах перевір `audit_log.ip` для
   проблемного запиту. Якщо це 10.x / 192.168.x / 100.64-127.x / loopback —
   `lookupIp` пропускає його за дизайном (`isPrivateOrLocal`). Це НЕ баг.
   На self-hosted Supabase поза CDN-ом може траплятись що Next отримує
   приватну IP проксі замість справжньої — перевір `clientIp()` логіку
   в `src/lib/rateLimit.ts` і headers `x-forwarded-for` / `cf-connecting-ip`.

**Як вимкнути фічу повністю** (на випадок інциденту з провайдером):
прибрати `IPINFO_TOKEN` з Vercel envs і Redeploy. Login продовжуватиме
працювати — просто без гео-збагачення (fail-open за дизайном).

**Як прочистити кеш у пам'яті** (якщо отруєний транзієнтною помилкою):
зробити Redeploy. Кеш живе у пам'яті процесу, рестарт = повний flush.
Стандартний 24h TTL для успішних відповідей і 5хв для EMPTY означає
що помилки авто-самозцілюються за 5 хвилин навіть без рестарту.
