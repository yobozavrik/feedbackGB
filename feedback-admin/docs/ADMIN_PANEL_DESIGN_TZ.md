# ТЗ для дизайнеров: редизайн админ-панели FeedbackGB

Дата: 2026-07-01  
Статус: рабочее ТЗ для дизайн-команды  
Область: только `feedback-admin`, маршруты `/admin/*`. Mini App для продавцов не входит в этот редизайн.

## 1. Контекст и цель

FeedbackGB - внутренняя CRM/admin-панель для обработки фидбека от продавцов: обращения, дефекты, идеи, проблемы поставок, комментарии, фото, пользователи, магазины, аудит, ручные служебные операции и аналитика.

Цель редизайна - сделать админку рабочим инструментом для ежедневной обработки обращений, а не набором отдельных страниц. Интерфейс должен помогать быстро понять:

- что просрочено и требует реакции;
- какие обращения новые, кому назначены и в каком статусе;
- где повторяются дефекты или проблемы по магазинам/товарам;
- кто из сотрудников активен, заблокирован, без PIN или давно не заходил;
- какие системные действия уже были выполнены и кем.

Техническая база уже задана: Next.js 14, Ant Design 5, `@ant-design/pro-components`, `@ant-design/plots`, Supabase, PostHog. Дизайн должен опираться на Ant Design Pro-паттерны: `ProLayout`, `PageContainer`, `ProTable`, `StatisticCard`, `ProDescriptions`, `Drawer`, `ModalForm`.

## 2. Общие принципы дизайна

1. Админка - плотный рабочий CRM-интерфейс. Не делать маркетинговый лендинг, hero-блоки, декоративные большие карточки или пустые визуальные секции.
2. Главная единица интерфейса - таблица + фильтры + деталь в drawer. Пользователь должен оставаться в контексте списка.
3. Важные статусы показывать цветом, текстом и иконкой/бейджем. Не полагаться только на цвет.
4. Все страницы должны иметь одинаковый каркас: sidebar, fixed header, breadcrumbs, `PageContainer`, заголовок, короткий подзаголовок, рабочая область.
5. В таблицах обязательны: сортировка, фильтры, density control, настройка колонок, pagination, empty state, loading state, error state.
6. Основной экран desktop-first, но планшет и мобильный viewport не должны ломаться. На мобильном sidebar превращается в drawer, таблицы скроллятся горизонтально, drawer занимает почти всю ширину.
7. Цвета - текущий теплый FeedbackGB-brand, но без перегруза розовым. Розовый только как primary/action/accent. Фоны - светлые нейтральные, таблицы - максимально читаемые.
8. Карточки использовать только для KPI, аналитических блоков, инструментов и framed detail sections. Не вкладывать карточки в карточки без необходимости.

## 3. Design tokens

Базовая палитра:

- Primary: `#e85a8a`
- Primary hover/strong: `#d54a78`
- Background: `#fdf8f3`
- Container: `#ffffff`
- Secondary surface: `#fbf3eb`
- Text primary: `#2b1b1b`
- Text secondary: `#5a4848`
- Text tertiary: `#8c7a7a`
- Success: `#16a34a`
- Warning: `#f4a261`
- Error: `#dc2626`

Требования:

- Радиусы: таблицы и кнопки 8-12 px, большие cards/drawers до 16 px. Не делать чрезмерно круглые элементы.
- Типографика: системный sans-serif, base 14 px. Заголовки страниц 20-24 px, заголовки карточек 14-16 px.
- Табличные числа и даты - tabular numeric.
- Высота стандартной кнопки 36 px; primary action всегда визуально один на секцию.
- Не использовать emoji как основной UI-иконографический язык в админке. Для action-кнопок использовать Ant Design icons.

## 4. Глобальный layout

### 4.1 Sidebar

Текущие пункты навигации:

1. `/admin` - Огляд / Обзор
2. `/admin/tasks` - Мои задачи
3. `/admin/analytics` - Аналитика кликов
4. `/admin/funnel` - Воронка
5. `/admin/stores` - Магазины
6. `/admin/users` - Сотрудники
7. `/admin/audit` - Журнал
8. `/admin/tools` - Инструменты
9. `/admin/settings` - Настройки

Требования:

- Sidebar шириной около 232 px на desktop.
- Активный пункт: заливка primary-50, текст primary-600, иконка в том же цвете.
- Для ролей `admin` скрываются super-admin sections: аналитика, воронка, аудит. В дизайне показать два состояния меню: admin и super_admin.
- Внизу sidebar: версия, статус Supabase, короткий service status. Не перегружать.

### 4.2 Header

Содержит:

- название продукта `Галя слухає`;
- breadcrumbs;
- текущий пользователь, роль, dropdown logout;
- action logout может быть иконкой/текстом, но не должен доминировать.

Состояния:

- desktop: полный header;
- tablet/mobile: sidebar drawer + compact user menu.

### 4.3 PageContainer

На каждой странице:

- title;
- subtitle одной строкой;
- optional extra actions справа;
- tabs/segmented controls только внутри страницы, если это реально рабочий режим.

## 5. Страница `/admin` - Обзор и общая лента

Назначение: главный рабочий экран администратора. Сначала показывает срочность и сигналы, затем общую ленту обращений.

### 5.1 KPI-блок

Текущие метрики:

- Просрочено `> SLA hours`
- За неделю
- Дефекты за неделю
- Активных магазинов
- Сегодня

Дизайн:

- Горизонтальная группа `StatisticCard`, 5 карточек на широком desktop, 2 колонки на tablet, 1 колонка на mobile.
- Карточка просрочки должна быть первой и визуально тревожной при `>0`.
- Delta vs прошлый период: маленький secondary text с arrow up/down.
- У дефектов рост - warning/error, снижение - success.

Состояния:

- нет данных: показывать `0` и нейтральное описание, не пустую карточку;
- ошибка загрузки: alert над KPI;
- Supabase не настроен: системный warning block.

### 5.2 Smart signals

Сейчас есть сигналы:

- зависшие обращения `new` старше 3 дней;
- повторяющийся дефект товара за 7 дней;
- одинаковый товар сегодня в нескольких магазинах.

Дизайн:

- Один компактный warning card над heatmap.
- Внутри - stacked alert rows.
- Каждый сигнал должен иметь severity, короткий заголовок, count, список затронутых магазинов/товаров.
- Список не должен раздувать страницу: при длинном списке нужен collapse / "показать все".

### 5.3 Heatmap активности

Текущий блок: день недели x час, последние 14 дней.

Дизайн:

- Небольшая аналитическая карточка, не главный график.
- Подпись: период и total events.
- Ось X часы, ось Y дни недели.
- Tooltip на ячейку.
- Легенда intensity: меньше -> больше.

### 5.4 Лента фидбека

Текущий компонент: `ProTable` + drawer detail.

Колонки:

- Время
- Категория
- Магазин
- Кто
- Назначено
- Резюме
- Статус
- Висит / aging
- Фото indicator

Toolbar:

- переключатель "Моя очередь";
- период: все / сегодня / неделя / месяц;
- CSV export;
- стандартные controls ProTable: density, fullscreen, columns.

Дизайн таблицы:

- Основной рабочий элемент страницы.
- Fixed left для времени, fixed/right только если нужно для actions.
- Summary column должна занимать гибкую ширину.
- Статусы: `new`, `in_progress`, `resolved`, `rejected`.
- Aging tags: warm/stale/overdue/critical с разной интенсивностью.
- Row click открывает drawer.

Drawer обращения:

- Header: категория + статус + дата.
- Верхняя metadata строка: магазин, автор, время.
- Product block, если есть `product_name`.
- Блок "Управление": status segmented, assignee select, кнопка "На себя", комментарий, save/reset.
- Детали fields: definition list.
- Фото: image preview с contain, без crop.
- Telegram: username/display/verified.
- Обсуждение: timeline/chat-like list + input send.

Обязательные состояния drawer:

- есть/нет фото;
- есть/нет product;
- есть/нет fields;
- комментариев нет;
- сохранение disabled, если нет изменений;
- saving/loading/error.

## 6. Страница `/admin/tasks` - Мои задачи

Назначение: фокусный рабочий список обращений, назначенных текущему администратору.

Содержимое:

- тот же компонент ленты, что на `/admin`;
- данные ограничены `assigned_to = currentAdminId`;
- "Моя очередь" не нужен как toggle, так как страница уже отфильтрована.

Дизайн:

- Не дублировать KPI dashboard.
- Вверху можно добавить компактный summary strip: всего моих задач, просрочено, в работе, новые.
- Таблица и drawer должны быть идентичны `/admin`, чтобы пользователь не учил второй интерфейс.

## 7. Страница `/admin/analytics` - Аналитика кликов

Доступ: только `super_admin`.

Назначение: анализ взаимодействий в Mini App через heatmap кликов.

Блоки:

1. Access denied state для не-super admin.
2. Фильтры: пользователь, экран Mini App.
3. KPI: сколько кликов загружено.
4. Phone mockup с heatmap canvas.
5. Таблица популярных элементов.
6. Справочный блок "как читать карту".

Дизайн:

- Фильтры сверху в одной card/toolbar.
- Phone mockup слева, аналитика справа на desktop.
- На tablet/mobile phone mockup сверху, таблица ниже.
- Макет телефона должен быть аккуратным, но вторичным: это аналитический инструмент, не промо-рендер.
- Цвет heatmap: от желтого/оранжевого до красного, прозрачность по плотности.

Улучшение для дизайна:

- Справочный текст сделать компактным collapsible/help tooltip, не занимать равный вес с данными.
- Добавить empty state: "нет кликов по выбранным фильтрам".

## 8. Страница `/admin/funnel` - Воронка

Доступ: только `super_admin`. Источник данных: PostHog.

Назначение: понять, где пользователи отваливаются от PIN-login до сохраненного фидбека.

Блоки:

1. Period segmented: 7 / 30 / 90 дней.
2. Refresh action.
3. Warning/error alert при частичной недоступности PostHog.
4. KPI cards: стартовали, дошли до конца, конверсия, потеряли.
5. Sankey-визуализация воронки.
6. Bar chart drop-off по шагам.
7. Heatmap drop-off по часу и дню недели.
8. Таблица "кто застрял прямо сейчас".
9. Last updated footer.

Дизайн:

- Верхняя строка управления должна быть sticky/видимой при входе на страницу.
- KPI cards перед графиками.
- Sankey - главный график, full width.
- Drop-off bar и heatmap - ниже, не конкурируют с Sankey.
- Таблица stuck users должна быть компактной, actionable: пользователь, последний шаг, когда.

Состояния:

- PostHog недоступен;
- данных нет;
- идет обновление периода;
- частичная ошибка, но часть данных есть.

## 9. Страница `/admin/stores` - Магазины

Назначение: каталог магазинов + активность по фидбеку и продавцам.

Основная таблица:

Колонки:

- Магазин: название, адрес, inactive tag.
- 30д: количество фидбеков за 30 дней + delta к предыдущим 30 дням.
- Дефекты.
- Идей.
- Топ-категория.
- Продавчинь: active / total.
- Последний фидбек.

Toolbar:

- hint о периодах: метрики 30 дней, окно данных 90 дней.
- стандартные настройки таблицы.

Drawer магазина:

1. Header: магазин + inactive state.
2. Address card: адрес, ссылка на Google Maps при наличии lat/lng.
3. KPI group: за 30 дней, дефекты, идеи, продавцы.
4. Line chart тренда за 30 дней.
5. Pie chart категорий.
6. Pie chart статусов.
7. Таблица топ-товаров.
8. List продавцов: активность, без PIN, ссылка на `/admin/users`.
9. Последние фидбеки с category/status tags и summary.

Дизайн:

- Drawer шириной до 720 px, на mobile full width.
- Графики в drawer должны быть читаемыми, без избыточных легенд.
- Топ-товары и последние фидбеки должны иметь compact table/list style.

## 10. Страница `/admin/users` - Сотрудники и доступы

Назначение: управление продавцами, админами, PIN, блокировками, активностью.

Текущая структура: segmented tabs.

### 10.1 Tab "Сотрудники"

Фокус: продавцы и их вклад в фидбек.

Требуемые колонки:

- ФИО.
- Отображаемое имя.
- Магазин.
- Состояние: active/locked/inactive/no_pin.
- Последний вход + geo hint.
- Категории фидбеков как compact tags.
- Всего фидбеков.
- Actions: activity, edit, pin.

Дизайн:

- Это должна быть рабочая таблица, не карточки сотрудников.
- Actions лучше иконками с tooltip, чтобы не расширять таблицу.
- Состояние пользователя должно быть видно без раскрытия.

### 10.2 Tab "Керування доступом"

Фокус: полный список users и CRUD/RBAC.

Колонки:

- ФИО.
- Отображаемое имя.
- Роль.
- Магазин.
- Состояние.
- Ошибок входа.
- Последний вход + geo.
- Активность.
- Действия.

Actions:

- Создать пользователя.
- Редактировать.
- Создать/изменить PIN.
- Разблокировать.
- Деактивировать/активировать.

Модальные формы:

- Create user: full_name, display_label, role, PIN, store_id если seller.
- Edit user: full_name, display_label, role, store_id если seller, is_active.
- Reset PIN: pin + confirm, предупреждение о безопасной передаче PIN.

Activity drawer:

- Для seller: timeline его фидбеков.
- Для admin/super_admin: audit activity с meta/diff.
- Empty/loading/error states обязательны.

RBAC:

- `admin` не управляет `super_admin`;
- `admin` управляет только seller;
- нельзя деактивировать себя;
- роль себе менять нельзя.

## 11. Страница `/admin/audit` - Журнал действий

Доступ: только `super_admin`.

Назначение: просмотреть последние 500 событий auth/feedback/admin/system.

Таблица:

- Час.
- Раздел.
- Действие + raw action code.
- Куда: web_app/admin_panel.
- Кто.
- Кому.
- Откуда: country/city/ISP/IP.

Filters:

- section;
- action;
- actor;
- surface.

Expandable row:

- user-agent;
- meta JSON;
- diff JSON.

Дизайн:

- Журнал должен быть плотным и техническим, но читаемым.
- Raw action code показывать моноширинным secondary text.
- JSON не должен ломать layout: monospace block, max width, wrap.
- Expand icon должен быть очевидным.

## 12. Страница `/admin/tools` - Инструменты

Назначение: ручные операции.

Блоки:

1. "Надіслати звіт у Telegram"
   - описание;
   - primary button;
   - confirmation popconfirm;
   - last result/error inline.
2. "Дзеркало фото у Drive"
   - описание;
   - primary button;
   - confirmation popconfirm;
   - result: copied / failed / skipped.
3. "Експорт фідбеків"
   - JSON button;
   - CSV button;
   - пояснение, что серверной фильтрации нет.

Дизайн:

- Это не dashboard, а панель операций. Максимум 2 cards в ряд.
- Опасные/необратимые действия должны иметь confirmation.
- После действия результат виден рядом с кнопкой.
- Если операция идет, кнопка loading и повторный запуск недоступен.

## 13. Страница `/admin/settings` - Настройки

Назначение: профиль, интеграции, cron/status, уведомления.

Блоки:

1. Профиль
   - имя;
   - роль;
   - магазин;
   - PIN status;
   - последний вход;
   - кнопка изменить/установить PIN.
2. Интеграции
   - Supabase;
   - Telegram Bot;
   - Telegram Chat ID;
   - Google Drive folder;
   - Google Drive service account;
   - CRON_SECRET;
   - SESSION_SECRET.
3. Щоденний звіт у Telegram
   - cron schedule в Киевском времени;
   - ссылка "запустить вручную";
   - последний ручной запуск.
4. Дзеркало в Google Drive
   - описание idempotent behavior;
   - ссылка в tools;
   - последний ручной запуск.
5. Звуковые и push-уведомления
   - switch sound;
   - switch browser push;
   - permission denied state.

Дизайн:

- 2 колонки на desktop, 1 колонка на mobile.
- Интеграции показывают только "ok / не задано"; секреты не показывать.
- Настройки должны быть спокойными, без красного если нет критического сбоя.

## 14. Общие состояния, которые дизайнеры должны отдать

Для каждой страницы:

- normal with data;
- empty;
- loading/skeleton;
- API error;
- access denied;
- mobile layout;
- long text overflow;
- narrow table viewport;
- drawer open;
- modal open;
- destructive confirmation;
- success toast;
- error toast.

Для таблиц:

- default density;
- compact density;
- filtered state;
- sorted state;
- no rows after filter;
- row hover;
- selected/active row если применимо.

Для форм:

- validation error;
- submitting;
- disabled action;
- success close;
- network error.

## 15. Deliverables от дизайн-команды

Минимальный набор макетов:

1. Desktop 1440 px: все 9 страниц.
2. Tablet 768 px: `/admin`, `/admin/users`, `/admin/stores`.
3. Mobile 390 px: sidebar drawer, `/admin`, feedback drawer, users modal.
4. Component sheet:
   - KPI card;
   - signal alert row;
   - status tags;
   - aging tags;
   - ProTable toolbar;
   - detail drawer sections;
   - modal forms;
   - empty/error/access denied states.
5. Token sheet:
   - colors;
   - typography;
   - spacing;
   - radii;
   - shadows;
   - chart colors.

Формат передачи:

- Figma file с named frames по маршрутам.
- Все reusable элементы - components/variants.
- Для каждого экрана указать data assumptions: какие значения показаны, какой state.
- Не использовать fake-функции, которых нет в текущем коде, без отдельной пометки `future`.

## 16. Ограничения

- Не менять бизнес-логику, роли, API и Supabase-схему ради визуального редизайна.
- Не добавлять публичные marketing pages.
- Не смешивать Mini App дизайн с admin shell. Mini App - мобильный Telegram context, admin - desktop CRM context.
- Не показывать секреты интеграций.
- Не проектировать bulk delete или destructive workflows, которых нет в продукте.
- Не добавлять новый RBAC matrix сверх текущих ролей `admin` и `super_admin`.

## 17. Acceptance criteria

Дизайн считается готовым, если:

- по каждому маршруту `/admin/*` есть макет и состояния;
- дизайнерские компоненты соответствуют Ant Design Pro-паттернам, которые уже есть в коде;
- все таблицы помещаются в desktop layout и имеют понятное mobile/tablet поведение;
- статусы, роли, ошибки, пустые состояния и ограничения доступа явно показаны;
- drawer/modal flows покрыты для фидбека, магазина, пользователя, PIN и активности;
- нет противоречий с текущими данными: `feedback_feed`, `users`, `v_stores`, `v_audit_log`, PostHog funnel/interactions;
- визуальный язык остается FeedbackGB, но интерфейс читается как профессиональная CRM/admin-панель.
