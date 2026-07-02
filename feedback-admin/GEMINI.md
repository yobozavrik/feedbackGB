# 💖 Галя слухає — FeedbackGB | Project Context (Admin Panel)

This document serves as the primary instructional context for AI agents working on the **feedback-admin** package.

## 🌟 Project Overview
**FeedbackGB** is an internal feedback system for the "Галя Балувана" chain. This package is the management dashboard for administrators and supervisors.

The repository is a monorepo with **two independent Next.js apps deployed as separate Vercel projects**:
- `feedback-admin/` (this package): the management dashboard (Ant Design Pro).
- `feedback-app/`: the Telegram Mini App for sellers. See its own `GEMINI.md`.

### Core Stack
- **Framework**: Next.js 14 (App Router, Node.js runtime)
- **Styling**: Ant Design 5 / ProComponents + Tailwind CSS
- **Backend**: Supabase (PostgreSQL `feedbackgb` schema, Storage, PIN-based Auth)
- **Integration**: Telegram Bot API (notifications, daily reports), Google Drive API (Mirroring)
- **Observability**: PostHog (Analytics), Audit Logs (DB Triggers)

---

## 🏗 Architecture & Key Components

### 1. Directory Structure
- `src/app/(admin)/`: The Management Dashboard. Uses Ant Design Pro for complex tables and charts.
- `src/app/api/`: API routes (Auth, Admin CRUD, Cron, Public Redirects). Feedback **submission** lives in `feedback-app`, not here.

### ⚠️ Shared code lives in `../shared/lib`
Most of `src/lib/` (`categories.ts`, `session.ts`, `rateLimit.ts`, `telegram.ts`, `dailyReport.ts`, `summary.ts`, `geoip.ts`, `cronAuth.ts`, `validation.ts`, `types.ts`, `posthog/*`, …) are thin `export *` stubs pointing at the **single implementation in the repo-level `shared/lib/`** — edit the shared file, never the stub. Shared files may import `@/lib/supabase`; the alias resolves to the compiling app's own copy.

Still deliberate **per-app copies** (they import packages from the app's own `node_modules`): `supabase.ts`, `analytics.ts`, plus `middleware.ts` and the auth/cron/photo API routes. When changing one of those, apply the identical change to the sibling app — the pre-commit drift check (`scripts/check-shared-drift.sh`) fails the commit otherwise.

### 2. Domain & Logic (`src/lib/`)
Follows a "Clean Architecture" inspired approach:
- **Entities**: `categories.ts` (Source of truth for feedback types), `sla.ts` (SLA/Aging logic), `summary.ts` (Human-readable summaries).
- **Use Cases**: `dailyReport.ts` (Telegram reports), `driveMirror.ts` (Syncing photos to Drive), `session.ts` (Auth).
- **Adapters**: `supabase.ts`, `googleDrive.ts`, `telegram.ts`, `geoip.ts`.

### 3. Data Model & Security
- **Schema**: Isolated `feedbackgb` schema in Supabase.
- **Auth**: PIN-only authentication for users. Sessions are stateless HMAC cookies.
- **Audit**: Database triggers (`feedback_audit`) log all changes to the `audit_log` table.
- **GeoIP**: Login attempts are enriched with GeoIP data (see `src/lib/geoip.ts`).

---

## 🛠 Building and Running

### Commands
- `npm run dev`: Start development server.
- `npm run build`: Production build.
- `npm run lint`: ESLint check.
- `npm run typecheck`: TypeScript verification.
- `npm run scan:secrets`: Scan history for leaked secrets (requires gitleaks).

### Environment
Always ensure `.env.local` is populated from `.env.example`. Key variables include `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET`, and `GOOGLE_DRIVE_SA_KEY`.

---

## 📋 Development Conventions

### 1. Feedback Categories
`src/lib/categories.ts` is the **Single Source of Truth**. If you add/edit a category there:
1. Update the `CATEGORIES` array in TypeScript.
2. Update the seed data in `supabase/schema.sql`.
3. (Optional) Create a specific View in Supabase for the category.

### 2. Admin UI
The Admin interface uses `@ant-design/pro-components`.
- Use `ProTable` for data grids.
- Use `ProLayout` for the shell (sidebar configuration in `src/lib/admin/menu.tsx`).
- Themes and brand tokens are managed in `src/lib/admin/theme.ts`.

### 3. Documentation First
Refer to the `docs/` directory for deep dives:
- `docs/ARCHITECTURE.md`: C4 diagrams and layer mapping.
- `docs/DATA_MODEL.md`: ERD and database logic.
- `docs/api/openapi.yaml`: API specifications.

### 4. Security & Commits
- **Gitleaks**: A pre-commit hook is active. Do not bypass it.
- **PII**: Never log personally identifiable information or raw secrets.
- **HMAC**: Always validate `initData` from Telegram using the bot token.

---

## 📂 Key File Map
- `src/lib/categories.ts`: Feedback definitions.
- `src/lib/sla.ts`: Logic for "warm", "stale", and "overdue" feedback.
- `src/app/(admin)/admin/page.tsx`: Main admin dashboard.
- `src/app/api/admin/`: Admin CRUD endpoints (users, feedback status, comments).
- `src/lib/dailyReport.ts`: Telegram daily report (also triggered manually via `/api/admin/send-report-now`).
- `src/middleware.ts`: Auth gate and role-based routing.
- `supabase/`: SQL migrations and schema definitions.
