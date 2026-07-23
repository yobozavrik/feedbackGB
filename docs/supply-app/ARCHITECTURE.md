# Supply App architecture

```mermaid
flowchart LR
  Employee["Employee: browser or Telegram"] --> Supply["supply-app"]
  Admin["admin / super_admin"] --> AdminApp["feedback-admin /admin/supply"]
  Supply --> API["FeedbackGB server API"]
  AdminApp --> API
  API --> DB["Supabase: feedbackgb"]
  API --> Outbox["integration outbox"]
  Outbox --> CRM["CRM adapter: verified in Phase 1"]
```

`supply-app` is a separate root application with its own deployment, cookie
and signing secret. Browsers never receive CRM or Supabase service-role keys.
Only `admin` and `super_admin` access the admin application.

```mermaid
flowchart TB
  UI["Interfaces: Next routes and UI"] --> App["Application: use cases"]
  Infra["Infrastructure: DB, CRM, storage, workers"] --> App
  App --> Domain["Domain: documents, states, permissions"]
  App --> Ports["Ports: repositories and adapters"]
  Infra --> Ports
```

Domain code does not import Next.js, Supabase, Telegram or CRM clients.
