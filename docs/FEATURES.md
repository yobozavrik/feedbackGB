# Каталог фіч і roadmap

> Звідки що взялось і що далі. Для архітектурного контексту дивись
> [`ARCHITECTURE.md`](./ARCHITECTURE.md), для контракту API —
> [`api/openapi.yaml`](./api/openapi.yaml), для схеми БД —
> [`DATA_MODEL.md`](./DATA_MODEL.md).

Скорочення в стовпці «Стан»:

- **shipped** — у `main`, відкатний, працює.
- **in-progress** — у роботі (PR відкритий або у плані найближчого циклу).
- **planned** — на черзі, готова постановка, ще не починали.
- **idea** — обговорювалось, треба ще валідувати потребу або скоуп.

---

## 1. Mini App для продавчинь

| Фіча | Стан | Звідки | Опис |
|---|---|---|---|
| 8 категорій фідбеку | shipped | `schema.sql` + `lib/categories.ts` | `missing_item`, `overstock`, `defect`, `supply_problem`, `store_idea`, `spotted_elsewhere`, `tech_issue`, `customer_voice` — кожна має свою форму. |
| Фото з компресією до ~1600 px JPEG | shipped | `components/PhotoInput.tsx` | Стискається на клієнті, передається як `data:` → upload у Storage `feedback-photos`. |
| Product picker із chips «Часто питають» | shipped | `006_audit_log_full.sql` (раніше) + `v_popular_products` | 7-денний топ товарів per-store піднімається нагору списку. |
| PIN-логін + lockout після 10 невдалих | shipped | `verify_pin()` RPC + `users.failed_attempts/locked_until` | Server-side bcrypt; rate-limit 10/10хв і 30/год/(IP+user). |
| Telegram WebApp `initData` HMAC | shipped | `lib/telegram.ts` | Заповнює `tg_*` поля у `feedback`, не довіряє клієнту. |
| Sticky `store_id` для seller | shipped | `/api/feedback` POST | Сервер перезаписує `store_id` з сесії, навіть якщо клієнт подав інший. |

---

## 2. Адмінка (`/admin/*`) — Ant Design Pro редизайн

Реалізовано як 9 послідовних PR-ів (PR #19…#28, #30) на основі плану в
[`ADMIN_REDESIGN.md`](./ADMIN_REDESIGN.md). Mini App не зачеплено: antd
ізольований у route group `(admin)`.

| Фіча | Стан | PR | Опис |
|---|---|---|---|
| ProLayout shell, 7 розділів у sider, route group `(admin)` | shipped | [#19](https://github.com/yobozavrik/feedbackGB/pull/19) | sidebar / topbar / breadcrumbs / dropdown «Вийти». |
| `/admin/users` — ProTable + ModalForm + Popconfirm | shipped | [#20](https://github.com/yobozavrik/feedbackGB/pull/20) | Reset PIN, розблокувати — без зміни бекенд-логіки. |
| `/admin/audit` — ProTable з фільтрами і expandable | shipped | [#21](https://github.com/yobozavrik/feedbackGB/pull/21) | Невдалі логіни підсвічуються, meta/diff JSON у розгортаному рядку. |
| Огляд: KPI cards + heatmap година×день | shipped | [#22](https://github.com/yobozavrik/feedbackGB/pull/22) | 4 картки (за тиждень / дефекти / магазини / сьогодні). |
| `/admin/tools` — Звіт / Drive-mirror / Експорт | shipped | [#23](https://github.com/yobozavrik/feedbackGB/pull/23) | Огляд переїхав з кнопок інструментів. |
| Стрічка фідбеку → ProTable + Drawer | shipped | [#24](https://github.com/yobozavrik/feedbackGB/pull/24) | Деталі у правому Drawer-і, фото з zoom-preview. |
| `/admin/analytics` — графіки на `@ant-design/plots` | shipped | [#25](https://github.com/yobozavrik/feedbackGB/pull/25) | Period 7/30/90, donut/pie/line/stacked column/bar. |
| `/admin/stores` — ProTable з аґреґатами + drill-down | shipped | [#27](https://github.com/yobozavrik/feedbackGB/pull/27) | Per-store: 30-дн KPI, тренд, топ-товари, продавчині, останні 10. |
| `/admin/settings` — профіль, зміна PIN, крон-статуси | shipped | [#28](https://github.com/yobozavrik/feedbackGB/pull/28) | 4 картки: Профіль / Інтеграції / Звіт / Mirror. |
| **Lifecycle**: status + assignee + audit-нотатка | shipped | [#29](https://github.com/yobozavrik/feedbackGB/pull/29) | Drawer-Segmented для status (`new` → `in_progress` → `resolved`/`rejected`); Select виконавця; вільний коментар. БД-тригер 007 пише `feedback.status_change` / `feedback.assign`. |
| **SLA / aging**: «Прострочено» KPI + колонка «Висить» | shipped | [#30](https://github.com/yobozavrik/feedbackGB/pull/30) | Пороги 4/24/72 год, кольорові tag-и, default-сортування «найстаріше відкрите зверху». Спільний модуль [`src/lib/sla.ts`](../src/lib/sla.ts). |

### Поточний стан адмінки

Sidebar: 7 активних розділів, нуль disabled.

```text
/admin
├── /admin              Огляд (KPI + heatmap + ProTable + Drawer)
├── /admin/analytics    Аналітика (charts)
├── /admin/stores       Магазини (метрики + drill-down)
├── /admin/users        Користувачі (CRUD-lite)
├── /admin/audit        Журнал (incl. lifecycle events)
├── /admin/tools        Інструменти (звіт / mirror / експорт)
└── /admin/settings     Профіль / інтеграції / крон
```

---

## 3. Інфраструктура / надійність

| Фіча | Стан | Звідки | Опис |
|---|---|---|---|
| Daily report у Telegram | shipped | `lib/dailyReport.ts` + `vercel.json` | 21:30 Київ, два UTC-розклади (DST). |
| Drive-mirror фото (резерв) | shipped | `lib/driveMirror.ts` + `004_photo_mirror.sql` | Idempotent UPSERT, до 5 повторів. |
| Photo redirect (`/api/r/photo/[id]`) | shipped | App Router route | UUID = capability, rate-limit 60/хв/IP. |
| Audit log (auth + admin + feedback CRUD) | shipped | `006_audit_log_full.sql` + `lib/audit.ts` | Тригер БД для `feedback.*`, `lib/audit.ts` для всього іншого. |
| RLS на всіх `feedbackgb.*`, BYPASSRLS у service_role | shipped | `002_security_hardening.sql` | Анон / authenticated не бачать нічого, сервер ходить як service_role. |

---

## 4. Roadmap (top-5)

> Порядок — за impact-ом, як я їх би робив. У дужках — оцінка часу
> (1 розробник, без cherry-pick стороннього функціоналу).

### #1. Realtime push для адмінки `[planned]` — ~1.5 дня

**Проблема.** Адмін відкриває `/admin` і бачить сьогоднішній фідбек, але
якщо новий приходить — треба F5 або refresh таблиці. SLA-aging теж не
оновлюється "live".

**Рішення.**

- Supabase Realtime subscription на таблицю `feedback`. Клієнтська
  сторона — `supabase.channel("feedback-changes")` на стороні
  `admin-client.tsx`.
- Toast + звук на `INSERT` категорії `defect`.
- Browser Notification API (з permission-prompt у `/admin/settings`)
  для адмінів, які залишили вкладку відкритою.
- Telegram-alert у приватний чат адміна (НЕ у groupreport-chat) на
  кожен `defect` або `feedback` без статусу > 24 год. Окремий env
  `TELEGRAM_ADMIN_CHAT_ID`.

**Що міняється.**

- БД: нічого (Supabase Realtime включається на таблиці у Studio).
- API: новий cron `/api/cron/aging-alert` (оператор вирішує — broadcast
  у Telegram).
- UI: subscription у `admin-client.tsx`; новий toggle у `/admin/settings`
  «Підписка на push».

**Знімає tech-debt:** «SLA-aging — клієнтське» (див. таблицю в
`ARCHITECTURE.md` §7).

### #2. Коментарі на feedback `[planned]` — ~1 день

**Проблема.** Коли адмін бере у роботу — продавчиня не дізнається
автоматично. Навпаки, в продавчині немає каналу уточнень («який саме
смак не привезли?»). Зараз єдиний канал — Telegram-репка вручну.

**Рішення.**

- Нова таблиця `feedbackgb.feedback_comments(id, feedback_id, author_id,
  body, created_at)`.
- У Drawer-і — стрічка повідомлень + textarea «додати нотатку».
- Якщо коментар написав адмін → бот шле репку у Telegram-чат продавчині
  (`tg_user_id` із `feedback`). Якщо продавчиня → toast у адмінці +
  можливо browser-notification (паралельно з #1).
- Виносить уже-наявний `admin.feedback.note` action з `audit_log` в
  окрему таблицю — це його справжнє місце.

**Що міняється.**

- БД: міграція `008_feedback_comments.sql`.
- API: `POST /api/admin/feedback/[id]/comments` + `GET` для стрічки.
- UI: окрема секція в Drawer-і.

### #3. Smart-сигнали на Огляді `[planned]` — ~2 дні

**Проблема.** Адмін бачить плоский список фідбеку. Кластери (3+ магазини
скаржаться на той самий товар за тиждень) — не видно. Аномалії (defect
rate стрибнув > 2× від медіани) — не видно. На Аналітиці дані для цього
є, але це reactive, не proactive.

**Рішення.** Окрема картка-band на Огляді з 0…N action items, типу:

- «3 магазини сьогодні скаржаться на «молоко 1л Простоквашино»» →
  кнопка «Закрити всі як `rejected` (дубль)».
- «Магазин «Продмаг №7» не дав жодного фідбеку 5 днів» (можливо щось
  зламано в Mini App там, або перестали користуватись).
- «Defect rate сьогодні × 2.4 від 7-денної медіани» → red-band.

**Що міняється.**

- БД: новий VIEW `v_signals` (або materialized view, якщо обходи дорогі).
- API: `GET /api/admin/signals` — повертає масив `{type, severity,
  payload}`.
- UI: новий компонент `DashboardSignals.tsx` — вище KPI cards.

### #4. PWA + push notification `[idea]` — ~1 день

**Проблема.** Адмін на телефоні / планшеті, поза комп'ютером. Заходити
на `/admin` через закладку — друже, але не нативно.

**Рішення.** PWA-маніфест + service worker. Push-сповіщення з #1, але
через Web Push API (потребує VAPID keys у env).

### #5. Перекидання залишків (transfer suggest) `[idea]` — ~3 дні

**Проблема.** «У магазині A — `missing_item` цього SKU. У магазині Б —
`overstock` цього ж SKU». Зараз ніщо не зв'язує ці два рядки.

**Рішення.**

- Cron-handler `/api/cron/transfer-suggest` — раз на день шукає такі
  пари, формує Telegram-пост у Inventory-чат «А просить молоко, Б має
  +5 пляшок, передати — / готово».
- Поки що — **тільки нотатка**, без інтеграції з ERP (це окремий
  major-feature). Підготовка до майбутнього API ERP.

---

## 5. Що **навмисно не** робимо

> Список, щоб не вертатись до тих самих ідей повторно.

| Ідея | Чому ні |
|---|---|
| Повний CRUD магазинів / товарів в адмінці | Це зона ERP, не FeedbackGB. Stores read-only через `v_stores`. |
| Реакції / лайки на фідбек | Гра для гри, нуль operational value. |
| Built-in dashboard як у Looker / Metabase | Аналітика на `@ant-design/plots` покриває 95% потреби; для решти достатньо CSV-експорту і зовнішнього BI. |
| Multi-language (EN / RU) | Команда україномовна, додавання i18n потягне за собою повний refactor усіх рядків заради нульового readers. |
| Web-push без Telegram-нотатки | Telegram все одно є primary канал — дублювати push-канали значить плодити noise. |

---

## 6. Як підтримувати цей документ

- Кожен PR із новою фічею — додає рядок у відповідну таблицю (стан →
  shipped + посилання на PR).
- Коли ідея переходить у planned/in-progress — рухай між таблицями
  (наприклад, з §4 у §2 при готовності).
- Roadmap top-5 — динамічний, але не виходити за 5 пунктів. Якщо
  з'являється шостий — піднімаємо у `[idea]`-розділ §5 або викидаємо
  один з топ-5.
