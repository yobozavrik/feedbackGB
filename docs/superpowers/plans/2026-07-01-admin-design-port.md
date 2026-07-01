# Admin Design Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести дизайн из `FeedbackGB админ-панель редизайн/FeedbackGB Admin.dc.html` на всю текущую `feedback-admin` админку без изменения бизнес-логики, API, схемы БД и RBAC.

**Architecture:** Работа идет как визуальный порт поверх существующего Next.js App Router + Ant Design Pro admin shell. Источник истины по UX/визуалу - HTML-дизайн и скриншоты из папки `FeedbackGB админ-панель редизайн`; источник истины по данным и поведению - текущий код `feedback-admin`. Каждый этап завершает один проверяемый слой и блокирует переход дальше до приемки.

**Tech Stack:** Next.js 14, React 18, TypeScript, Ant Design 5, `@ant-design/pro-components`, `@ant-design/plots`, Tailwind globals, Supabase-backed server components.

---

## Restore Point

Восстановительная точка уже создана перед началом работ:

```powershell
git tag restore-before-admin-design-port-2026-07-01 1b56628
```

Откат к коду до переноса дизайна:

```powershell
git reset --hard restore-before-admin-design-port-2026-07-01
```

Важно: tag фиксирует tracked-код на текущем HEAD. Неотслеживаемые файлы (`FeedbackGB админ-панель редизайн/`, новые docs, `.scratch`, `.mimocode`) этим откатом не удаляются. Если нужен полный filesystem snapshot, его нужно делать отдельным zip/копией рабочей папки перед стартом реализации.

## Source Design Inventory

Дизайн-источник:

- `D:\feedback_gb\feedbackGB\FeedbackGB админ-панель редизайн\FeedbackGB Admin.dc.html`
- `D:\feedback_gb\feedbackGB\FeedbackGB админ-панель редизайн\support.js`
- `D:\feedback_gb\feedbackGB\FeedbackGB админ-панель редизайн\screenshots\01-feed.png`
- `D:\feedback_gb\feedbackGB\FeedbackGB админ-панель редизайн\screenshots\02-feed.png`
- `D:\feedback_gb\feedbackGB\FeedbackGB админ-панель редизайн\screenshots\drawer.png`

Ключевые дизайн-признаки из HTML:

- fixed left sidebar `236px`;
- header `58px`;
- warm cream skin tokens:
  - `--bg: #fdf8f3`
  - `--container: #fff`
  - `--surface: #fbf3eb`
  - `--surface2: #fdf4ec`
  - `--ink900: #2b1b1b`
  - `--ink700: #5a4848`
  - `--ink500: #8c7a7a`
  - `--ink300: #d8c8c8`
  - `--border: #f0e6dc`
  - `--border2: #f6ece2`
  - `--primary: #e85a8a`
  - `--primary-strong: #d54a78`
  - `--primary-50: #fde7ee`
  - `--success: #16a34a`
  - `--warning: #f4a261`
  - `--error: #dc2626`
  - `--radius: 12px`
  - `--radius-lg: 16px`
  - `--rowpad: 13px`
  - `--fz: 14px`
- compact nav links with active route background;
- KPI cards with small icon + large tabular value;
- smart signals card with nested warning/error/info alerts;
- custom compact table look;
- right drawer animation and sectioned detail view;
- explicit loading skeleton and access-denied states.

## File Map

Likely modified files:

- `feedback-admin/src/lib/admin/theme.ts` - Ant Design token mapping to design source.
- `feedback-admin/src/lib/admin/menu.tsx` - menu labels, badges metadata if needed.
- `feedback-admin/src/components/admin/AdminShell.tsx` - shell, sidebar/header layout behavior, role switch visibility, footer status.
- `feedback-admin/src/components/admin/AdminPageContainer.tsx` - page header spacing and common page wrapper.
- `feedback-admin/src/components/admin/DashboardKPI.tsx` - KPI card visual shape.
- `feedback-admin/src/components/admin/DashboardSignals.tsx` - smart signals visual shape.
- `feedback-admin/src/components/admin/DashboardHeatmap.tsx` - heatmap card visual shape.
- `feedback-admin/src/app/(admin)/admin/admin-client.tsx` - feed table and feedback drawer.
- `feedback-admin/src/app/(admin)/admin/tasks/page.tsx` - keep shared feed behavior.
- `feedback-admin/src/app/(admin)/admin/users/users-client.tsx` - users tables, modals, activity drawer visual alignment.
- `feedback-admin/src/app/(admin)/admin/stores/stores-client.tsx` - stores table and drawer visual alignment.
- `feedback-admin/src/app/(admin)/admin/funnel/funnel-client.tsx` - charts/cards visual alignment.
- `feedback-admin/src/app/(admin)/admin/analytics/analytics-client.tsx` - analytics page visual alignment.
- `feedback-admin/src/app/(admin)/admin/audit/audit-client.tsx` - audit table visual alignment.
- `feedback-admin/src/app/(admin)/admin/tools/tools-client.tsx` - tool cards and operation states.
- `feedback-admin/src/app/(admin)/admin/settings/settings-client.tsx` - settings cards and PIN modal.
- `feedback-admin/src/styles/globals.css` - only if small global admin classes are needed; prefer antd tokens and local styles first.

Do not modify:

- `feedback-admin/supabase/**`
- `feedback-admin/src/app/api/**` unless a compile issue reveals an existing UI contract mismatch.
- `feedback-app/**`
- auth/session/RBAC logic except read-only verification.

## Global Execution Rule

After each task:

1. Run listed verification commands.
2. Review visual screenshot for the target page.
3. Do not start the next task until acceptance criteria are met.
4. If acceptance fails, fix only the current task scope.
5. Commit after each accepted task with a narrow commit message.

If a task reveals data/API mismatch, stop and report exact evidence before changing behavior.

---

### Task 0: Baseline Capture and Safety

**Files:**
- Read: `feedback-admin/package.json`
- Read: `feedback-admin/src/lib/admin/theme.ts`
- Read: `FeedbackGB админ-панель редизайн/FeedbackGB Admin.dc.html`
- Create: `docs/admin-design-port/baseline.md`

- [ ] **Step 0.1: Record current git state**

Run:

```powershell
git status --short
git rev-parse HEAD
git tag --list restore-before-admin-design-port-2026-07-01
```

Expected:

- tag `restore-before-admin-design-port-2026-07-01` exists;
- no tracked admin source files are modified yet;
- untracked design/docs files may exist and must be listed in notes.

- [ ] **Step 0.2: Create baseline notes**

Create `docs/admin-design-port/baseline.md` with:

```markdown
# Admin Design Port Baseline

Date: 2026-07-01
Restore tag: restore-before-admin-design-port-2026-07-01
Restore commit: 1b56628

Design source:
- FeedbackGB админ-панель редизайн/FeedbackGB Admin.dc.html
- FeedbackGB админ-панель редизайн/screenshots/01-feed.png
- FeedbackGB админ-панель редизайн/screenshots/02-feed.png
- FeedbackGB админ-панель редизайн/screenshots/drawer.png

Protected scope:
- No Supabase schema changes.
- No API contract changes.
- No auth/RBAC behavior changes.
- No feedback-app changes.

Current untracked files:
[paste git status --short output]
```

- [ ] **Step 0.3: Start dev server for baseline screenshots**

Run from `feedback-admin`:

```powershell
npm.cmd run dev
```

Expected:

- local Next server starts;
- if port is busy, use the next available port and record it.

- [ ] **Step 0.4: Capture current screenshots**

Open current `/admin`, `/admin/users`, `/admin/stores`, `/admin/tools`, `/admin/settings` and save screenshots under:

```text
docs/admin-design-port/baseline-screens/
```

Use these only for comparison. Do not edit app code in this step.

- [ ] **Task 0 Acceptance**

Pass when:

- restore tag exists;
- baseline notes file exists;
- baseline screenshots exist or there is a documented blocker;
- no tracked source files changed except the baseline notes.

Stop gate: do not continue until Task 0 is accepted.

Commit:

```powershell
git add docs/admin-design-port/baseline.md docs/admin-design-port/baseline-screens
git commit -m "docs: record admin design port baseline"
```

---

### Task 1: Theme Tokens and Global Admin Skin

**Files:**
- Modify: `feedback-admin/src/lib/admin/theme.ts`
- Optional modify: `feedback-admin/src/styles/globals.css`

- [ ] **Step 1.1: Map source tokens into Ant Design**

Update `adminTheme` to match the design source values:

```ts
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: "#e85a8a",
    colorInfo: "#e85a8a",
    colorSuccess: "#16a34a",
    colorWarning: "#f4a261",
    colorError: "#dc2626",

    colorBgBase: "#fdf8f3",
    colorBgLayout: "#fdf8f3",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",

    colorText: "#2b1b1b",
    colorTextSecondary: "#5a4848",
    colorTextTertiary: "#8c7a7a",
    colorTextQuaternary: "#d8c8c8",

    colorBorder: "#f0e6dc",
    colorBorderSecondary: "#f6ece2",

    borderRadius: 12,
    borderRadiusLG: 16,
    borderRadiusSM: 8,

    fontFamily:
      "Inter, var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
    fontSize: 14,
  },
  components: {
    Layout: {
      bodyBg: "#fdf8f3",
      headerBg: "#ffffff",
      siderBg: "#ffffff",
      headerHeight: 58,
    },
    Menu: {
      itemSelectedBg: "#fde7ee",
      itemSelectedColor: "#d54a78",
      itemHoverBg: "#fbf3eb",
      itemBorderRadius: 9,
      itemHeight: 38,
    },
    Button: {
      borderRadius: 9,
      controlHeight: 36,
      fontWeight: 500,
      primaryShadow: "none",
    },
    Card: {
      borderRadiusLG: 16,
    },
    Table: {
      borderRadius: 12,
      headerBg: "#fbf3eb",
      headerColor: "#5a4848",
      rowHoverBg: "#fdf4ec",
    },
    Tag: {
      borderRadiusSM: 6,
    },
  },
};
```

- [ ] **Step 1.2: Add admin-only helper CSS only if needed**

If Ant Design tokens are insufficient, add small global classes prefixed with `.fb-admin-` only. Do not add broad selectors that affect Mini App.

Allowed examples:

```css
.fb-admin-shell {
  font-variant-numeric: normal;
}

.fb-admin-tnum {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 1.3: Verify compile**

Run:

```powershell
cd feedback-admin
npm.cmd run typecheck
```

Expected:

- PASS, or only pre-existing unrelated failures documented with exact file/line.

- [ ] **Step 1.4: Visual acceptance**

Check `/admin` in browser.

Pass when:

- background is warm cream;
- containers are white;
- primary pink matches source design;
- default blue Ant Design styling is not visible in shell/table controls;
- Mini App is not affected because no `feedback-app` files changed.

Stop gate: do not continue until Task 1 is accepted.

Commit:

```powershell
git add feedback-admin/src/lib/admin/theme.ts feedback-admin/src/styles/globals.css
git commit -m "style(admin): align theme tokens with design export"
```

---

### Task 2: Admin Shell Sidebar and Header

**Files:**
- Modify: `feedback-admin/src/components/admin/AdminShell.tsx`
- Modify: `feedback-admin/src/lib/admin/menu.tsx`

- [ ] **Step 2.1: Match sidebar structure**

Implement shell to visually match design:

- sider width `236`;
- logo square `30x30`, radius `9`, primary background, heart mark;
- title `Галя слухає`;
- subtitle `ADMIN · FeedbackGB`;
- nav gap and active states via Ant Design menu tokens;
- footer `v1 · Галя Балувана` + green status `Supabase OK · realtime`.

Keep current role filtering:

```ts
const isSuper = user.role === "super_admin";
const routes = adminRoute.routes.filter((r: any) => {
  if (
    r.path === "/admin/analytics" ||
    r.path === "/admin/funnel" ||
    r.path === "/admin/audit"
  ) {
    return isSuper;
  }
  return true;
});
```

- [ ] **Step 2.2: Match header**

Header must include:

- breadcrumbs on left;
- role segmented indicator `super_admin` / `admin` on right as visual role state only, not a permission-changing control;
- user initials circle;
- full name;
- role label;
- logout icon button.

If the design's role switch is interactive in the static HTML, do not make it change real RBAC. It can be a display-only segmented state or removed for ordinary admin.

- [ ] **Step 2.3: Verify RBAC menu**

Run app as:

- `super_admin`: analytics, funnel, audit visible.
- `admin`: analytics, funnel, audit hidden.

Acceptance:

- no hidden route is accessible through sidebar for `admin`;
- direct route access still blocked by existing page/middleware logic;
- logout still works.

- [ ] **Step 2.4: Visual comparison**

Compare `/admin` screenshot with `screenshots/01-feed.png`.

Pass when:

- sidebar width/spacing/logo/header visually match;
- active item background and text color match;
- header height and user cluster match;
- no hydration mismatch warning appears in browser console.

Stop gate: do not continue until Task 2 is accepted.

Commit:

```powershell
git add feedback-admin/src/components/admin/AdminShell.tsx feedback-admin/src/lib/admin/menu.tsx
git commit -m "style(admin): port redesigned shell and navigation"
```

---

### Task 3: Page Container and Shared Card/Table Primitives

**Files:**
- Modify: `feedback-admin/src/components/admin/AdminPageContainer.tsx`
- Create: `feedback-admin/src/components/admin/adminUi.tsx`
- Optional modify: `feedback-admin/src/styles/globals.css`

- [ ] **Step 3.1: Create small shared UI helpers**

Create `adminUi.tsx` with reusable pieces:

```tsx
import { Typography } from "antd";

const { Text } = Typography;

export function AdminMuted({ children }: { children: React.ReactNode }) {
  return (
    <Text type="secondary" style={{ fontSize: 12 }}>
      {children}
    </Text>
  );
}

export function AdminSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text strong style={{ fontSize: 14 }}>
      {children}
    </Text>
  );
}

export const adminCardStyle: React.CSSProperties = {
  border: "1px solid #f0e6dc",
  boxShadow: "0 1px 2px rgba(43,27,27,.04), 0 4px 16px rgba(43,27,27,.05)",
};

export const adminTableScroll = { x: 1180 };
```

Do not create a large custom design system. Keep helpers minimal.

- [ ] **Step 3.2: Align PageContainer spacing**

Update `AdminPageContainer` so page content starts like design:

- title margin close to source;
- subtitle color `#8c7a7a`;
- content padding visually consistent;
- no nested decorative cards around whole sections.

- [ ] **Step 3.3: Verify all pages render**

Open:

- `/admin`
- `/admin/tasks`
- `/admin/users`
- `/admin/stores`
- `/admin/audit` as super_admin
- `/admin/tools`
- `/admin/settings`

Acceptance:

- no page header visually breaks;
- no page has double-card wrapper;
- no content is clipped behind fixed header.

Stop gate: do not continue until Task 3 is accepted.

Commit:

```powershell
git add feedback-admin/src/components/admin/AdminPageContainer.tsx feedback-admin/src/components/admin/adminUi.tsx
git commit -m "style(admin): add shared admin visual primitives"
```

---

### Task 4: Overview KPI, Smart Signals, and Heatmap

**Files:**
- Modify: `feedback-admin/src/components/admin/DashboardKPI.tsx`
- Modify: `feedback-admin/src/components/admin/DashboardSignals.tsx`
- Modify: `feedback-admin/src/components/admin/DashboardHeatmap.tsx`
- Modify: `feedback-admin/src/app/(admin)/admin/page.tsx`

- [ ] **Step 4.1: Port KPI card layout**

Make KPI cards match static design:

- five cards in one row on desktop when width allows;
- each card `min-height: 148px` or close to source;
- small title, small icon top/right;
- large tabular value;
- description under value;
- overdue card red when count > 0;
- positive/negative deltas preserve current business meaning.

Do not change KPI formulas.

- [ ] **Step 4.2: Port smart signals**

Make `DashboardSignals` match design:

- outer card title `Розумні сигнали аналітики`;
- right-side meta `N активні · оновлено щойно`;
- stuck signal yellow;
- repeated defect red;
- cross-store duplicate info/blue;
- long lists wrap into compact tags.

Do not change signal formulas in this task.

- [ ] **Step 4.3: Port heatmap card**

Align:

- card title and meta line;
- cell size/spacing close to source;
- legend with five intensity swatches;
- horizontal overflow stays usable on narrow screens.

- [ ] **Step 4.4: Verify overview**

Run:

```powershell
cd feedback-admin
npm.cmd run typecheck
```

Open `/admin`.

Acceptance:

- KPI block visually matches source screenshot;
- signals block visually matches source screenshot;
- heatmap still renders real data;
- no formulas changed;
- no runtime console errors.

Stop gate: do not continue until Task 4 is accepted.

Commit:

```powershell
git add feedback-admin/src/components/admin/DashboardKPI.tsx feedback-admin/src/components/admin/DashboardSignals.tsx feedback-admin/src/components/admin/DashboardHeatmap.tsx feedback-admin/src/app/(admin)/admin/page.tsx
git commit -m "style(admin): port overview KPI signals and heatmap"
```

---

### Task 5: Feedback Feed Table

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/admin-client.tsx`
- Optional modify: `feedback-admin/src/app/(admin)/admin/tasks/page.tsx`

- [ ] **Step 5.1: Align ProTable toolbar**

Toolbar must match source:

- title `Стрічка фідбеку`;
- badge `{newLast7Days} нових за 7 днів`;
- my queue switch if applicable;
- period segmented;
- CSV button;
- ProTable settings still available.

- [ ] **Step 5.2: Align table columns**

Keep existing columns and filters:

- time;
- category;
- store;
- author;
- assignee;
- summary;
- status;
- aging;
- photo.

Visual changes only:

- compact row padding close to `--rowpad`;
- header background surface;
- active hover row;
- tags radius/size matching design;
- fixed horizontal scroll still works.

- [ ] **Step 5.3: Preserve behavior**

Verify:

- clicking a row opens drawer;
- category filter works;
- store filter works;
- status filter works;
- assignee filter works;
- aging sorter works;
- period segmented filters rows;
- CSV opens `/api/feedback?format=csv`;
- Realtime notification logic still compiles and does not duplicate subscriptions.

- [ ] **Step 5.4: Visual comparison**

Compare `/admin` feed section with `screenshots/01-feed.png` and `02-feed.png`.

Acceptance:

- feed table visual density matches design;
- horizontal scroll is present only when needed;
- no column text overlaps;
- table still shows real data.

Stop gate: do not continue until Task 5 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/admin-client.tsx feedback-admin/src/app/(admin)/admin/tasks/page.tsx
git commit -m "style(admin): port feedback feed table design"
```

---

### Task 6: Feedback Detail Drawer

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/admin-client.tsx`

- [ ] **Step 6.1: Align drawer shell**

Drawer must match source:

- right-side drawer width close to `560px` desktop;
- mobile width full viewport;
- title row category + status tags;
- date in header extra;
- section cards with borders/surfaces;
- animation remains native Ant Design or acceptable equivalent.

- [ ] **Step 6.2: Align drawer sections**

Sections:

- metadata line: store, author, time;
- selected product block;
- management block: status segmented, assignee select, "На себе", comment, save/reset;
- details definition list;
- photo preview;
- Telegram block;
- discussion/comments block.

Do not remove any existing field.

- [ ] **Step 6.3: Preserve lifecycle actions**

Verify:

- changing status saves through `PATCH /api/admin/feedback/[id]`;
- changing assignee saves;
- comment saves;
- reset reverts local draft;
- add discussion comment posts to `/api/admin/feedback/[id]/comments`;
- drawer closes after save as currently implemented.

- [ ] **Step 6.4: Visual comparison**

Compare open drawer with `screenshots/drawer.png`.

Acceptance:

- drawer hierarchy matches design;
- fields are readable;
- photo preview still opens;
- comments list and input remain usable;
- no React state update warnings from draft reset logic.

Stop gate: do not continue until Task 6 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/admin-client.tsx
git commit -m "style(admin): port feedback detail drawer design"
```

---

### Task 7: My Tasks Page

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/tasks/page.tsx`
- Reuse: `feedback-admin/src/app/(admin)/admin/admin-client.tsx`

- [ ] **Step 7.1: Add compact task summary**

Add a small summary strip above the shared feed table:

- total assigned to me;
- overdue assigned to me;
- new;
- in progress.

Use current `rows` data only. Do not add API queries.

- [ ] **Step 7.2: Verify shared feed**

Acceptance:

- table design matches `/admin`;
- drawer design matches `/admin`;
- "Моя черга" switch is hidden because page is already scoped;
- only rows assigned to current admin are shown.

Stop gate: do not continue until Task 7 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/tasks/page.tsx
git commit -m "style(admin): align my tasks page with redesigned feed"
```

---

### Task 8: Users and Access Management

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/users/users-client.tsx`

- [ ] **Step 8.1: Align tabs and tables**

Keep segmented tabs:

- `Співробітники`;
- `Керування доступом`.

Visual changes:

- segmented control matches design surface;
- seller table compact and readable;
- access table actions do not clip;
- icon-only quick actions have tooltips.

- [ ] **Step 8.2: Align modals**

Modal visual style:

- create user;
- edit user;
- reset PIN.

Preserve validations:

- full_name required;
- display_label required;
- role required;
- PIN exactly 6 digits;
- seller requires store.

- [ ] **Step 8.3: Align activity drawer**

Activity drawer:

- seller feedback timeline;
- admin audit timeline;
- meta/diff blocks with readable monospace;
- loading/empty states.

- [ ] **Step 8.4: RBAC verification**

Verify as `admin`:

- cannot edit super_admin;
- cannot see super_admin rows if current code filters them;
- cannot deactivate self;
- can manage sellers.

Verify as `super_admin`:

- can see admin/super_admin rows;
- role controls visible where currently allowed.

Acceptance:

- all previous user actions still work;
- table no longer clips action column;
- visual style matches admin shell.

Stop gate: do not continue until Task 8 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/users/users-client.tsx
git commit -m "style(admin): port users and access management design"
```

---

### Task 9: Stores Page and Store Drawer

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/stores/stores-client.tsx`

- [ ] **Step 9.1: Align stores table**

Visual changes only:

- table header/surface;
- store name/address hierarchy;
- metric tags;
- delta color;
- seller count;
- last feedback cell.

Keep all calculations unchanged.

- [ ] **Step 9.2: Align store drawer**

Drawer sections:

- address card + maps link;
- KPI group;
- trend chart;
- category pie;
- status pie;
- top products table;
- sellers list;
- recent feedback list.

Make chart containers match design surfaces and spacing.

- [ ] **Step 9.3: Verify data behavior**

Acceptance:

- clicking store opens drawer;
- maps link opens correct coordinates when present;
- top products still sorted by count;
- inactive seller/store tags visible;
- drawer width responsive behavior preserved.

Stop gate: do not continue until Task 9 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/stores/stores-client.tsx
git commit -m "style(admin): port stores table and drawer design"
```

---

### Task 10: Analytics and Funnel Pages

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/analytics/analytics-client.tsx`
- Modify: `feedback-admin/src/app/(admin)/admin/funnel/funnel-client.tsx`

- [ ] **Step 10.1: Align analytics page**

Visual changes:

- filter card;
- phone mockup area;
- top clicked elements card;
- compact help card/collapsible treatment.

Preserve:

- user filter;
- page filter;
- heatmap canvas draw logic;
- access denied at page level.

- [ ] **Step 10.2: Align funnel page**

Visual changes:

- period segmented + refresh row;
- KPI cards;
- Sankey card;
- drop-off bar card;
- heatmap card;
- stuck users table.

Preserve:

- PostHog fetch logic;
- period 7/30/90;
- partial-error alerts.

- [ ] **Step 10.3: Verify super_admin access**

Acceptance:

- both pages visible only to super_admin;
- admin sees access denied or route is hidden as currently designed;
- charts render without blank cards;
- loading/error states readable.

Stop gate: do not continue until Task 10 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/analytics/analytics-client.tsx feedback-admin/src/app/(admin)/admin/funnel/funnel-client.tsx
git commit -m "style(admin): port analytics and funnel pages"
```

---

### Task 11: Audit Page

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/audit/audit-client.tsx`

- [ ] **Step 11.1: Align audit table**

Visual changes:

- compact row padding;
- section tags;
- raw action code mono;
- actor/target cells;
- location cell;
- toolbar hint.

Preserve:

- filters;
- expandable row;
- sorting;
- 500-row dataset.

- [ ] **Step 11.2: Align expanded details**

Details blocks:

- User-Agent line;
- meta JSON;
- diff JSON.

Use readable monospace blocks with warm surface and no layout overflow.

- [ ] **Step 11.3: Verify access and expand behavior**

Acceptance:

- super_admin sees audit;
- admin does not see audit;
- expanding rows works;
- long JSON wraps and does not break table width.

Stop gate: do not continue until Task 11 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/audit/audit-client.tsx
git commit -m "style(admin): port audit log design"
```

---

### Task 12: Tools and Settings Pages

**Files:**
- Modify: `feedback-admin/src/app/(admin)/admin/tools/tools-client.tsx`
- Modify: `feedback-admin/src/app/(admin)/admin/settings/settings-client.tsx`

- [ ] **Step 12.1: Align tools cards**

Cards:

- send report;
- mirror to Drive;
- export feedbacks.

Preserve:

- Popconfirm before manual actions;
- loading state;
- inline result text;
- tracking calls;
- JSON/CSV hrefs.

- [ ] **Step 12.2: Align settings cards**

Cards:

- profile;
- integrations;
- daily Telegram report;
- Drive mirror;
- realtime sound/push notifications.

Preserve:

- PIN modal and validation;
- no secret values displayed;
- localStorage toggles for notifications;
- links to `/admin/tools` and `/admin/audit`.

- [ ] **Step 12.3: Verify operations**

Acceptance:

- buttons still call same endpoints;
- failed operations show error;
- successful operations show result;
- PIN change modal validates exactly 6 digits;
- notification toggles persist locally.

Stop gate: do not continue until Task 12 is accepted.

Commit:

```powershell
git add feedback-admin/src/app/(admin)/admin/tools/tools-client.tsx feedback-admin/src/app/(admin)/admin/settings/settings-client.tsx
git commit -m "style(admin): port tools and settings pages"
```

---

### Task 13: Responsive and Cross-Page QA

**Files:**
- Modify only files needed to fix issues found in QA.

- [ ] **Step 13.1: Desktop QA**

Viewport: `1440x900`.

Check:

- `/admin`
- `/admin/tasks`
- `/admin/users`
- `/admin/stores`
- `/admin/analytics`
- `/admin/funnel`
- `/admin/audit`
- `/admin/tools`
- `/admin/settings`

Acceptance:

- no overlapping text;
- no horizontal page scroll except table containers;
- sidebar/header fixed behavior correct;
- drawers open within viewport.

- [ ] **Step 13.2: Tablet QA**

Viewport: `768x1024`.

Check:

- sidebar mobile/drawer behavior;
- tables horizontal scroll;
- KPI wrapping;
- drawer width.

Acceptance:

- content remains usable;
- no invisible primary actions;
- no clipped modal footer.

- [ ] **Step 13.3: Mobile QA**

Viewport: `390x844`.

Check:

- nav drawer;
- `/admin`;
- feedback detail drawer;
- users modal;
- settings cards.

Acceptance:

- text readable;
- buttons tappable;
- drawer/modal can close;
- no content hidden behind viewport edges.

- [ ] **Step 13.4: Accessibility smoke**

Check:

- keyboard tab can reach primary actions;
- icon-only buttons have accessible labels/tooltips;
- color-coded statuses also have text;
- focus rings visible.

Stop gate: do not continue until Task 13 is accepted.

Commit:

```powershell
git add feedback-admin/src
git commit -m "fix(admin): resolve responsive issues after design port"
```

---

### Task 14: Final Verification

**Files:**
- Modify: `docs/admin-design-port/final-verification.md`

- [ ] **Step 14.1: Run static checks**

Run:

```powershell
cd feedback-admin
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Expected:

- PASS.

If any command fails:

- capture exact command;
- exact error;
- classify as introduced vs pre-existing;
- fix introduced errors before continuing.

- [ ] **Step 14.2: Run visual checks**

Capture final screenshots:

```text
docs/admin-design-port/final-screens/admin-overview.png
docs/admin-design-port/final-screens/admin-drawer.png
docs/admin-design-port/final-screens/admin-users.png
docs/admin-design-port/final-screens/admin-stores.png
docs/admin-design-port/final-screens/admin-tools.png
docs/admin-design-port/final-screens/admin-settings.png
```

Compare overview/drawer against:

```text
FeedbackGB админ-панель редизайн/screenshots/01-feed.png
FeedbackGB админ-панель редизайн/screenshots/drawer.png
```

- [ ] **Step 14.3: Write final verification note**

Create `docs/admin-design-port/final-verification.md`:

```markdown
# Admin Design Port Final Verification

Date: 2026-07-01
Restore tag: restore-before-admin-design-port-2026-07-01

Commands:
- npm.cmd run typecheck: record the exact result line; if it fails, paste the first failing file/line and error code.
- npm.cmd run test: record the exact result line; if it fails, paste the failing test name and assertion/error.
- npm.cmd run build: record the exact result line; if it fails, paste the first build error and stack frame.

Visual pages checked:
- /admin
- /admin/tasks
- /admin/users
- /admin/stores
- /admin/analytics
- /admin/funnel
- /admin/audit
- /admin/tools
- /admin/settings

RBAC checked:
- admin sidebar restrictions: record visible menu items and blocked pages checked.
- super_admin pages: record visible menu items and pages opened.

Known residual issues:
- Write "none" only after the checks above pass; otherwise list exact page, symptom, and owner task.
```

- [ ] **Task 14 Acceptance**

Pass when:

- all commands pass or failures are proven pre-existing and accepted;
- final screenshots saved;
- admin and super_admin role checks done;
- no API/schema/auth files changed unintentionally;
- restore instructions still valid.

Commit:

```powershell
git add docs/admin-design-port/final-verification.md docs/admin-design-port/final-screens
git commit -m "docs: verify admin design port"
```

---

## Full Acceptance Criteria

The design port is accepted only when all conditions are true:

- Restore tag exists: `restore-before-admin-design-port-2026-07-01`.
- No Supabase schema/migration changes.
- No API contract changes.
- No `feedback-app` changes.
- Existing auth and RBAC behavior preserved.
- All admin routes render:
  - `/admin`
  - `/admin/tasks`
  - `/admin/users`
  - `/admin/stores`
  - `/admin/analytics`
  - `/admin/funnel`
  - `/admin/audit`
  - `/admin/tools`
  - `/admin/settings`
- Design source visual language is applied:
  - warm cream background;
  - pink primary;
  - compact sidebar/header;
  - KPI cards;
  - smart signals;
  - compact feed table;
  - detail drawer;
  - consistent cards/tables/modals on users/stores/tools/settings.
- Desktop/tablet/mobile smoke checks pass.
- `npm.cmd run typecheck`, `npm.cmd run test`, and `npm.cmd run build` pass or non-introduced failures are documented and accepted.

## Execution Recommendation

Use one task per commit. Do not batch Tasks 1-12 together. The risky parts are:

1. `AdminShell` hydration behavior.
2. `admin-client.tsx` drawer state logic.
3. Users RBAC actions.
4. Chart pages with `@ant-design/plots`.

If one of those fails acceptance, revert only that task commit, not the whole branch.
