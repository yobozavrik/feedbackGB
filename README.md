# 💖 Галя слухає — FeedbackGB

Внутрішній **Telegram Mini App** для команди продавчинь Галя Балувана.
Швидкий, гарний і інтуїтивний інструмент зворотного зв'язку: продавчиня
відкриває кнопку в робочому чаті — й одразу може повідомити, чого не вистачає
на полицях, що клієнти просять, які є ідеї для покращення тощо.

## Можливості

- 🛒 6 категорій фідбеку: чого не вистачає, проблеми постачання, ідеї,
  «підгледіла десь», технічні поломки, голос клієнта.
- 📷 Фото з камери (стискається на клієнті до ≤1600 px JPEG).
- 🪪 Автоматична ідентифікація продавчині через Telegram WebApp (`initData`
  валідуємо HMAC-ом проти `TELEGRAM_BOT_TOKEN`).
- 🗄 Збереження в **Supabase Postgres** + **Storage** (бакет `feedback-photos`).
- 🤖 Поле `summary` — однорядковий читабельний опис для перегляду й подальшої
  векторизації / порівняння з фактичними залишками, продажами, списаннями.
- 📊 Сторінка `/admin` зі стрічкою фідбеку та експорт у JSON / CSV
  (`/api/feedback?format=csv`).

## Стек

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS — пастельна паланра (blush / peach / lavender / mint)
- `@supabase/supabase-js`
- Telegram Web App SDK (підключається через `<Script>` в layout)
- Деплой: Vercel (рекомендовано)

## Запуск локально

```bash
cp .env.example .env.local
# заповни значення

npm install
npm run dev
# відкрий http://localhost:3000
```

> Без Telegram-обгортки апка теж працює — поле користувача буде порожнім,
> ім'я не запишеться. Це зручно для розробки.

## Деплой

### 1. Supabase

1. Створи проєкт на [supabase.com](https://supabase.com).
2. У SQL Editor застосуй [`supabase/schema.sql`](supabase/schema.sql).
3. У Storage створи публічний бакет `feedback-photos`:
   ```sql
   insert into storage.buckets (id, name, public)
   values ('feedback-photos', 'feedback-photos', true)
   on conflict (id) do nothing;
   ```
4. Скопіюй у `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Settings → API → `service_role`)
   - `SESSION_SECRET` — згенеруй `openssl rand -hex 32`. У проді обов'язково,
     має відрізнятися від service role key.
5. Задай PIN-и для користувачів (адмін + продавчині) з SQL Editor:
   ```sql
   select id, full_name from feedbackgb.users order by full_name;
   select feedbackgb.set_user_pin('<uuid>', '<6-8 digits>');
   ```
   PIN-и в репо **не зберігаються**. Якщо ти оновлюєш стару інсталяцію —
   спочатку застосуй `supabase/002_security_hardening.sql`, він скине всі
   наявні pin_hash і закриє анонімний доступ до RPC-функцій.
6. Для v1 priority flow ("Мало / Багато / Брак") застосуй
   [`supabase/003_v1_priority_flow.sql`](supabase/003_v1_priority_flow.sql).
   Він додає дві нові категорії (`overstock`, `defect`), колонки
   `feedback.product_id` і `feedback.quantity`, а також вью
   `feedbackgb.v_products` + `v_popular_products` над каталогом POS
   (`categories.products`, `categories.categories`). Міграція
   ідемпотентна — безпечна для повторного запуску.

### 2. Telegram бот

1. У [@BotFather](https://t.me/BotFather): `/newbot` → отримай токен.
2. `/newapp` → прив'яжи Mini App до бота, вкажи URL продакшн-деплою
   (наприклад `https://feedback-gb.vercel.app`).
3. Поклади `TELEGRAM_BOT_TOKEN` у `.env.local` / Vercel env.
4. У бота додай команду / кнопку, що відкриває Mini App. Найпростіше —
   inline-кнопка в груповому чаті:
   ```python
   from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
   kb = InlineKeyboardMarkup([[
       InlineKeyboardButton("💖 Залишити фідбек",
           web_app=WebAppInfo(url="https://feedback-gb.vercel.app"))
   ]])
   ```

### 3. Vercel

```bash
vercel
# або підключи репо в дашборді
```

Не забудь додати всі змінні з `.env.example` у Vercel → Environment Variables.

## Як це використовувати для аналізу AI

Кожен запис у таблиці `feedback` містить:

| поле              | для чого                                           |
| ----------------- | -------------------------------------------------- |
| `summary`         | компактний рядок — ідеально для embedding-моделей  |
| `fields` (jsonb)  | структуровані відповіді — для агрегації/фільтрів   |
| `category`        | для зрізів і порівняння з продажами по категоріях  |
| `store`           | для крос-аналізу з факт.залишками й списаннями     |
| `tg_user_id`      | відстеження активності продавчинь                  |
| `photo_url`       | посилання на доказове фото                         |

Подальші кроки (поза цим MVP): додати pgvector-стовпець із embedding
від `summary`, нічний крон, який зчитує нові записи й співставляє з
викладкою / залишками з ERP `yobozavrik/erp-mes-v3`.

## Структура

```
src/
  app/
    page.tsx                 # головна — категорії
    feedback/[category]/...  # форма фідбеку (динамічна)
    thanks/                  # екран подяки
    admin/                   # стрічка фідбеку
    api/feedback/route.ts    # POST + GET (json/csv)
  components/
    TelegramProvider.tsx     # хук + контекст для WebApp SDK
    Header / CategoryGrid / FeedbackForm / PhotoInput / StoreSelect
  lib/
    categories.ts            # ↞ єдине джерело правди про категорії та поля
    telegram.ts              # валідація initData
    supabase.ts              # серверний клієнт
    summary.ts               # формування читабельного summary
supabase/schema.sql          # БД + RLS
```

## Розширення

Щоб додати нову категорію — допиши обʼєкт у
[`src/lib/categories.ts`](src/lib/categories.ts). Грід на головній,
динамічний роут і API підхопляться автоматично.

## Документація

Глибша документація живе у [`docs/`](docs/):

| Документ | Що там |
|---|---|
| [`docs/README.md`](docs/README.md) | Індекс, mermaid-діаграми. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | C4-діаграми (контекст / контейнери / компоненти), Clean Architecture mapping, ключові потоки, NFR, технічний борг. |
| [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) | ER-діаграма, таблиці, view, RPC, тригери, міграції. |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | OpenAPI 3.0.3 для всіх ендпоінтів `/api/*` (preview через `npx @redocly/cli preview-docs`). |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Каталог реалізованих фіч (Mini App / адмінка / lifecycle / SLA) і roadmap top-5. |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Setup Supabase / Telegram / Drive / Vercel, типові інциденти, ротація секретів. |
| [`docs/diagrams/`](docs/diagrams/) | Mermaid-діаграми як окремі файли (рендеряться у GitHub нативно або у https://mermaid.live). |
