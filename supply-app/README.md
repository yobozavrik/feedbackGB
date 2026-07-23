# Галя: Цех і склад

Separate mobile-first application for production and warehouse employees.

It is deployed as its own Vercel project with Root Directory `supply-app`.
It supports both a normal mobile browser and Telegram Mini App embedding. It
does not share browser sessions or routes with `feedback-app` or
`feedback-admin`.

Implementation is gated by `docs/supply-app/` and the live CRM audit recorded
in `docs/supply-app/INTEGRATIONS.md`.
