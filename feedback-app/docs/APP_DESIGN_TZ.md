# ТЗ для дизайнеров: редизайн Telegram Mini App FeedbackGB

Дата: 2026-07-01  
Статус: рабочее ТЗ для дизайн-команды  
Область: только `feedback-app`, пользовательское приложение продавца. Админ-панель `/admin/*` не входит в этот документ.

## 1. Контекст и цель

FeedbackGB Mini App - мобильное приложение для продавцов внутри Telegram WebView. Основная задача: быстро отправить фидбек из магазина в менеджмент без долгого обучения, без сложной навигации и без риска потерять данные при плохой связи.

Текущий продукт уже содержит:

- PIN-login без выбора пользователя;
- главную страницу с категориями;
- отдельное меню товарных проблем;
- формы фидбека;
- товарный flow с выбором продукта, количеством, фото, комментарием и подтверждением;
- обычный flow с динамическими полями по категории;
- фото с клиентским сжатием;
- офлайн-очередь в IndexedDB;
- success page;
- Telegram WebApp initData, haptics, PostHog tracking.

Цель редизайна - сделать приложение еще проще и надежнее для продавца на смене: один большой понятный сценарий, крупные зоны нажатия, минимум текста, четкие состояния ошибки/офлайна/успеха, визуальный уровень коммерческого retail-продукта.

## 2. Целевая аудитория и UX-условия

Основной пользователь - продавец в магазине.

Условия использования:

- телефон в одной руке;
- работа на ходу, между покупателями;
- возможны перчатки, мокрые руки, плохое освещение;
- Telegram WebView, без привычного browser chrome;
- нестабильный интернет;
- пользователь не должен думать о технических терминах.

Практические выводы:

- основные кнопки не меньше 52 px по высоте;
- sticky CTA внизу;
- один главный action на экран;
- тексты короткие, разговорные, но без лишних объяснений;
- ошибки должны говорить, что сделать дальше;
- офлайн не должен выглядеть как авария, если данные сохранены.

## 3. Общий визуальный стиль

Текущая палитра приложения уже отличается от старого теплого бренда и ближе к professional blue:

- Background: `#f9f9ff`
- Container: `#ffffff`
- Secondary surface: `#f1f3ff`
- Text primary: `#141b2b`
- Text secondary: `#434654`
- Text muted: `#737686`
- Primary: `#1353d8`
- Primary strong: `#003fb1`
- Primary light: `#dbe1ff`
- Success: `#006e65`
- Danger: `#ba1a1a`

Требования:

- Сохранить clean B2B retail стиль: аккуратный, светлый, доверительный.
- Не делать интерфейс детским. Emoji сейчас используются как быстрые маркеры категорий, но в редизайне лучше заменить их на консистентный icon set.
- Category colors должны различать типы фидбека, но не превращать экран в разноцветную мозаику.
- Радиусы 8-12 px для controls/cards, bottom sheets могут иметь 24 px сверху.
- Шрифт: основной sans для текста, display-шрифт только для бренда/заголовков.
- Все текстовые элементы должны помещаться на 390 px viewport без наложений.

## 4. Глобальный mobile shell

Текущий layout:

- `max-w-md`;
- padding X 16/24;
- `min-h-dvh`;
- `TelegramProvider`;
- `OfflineSyncProvider`.

Требования к shell:

- Дизайн строится mobile-first под 360-430 px.
- Desktop/tablet показывают тот же mobile container по центру, не растягивать на весь экран.
- Учитывать safe area bottom для Telegram/iOS.
- Bottom sticky CTA не должен перекрывать поля формы; у формы должен быть нижний padding.
- Все bottom sheets блокируют body scroll и имеют backdrop.

## 5. Header

Текущий компонент: `Header`.

Содержит:

- back link, если передан;
- logo/wordmark `Галя слухає`;
- subtitle.

Требования:

- Sticky top header с blur/solid fallback.
- Back action должен быть крупным и очевидным, но вторичным.
- Логотип/wordmark должен быть стабильным на всех экранах.
- Subtitle не должен быть длиннее 1 строки; при длинном тексте - ellipsis или перенос максимум в 2 строки.
- Emoji heart/flower заменить на фирменный знак или icon.

Состояния:

- без back;
- с back;
- длинный subtitle;
- Telegram dark/system theme не должен ломать контраст.

## 6. Экран `/login` - PIN вход

Назначение: быстрый вход по 6-значному PIN без выбора магазина/пользователя.

Текущие элементы:

- брендовый знак;
- заголовок `Галя слухає`;
- текст `Введи свій PIN`;
- 6 точек PIN;
- цифровая клавиатура 3x4: 1-9, backspace, 0, OK;
- auto-submit после 6 цифры;
- ошибка с shake;
- busy state.

Дизайн:

- Центрированный экран, без лишней информации.
- Кнопки keypad минимум 64x64 px.
- Цифры должны быть читаемыми при плохом освещении.
- Backspace и OK визуально отличаются от цифр.
- PIN dots показывают progress и busy state.
- Ошибка занимает фиксированную высоту, чтобы keypad не прыгал.

Состояния:

- empty;
- 1-5 цифр;
- 6 цифр + auto-submit;
- busy/loading;
- неверный PIN;
- lockout/server error;
- network error;
- successful transition.

## 7. Главная `/` - выбор сценария

Назначение: пользователь выбирает, какой фидбек отправить.

Текущие блоки:

1. Header.
2. OfflineQueueBanner.
3. Hero speech-bubble с приветствием.
4. Заголовок `Обери категорію`.
5. CategoryGrid.
6. Footer: version + logout.

Требования к редизайну:

- Главная должна сразу показывать основные действия, без длинного промо-текста.
- Hero/speech block должен быть короче или заменен на компактный contextual greeting.
- Важнейшие действия должны быть крупными cards:
  - `Продукція магазину`;
  - `Заявка на ремонт`;
  - `Заявка на розхідні матеріали`.
- Вторичные категории - компактная сетка 2 колонки.
- Footer не должен конкурировать с действиями.

Category card requirements:

- иконка/category mark;
- title;
- short explanation;
- arrow/action affordance;
- pressed state;
- disabled/loading state не нужен, если category всегда доступна.

Главная должна помещать 2-3 главные карточки в первый экран на 390x844, но следующий контент должен быть виден.

## 8. `/products-menu` - меню товарных проблем

Назначение: выбрать один из товарных сценариев:

- `Мало товару`;
- `Багато товару`;
- `Брак товару`.

Требования:

- Это промежуточный экран, не полноценный каталог.
- Header с back.
- Короткий заголовок.
- 3 большие вертикальные карточки.
- Каждая карточка должна ясно объяснять разницу:
  - мало: клиент спрашивает, товара нет/мало;
  - много: залежалось/лишний запас;
  - брак: повреждено/просрочено/плохое качество.

Состояния:

- normal;
- active press;
- back to home.

## 9. `/feedback/[category]` - общий экран категории

Назначение: показать выбранную категорию и нужную форму.

Верхний блок:

- Header с back `На головну`;
- category summary card: icon, title, description.

Требования:

- Category summary card должна быть компактной. Главный экран здесь - форма, не описание.
- Category icon должна быть в одном стиле со всеми категориями.
- Описание не больше 2-3 строк.
- Для товарных категорий открывается `PriorityFeedbackForm`.
- Для остальных категорий открывается `FeedbackForm`.

## 10. PriorityFeedbackForm - товарный flow

Категории:

- `missing_item`;
- `overstock`;
- `defect`.

Цель flow: быстро выбрать товар из каталога, указать количество, добавить детали/фото, подтвердить и отправить.

Текущие блоки:

1. Identity/store row.
2. StoreSelect для admin, locked store chip для seller.
3. Product card.
4. Toggle `Нема в каталозі`.
5. ProductPicker bottom sheet.
6. QuantityStepper.
7. Comment.
8. PhotoInput.
9. Error block.
10. Sticky bottom CTA: back + next.
11. ConfirmSheet.
12. Offline saved state.

### 10.1 Identity/store row

Дизайн:

- Compact chips, не занимают много высоты.
- Продавец видит свое имя и магазин.
- Admin может выбрать магазин.

Состояния:

- seller с locked store;
- admin без магазина;
- admin с выбранным магазином;
- store loading/error.

### 10.2 Product selection

Дизайн:

- Блок `Який товар?` - главный блок формы.
- Empty state: большая dashed button `Обрати товар`.
- Selected state: thumbnail, product name, unit/category, action `Змінити`.
- Free-name mode: input вместо selected product, с явным способом вернуться к каталогу.

Требования:

- Название товара может быть длинным; обязательно truncate + full value в picker/details при возможности.
- Товарная карточка должна визуально отличаться от обычного input.
- Нельзя двигаться дальше без товара или free-name.

### 10.3 QuantityStepper

Дизайн:

- Большие `-` и `+`, центрированный input.
- Поддержка unit: шт, кг, порц. и т.д.
- Long-press repeat уже есть технически; визуально кнопки должны выглядеть как controls, не как декоративные плитки.

Состояния:

- min disabled;
- large number;
- decimal value;
- invalid input corrected on blur.

### 10.4 Comment + photo

Для `defect` комментарий обязателен, фото "очень желательно". Для `missing_item` и `overstock` комментарий и фото опциональны.

Дизайн:

- Комментарий textarea с понятным placeholder по категории.
- PhotoInput как отдельная attach-card.
- Для defect визуально подсказать, что фото помогает решить проблему быстрее, но не блокировать, если бизнес-логика не блокирует.

### 10.5 ConfirmSheet

Назначение: последняя проверка перед отправкой.

Содержит:

- title `Все правильно?`;
- строки: категория, товар, количество, магазин;
- buttons: `Ні, поправлю`, `Так, надіслати`.

Дизайн:

- Bottom sheet с drag handle.
- Summary читается за 2 секунды.
- Confirm button primary, cancel secondary.
- Loading state при отправке.

## 11. FeedbackForm - обычные категории

Категории:

- `supply_problem`;
- `store_idea`;
- `spotted_elsewhere`;
- `tech_issue`;
- `customer_voice`;
- `consumables_request`.

Текущие элементы:

- identity chip;
- locked store chip или StoreSelect;
- dev notice для `tech_issue` и `consumables_request`;
- динамические поля category.fields;
- PhotoInput если поле типа photo;
- error block;
- sticky CTA send;
- offline saved state;
- skeleton пока грузится `/api/auth/me`.

Требования:

- Форма должна выглядеть как один аккуратный card-flow.
- Поля группируются по смыслу, но не дробить на много шагов.
- Required marker должен быть понятным.
- Error должен указывать конкретное поле.
- Sticky CTA: back + send.
- Если категория в demo/development mode, notice должен быть спокойным warning, не выглядеть как поломка.

Поля по категориям:

- `supply_problem`: поставщик/товар, что случилось, фото.
- `store_idea`: суть идеи, детали, фото/эскиз.
- `spotted_elsewhere`: где увидела, что понравилось, фото.
- `tech_issue`: что сломано, срочность, детали, фото.
- `customer_voice`: тема, слова клиента, частота.
- `consumables_request`: список материалов, комментарий.

## 12. ProductPicker bottom sheet

Назначение: выбрать товар из POS-каталога.

Текущая структура:

- backdrop;
- bottom sheet почти на весь экран;
- drag handle;
- close/cancel;
- title;
- sticky search;
- popular chips `Часто питають у цьому магазині`;
- accordion категорий товаров;
- product rows with thumb, name, unit, usage count.

Дизайн:

- Search всегда виден сверху.
- В поиске placeholder с примерами.
- Popular chips должны быть полезными, но не занимать слишком много места.
- Accordion group rows должны иметь count и clear expand affordance.
- Product row tap target минимум 48 px.
- Thumbnail 40-48 px, object-cover.

Состояния:

- loading skeleton;
- loading with existing cache/list;
- API error;
- no search results;
- empty categories;
- long product names;
- no product photo;
- searching auto-expanded groups.

## 13. PhotoInput

Назначение: добавить 1-5 фото, сжать на клиенте, показать preview.

Текущие правила:

- max dimension 1600 px;
- max bytes около 900 KB;
- default maxPhotos 5;
- multiple upload;
- capture environment.

Дизайн:

- Empty state: camera icon, label, hint.
- Busy state: обработка фото.
- Added state: preview grid 2 columns, count `x/5`, remove button.
- Error state: максимум фото / не удалось обработать.
- Remove photo button должен быть понятным и достаточно крупным.

Не делать:

- Не скрывать, что можно добавить несколько фото.
- Не обрезать preview так, чтобы невозможно было понять фото.

## 14. OfflineQueueBanner и offline saved states

Назначение: приложение не теряет фидбек при плохой сети.

Текущие статусы очереди:

- pending;
- syncing;
- failed_auth;
- failed_validation.

Требования к баннеру:

- Если online и очередь пустая - не показывать.
- Если offline без очереди - показать спокойный info/warning: данные будут сохранены локально.
- Если очередь есть - collapsible banner с count.
- Если online и не syncing - кнопка `Синхронізувати`.
- В раскрытии: категория, статус, дата создания, магазин, error, retry/delete actions.

Дизайн:

- Офлайн-режим не должен пугать, если данные сохранены.
- Ошибки `failed_auth` и `failed_validation` должны быть визуально серьезнее pending.
- Delete action требует confirm.
- Retry action виден только там, где применимо.

Offline saved card:

- показывается после неуспешной отправки из-за сети, если запись сохранена локально;
- icon/status;
- короткое объяснение;
- primary button на главную.

## 15. `/thanks` - успех

Назначение: подтвердить пользователю, что фидбек отправлен.

Текущие элементы:

- success icon/category emoji;
- title `Записала!`;
- текст с category title;
- buttons: добавить еще один фидбек, на главную.

Требования:

- Успех должен быть эмоционально положительным, но коротким.
- Важно явно сказать: фидбек отправлен менеджменту.
- Primary action: добавить еще.
- Secondary action: на главную.
- Если category неизвестна - generic success.

Состояния:

- success with category;
- success without category;
- после offline saved success не использовать этот экран, там отдельный offline state.

## 16. StoreSelect

Назначение: выбор магазина для admin/super_admin. У seller магазин locked сервером.

Дизайн:

- Seller: read-only store chip.
- Admin: searchable input.
- Selected: chip + action `змінити`.
- Dropdown max height, 8 результатов.
- Empty search state нужен в макете.

Важно:

- Не делать выбор магазина обязательным для seller, он уже locked.
- Для admin без выбранного магазина форма не должна отправляться.

## 17. Категории и иконки

Текущие категории:

1. `missing_item` - Мало товару
2. `overstock` - Багато товару
3. `defect` - Брак товару
4. `supply_problem` - Проблема з постачанням
5. `store_idea` - Ідея для магазину
6. `spotted_elsewhere` - Підгледіла в іншому місці
7. `tech_issue` - Заявка на ремонт
8. `customer_voice` - Голос клієнта
9. `consumables_request` - Заявка на розхідні матеріали

Требования:

- Для каждой категории нужен единый icon style, желательно line/duotone.
- Иконки должны быть понятными без текста, но карточка всегда содержит текст.
- Цвет категории используется как слабый tint, не как яркая заливка всей карточки.
- `missing_item`, `overstock`, `defect` должны визуально восприниматься как один товарный блок.

## 18. Telegram WebView constraints

Дизайнеры должны учитывать:

- нет desktop browser chrome;
- экран может открываться в Telegram с разной высотой viewport;
- keyboard может перекрывать bottom CTA;
- Telegram/iOS safe area;
- back gesture может быть неочевиден, поэтому explicit back нужен;
- системные haptics есть, но не видны в Figma;
- Network/offline state реален.

В макетах обязательно показать:

- 390x844 iPhone-like viewport;
- 360x740 compact Android viewport;
- экран с открытой клавиатурой для формы;
- bottom sheet поверх текущего экрана;
- sticky CTA при скролле.

## 19. Общие состояния, которые нужно отдать

Для каждого основного экрана:

- normal;
- loading/skeleton;
- error;
- empty;
- offline;
- submitting;
- success;
- validation error;
- long text;
- compact viewport.

Для компонентов:

- category card: normal/pressed;
- input: empty/focused/filled/error/disabled;
- textarea: empty/filled/max length long text;
- button: normal/pressed/loading/disabled;
- bottom sheet: open/loading/error/empty;
- photo input: empty/busy/1 photo/5 photos/error;
- offline banner: offline empty queue/pending/syncing/failed_auth/failed_validation.

## 20. Deliverables от дизайн-команды

Минимальный набор Figma frames:

1. `/login`
   - empty PIN;
   - partial PIN;
   - error;
   - loading.
2. `/`
   - normal online;
   - offline banner;
   - queue expanded.
3. `/products-menu`
   - normal.
4. `/feedback/missing_item`
   - empty product;
   - product selected + quantity;
   - product picker open;
   - confirm sheet.
5. `/feedback/defect`
   - validation error;
   - photo added.
6. `/feedback/store_idea`
   - ordinary form example.
7. `/feedback/tech_issue`
   - demo-mode notice.
8. `/thanks`
   - success with category.
9. Offline saved state.
10. Component sheet:
   - header;
   - category card priority/secondary;
   - field input/textarea;
   - button variants;
   - chips;
   - quantity stepper;
   - product row;
   - product picker;
   - photo input;
   - confirm sheet;
   - offline banner statuses.

Формат:

- Figma file с named frames по routes/states.
- Components/variants для всех повторяемых элементов.
- Token sheet: colors, typography, spacing, shadows, radii, icon rules.
- Отдельно указать, какие элементы являются current implementation, а какие future proposal.

## 21. Ограничения

- Не менять бизнес-логику и API ради визуального редизайна.
- Не добавлять регистрацию, выбор пользователя, email/password или сложный onboarding.
- Не делать длинные инструкции внутри приложения.
- Не убирать offline flow.
- Не убирать подтверждение для товарного flow.
- Не проектировать корзину/склад/ERP-функции внутри Mini App.
- Не использовать тяжелые изображения как основу интерфейса: WebView должен быстро открываться.
- Не полагаться на hover: основной UX touch-only.

## 22. Acceptance criteria

Дизайн считается готовым, если:

- покрыты все текущие маршруты приложения: `/login`, `/`, `/products-menu`, `/feedback/[category]`, `/thanks`;
- покрыты оба form flows: priority product flow и ordinary dynamic form;
- есть макеты для offline queue и offline saved;
- product picker, photo input, confirm sheet и sticky CTA описаны как reusable components;
- все тексты читаются на 360 px ширине;
- основной сценарий можно пройти одной рукой;
- состояния ошибки говорят, что делать дальше;
- дизайн реализуем на текущем стеке Tailwind + Next.js без смены библиотек;
- нет противоречий с текущими категориями, полями и API.
