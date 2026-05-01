# Документація FeedbackGB

> Технічна довідка для розробників. Користувацькі гайди — в основному
> [`README.md`](../README.md).

## Як орієнтуватися

| Документ | Кому |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | "Хочу зрозуміти, як це все працює". C4-діаграми (контекст / контейнери / компоненти), Clean Architecture mapping, ключові потоки, NFR, де додавати нові фічі, технічний борг. |
| [`DATA_MODEL.md`](./DATA_MODEL.md) | "Хочу побачити, що в БД". Опис таблиць, view-ів, RPC-функцій, тригерів, індексів схеми `feedbackgb`. ER-діаграма. |
| [`api/openapi.yaml`](./api/openapi.yaml) | "Хочу contract API". OpenAPI 3.0.3 для всіх 16 ендпоінтів. Як переглянути — у [`api/README.md`](./api/README.md). |
| [`RUNBOOK.md`](./RUNBOOK.md) | "Хочу запустити / задеплоїти / полагодити". Setup Supabase, Telegram, Drive, Vercel; типові інциденти; ротація секретів. |
| [`ADMIN_REDESIGN.md`](./ADMIN_REDESIGN.md) | "Як виглядатиме нова адмінка". Пропозиція редизайну `/admin/*` у стилі Ant Design Pro — навігація, sidebar, сторінки, зв'язок з Supabase, поетапний план PR-ів. Бекенд-логіка не змінюється. |

## Mermaid-діаграми

Окремими файлами в [`diagrams/`](./diagrams/), плюс ембеджені у
`ARCHITECTURE.md` для зручності читання:

| Файл | Тип | Що показує |
|---|---|---|
| `01-c4-context.mmd` | C4 L1 | Користувачі (seller / admin) + зовнішні системи (Telegram, Supabase, ERP, Drive, PostHog) |
| `02-c4-container.mmd` | C4 L2 | Next.js client / Vercel (Edge middleware + Node.js routes + Cron) / Supabase / external APIs |
| `03-c4-component.mmd` | C4 L3 | Clean-architecture mapping: Frameworks → Adapters → Use Cases → Entities |
| `04-erd.mmd` | ER | Таблиці `feedbackgb` + зовнішні `categories.spots/.products` |
| `05-seq-feedback-create.mmd` | Sequence | Створення фідбеку: Mini App → API → Storage → DB |
| `06-seq-daily-report.mmd` | Sequence | Cron → buildAndSendDailyReport → Telegram |
| `07-seq-photo-redirect.mmd` | Sequence | Click `📷` у звіті → `/api/r/photo/<id>` → 302 на signed URL |
| `08-seq-drive-mirror.mmd` | Sequence | mirrorPendingPhotos → Storage download → Drive upload → photo_mirror UPSERT |

Перегляд: вставити вміст у https://mermaid.live або відкрити у GitHub —
рендерить нативно.

## Як підтримувати документацію

- При **зміні API** (новий endpoint, поле, статус) — оновити
  `api/openapi.yaml` + перевірити `npx @redocly/cli lint`.
- При **зміні схеми БД** (нова таблиця, view, RPC) — оновити
  `DATA_MODEL.md` + при потребі ER-діаграму у `diagrams/04-erd.mmd`.
- При **зміні потоку** (новий cron, новий runtime) — оновити відповідну
  sequence-діаграму у `diagrams/` + `ARCHITECTURE.md`.
- При **зміні env-ів** — оновити `RUNBOOK.md` секцію 2 + `.env.example`.

Документація — частина PR. Code-review має закривати "а в docs це
оновили?".
