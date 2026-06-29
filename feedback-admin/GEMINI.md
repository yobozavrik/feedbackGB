# 💖 Галя слухає — FeedbackGB | Project Context

This document serves as the primary instructional context for Gemini CLI when working on the **FeedbackGB** project.

## 🌟 Project Overview
**FeedbackGB** is an internal Telegram Mini App for the "Галя Балувана" chain. It allows shop assistants to report inventory issues, ideas, and technical problems.

### Core Stack
- **Framework**: Next.js 14 (App Router, Node.js & Edge runtimes)
- **Styling**: Tailwind CSS (App) + Ant Design 5 / ProComponents (Admin)
- **Backend**: Supabase (PostgreSQL `feedbackgb` schema, Storage, PIN-based Auth)
- **Integration**: Telegram Web App SDK, Google Drive API (Mirroring)
- **Observability**: PostHog (Analytics), Audit Logs (DB Triggers)

---

## 🏗 Architecture & Key Components

### 1. Directory Structure (Route Groups)
The app is split into two primary experiences using Next.js Route Groups:
- `src/app/(app)/`: The Telegram Mini App (Sellers). Minimal dependencies, mobile-first.
- `src/app/(admin)/`: The Management Dashboard. Uses Ant Design Pro for complex tables and charts.
- `src/app/api/`: API routes (Auth, Feedback, Admin, Cron, Public Redirects).

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
- `src/app/api/feedback/route.ts`: Core feedback submission endpoint.
- `src/middleware.ts`: Auth gate and role-based routing.
- `supabase/`: SQL migrations and schema definitions.
