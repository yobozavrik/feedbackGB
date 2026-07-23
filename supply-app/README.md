# Галя: Цех і склад

Separate mobile-first application for production and warehouse employees.

It is deployed as its own Vercel project with Root Directory `supply-app`.
It supports both a normal mobile browser and Telegram Mini App embedding. It
does not share browser sessions or routes with `feedback-app` or
`feedback-admin`.

Implementation is gated by `docs/supply-app/` and the live CRM audit recorded
in `docs/supply-app/INTEGRATIONS.md`.

## Local run

One time, create a separate ignored local env file from the existing Admin
Supabase connection. The script generates a distinct `SUPPLY_SESSION_SECRET`:

```powershell
npm.cmd run bootstrap:local-env
npm.cmd run dev -- -p 3002
```

`POST /api/auth/pin` currently accepts only global `admin` and `super_admin`.
Supply-worker login remains blocked until the reviewed Supply migration and
app-access checks are applied.
