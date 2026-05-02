# API-довідник

Машино-читабельна специфікація: [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.0.3).

## Як подивитися як Swagger UI

### Швидко (без встановлення)

Відкрий [Swagger Editor](https://editor.swagger.io/) і скопіюй вміст
`openapi.yaml` у ліву панель — праворуч одразу буде інтерактивний UI.

### Локально через Redocly CLI

```bash
npx @redocly/cli preview-docs docs/api/openapi.yaml
# відкриється http://localhost:8080
```

Гаряче перевантажує при змінах у YAML.

### Локально через Swagger UI Docker

```bash
docker run --rm -p 8080:8080 \
  -v $(pwd)/docs/api:/spec \
  -e SWAGGER_JSON=/spec/openapi.yaml \
  swaggerapi/swagger-ui
# http://localhost:8080
```

## Як перевірити валідність

```bash
# через Redocly (lint, перевірка схеми, struct, security-defined тощо)
npx @redocly/cli lint docs/api/openapi.yaml
```

CI прохід: `Validation passed.` або просто warning-и без помилок.

## Швидкий огляд ендпоінтів

| Group | Endpoint | Auth |
|---|---|---|
| auth | `GET /api/auth/users` | open (60s ISR) |
| auth | `POST /api/auth/login` | open (rate-limited) |
| auth | `POST /api/auth/logout` | cookie |
| auth | `GET /api/auth/me` | cookie |
| feedback | `POST /api/feedback` | cookie (sellers + admins) |
| feedback | `GET /api/feedback?format=json\|csv` | cookie (admin only) |
| admin | `GET /api/admin/users` | cookie (admin) |
| admin | `POST /api/admin/users/{id}/pin` | cookie (admin) |
| admin | `POST /api/admin/users/{id}/unlock` | cookie (admin) |
| admin | `PATCH /api/admin/feedback/{id}` | cookie (admin) — lifecycle (status / assignee / comment) |
| admin | `POST /api/admin/send-report-now` | cookie (admin) |
| admin | `POST /api/admin/mirror-to-drive-now` | cookie (admin) |
| cron | `GET /api/cron/daily-report` | bearer `CRON_SECRET` або `x-vercel-cron: 1` |
| cron | `GET /api/cron/mirror-to-drive` | те саме |
| catalog | `GET /api/products` | cookie |
| catalog | `GET /api/products/categories` | open (60s ISR) |
| catalog | `GET /api/stores` | open (60s ISR) |
| redirects | `GET /api/r/photo/{id}` | open + rate-limit (60/хв/IP) |

Деталізовані схеми запитів і відповідей — у `openapi.yaml`. Архітектурний
огляд і рисунки (Mermaid) — у [`../ARCHITECTURE.md`](../ARCHITECTURE.md).
