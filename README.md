# 💖 Галя слухає — FeedbackGB (Монорепозиторій)

Цей репозиторій містить кодову базу проєкту **FeedbackGB** розділену на два незалежні автономні застосунки: клієнтський Mini App для продавчинь та Адмін-панель керування.

---

## 📂 Структура репозиторію

### 1. 📱 [Sellers App (feedback-app)](file:///d:/feedback_gb/feedbackGB/feedback-app)
Клієнтський **Telegram Mini App** для команди продавчинь «Галя Балувана».
- **Стек**: Next.js 14 (App Router), Tailwind CSS (пастельна палітра), `@supabase/supabase-js`, Telegram Web App SDK.
- **Опис**: Швидка форма надсилання фідбеку з фотофіксацією (стискається на клієнті), автоматичною авторизацією через Telegram WebApp HMAC, а також вибором товарів з меню POS.
- **Детальніше**: Див. [feedback-app/README.md](file:///d:/feedback_gb/feedbackGB/feedback-app/README.md).

### 2. 📊 [Admin Panel (feedback-admin)](file:///d:/feedback_gb/feedbackGB/feedback-admin)
Панель керування та аналітики для керівників та адміністраторів мережі.
- **Стек**: Next.js 14 (App Router), Ant Design (Pro Components), Tailwind CSS, `@supabase/supabase-js`.
- **Опис**: Стрічка відгуків, можливість залишати коментарі продавчиням (з повідомленням у Telegram), аналітика, вирви конверсії, лог аудиту дій, керування користувачами та генерація нових PIN-кодів.
- **Детальніше**: Див. [feedback-admin/README.md](file:///d:/feedback_gb/feedbackGB/feedback-admin/README.md).

---

## 🛠 Локальна розробка

Для запуску обох проєктів локально виконайте інсталяцію та налаштування у відповідних папках.

### Швидкий запуск клієнтського Mini App:
```bash
cd feedback-app
cp .env.example .env.local
# Заповніть змінні (Supabase URL, Anon Key, Telegram Token)
npm install
npm run dev
```

### Швидкий запуск Адмін-панелі:
```bash
cd feedback-admin
cp .env.example .env.local
# Заповніть змінні (Supabase URL, Service Role Key, SESSION_SECRET)
npm install
npm run dev
```

---

## 🚀 Деплой на Vercel

Обидва проєкти розгортаються на Vercel як **два окремих незалежних сайти**:

### Налаштування для Sellers App:
1. Імпортуйте репозиторій у Vercel.
2. Встановіть **Root Directory** як `feedback-app`.
3. Переконайтеся, що **Framework Preset** вибрано як **Next.js**.
4. Додайте необхідні змінні оточення (включаючи `SESSION_SECRET` ≥ 16 символів).

### Налаштування для Admin Panel:
1. Створіть новий проєкт у Vercel з цього ж репозиторію.
2. Встановіть **Root Directory** як `feedback-admin`.
3. Переконайтеся, що **Framework Preset** вибрано як **Next.js**.
4. Додайте змінні оточення (включаючи `SUPABASE_SERVICE_ROLE_KEY` та `SESSION_SECRET`).
