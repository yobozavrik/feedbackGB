# Admin Design Port Baseline

Date: 2026-07-01
Restore tag: restore-before-admin-design-port-2026-07-01
Restore commit: 1b5662843ad7f88ff76834fa1ee2dd2fe9df0230
Branch: devin/1777397957-feedback-mini-app

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

Current untracked files before code changes:
```text
?? .mimocode/
?? .scratch/
?? "FeedbackGB админ-панель редизайн.zip"
?? "FeedbackGB админ-панель редизайн/"
?? docs/
?? feedback-admin/docs/ADMIN_PANEL_DESIGN_TZ.md
?? feedback-app/.claude/
?? feedback-app/docs/APP_DESIGN_TZ.md
?? feedback-app/docs/design-brief-premium-retail.md
```

Environment notes:
- `feedback-admin/.env` and `.env.local` exist.
- `feedback-admin/node_modules` exists.
- PowerShell `Get-NetTCPConnection` failed with `Access denied`, so port availability must be checked by starting Next on an explicit port and probing HTTP.
- `npm.cmd run dev -- -p 3210` starts successfully in foreground: Next.js 14.2.35 reports `Ready` on `http://localhost:3210`.
- Background server start is blocked in the current shell environment:
  - `Start-Process` fails before project startup with duplicated `Path/PATH` environment key.
  - `cmd.exe /c start /B ...` did not leave a listening process on `:3210`.
  - Node child-process start from the browser automation runtime returned `spawn EINVAL`.
- Baseline screenshots are not captured yet. To capture real protected admin screens, we still need one of:
  - a stable long-running local dev server process for `feedback-admin`, and
  - a valid admin/super-admin browser session, or explicit approval to create a temporary local test session.

Verified admin route files:
- `/admin` -> `feedback-admin/src/app/(admin)/admin/page.tsx`
- `/admin/tasks` -> `feedback-admin/src/app/(admin)/admin/tasks/page.tsx`
- `/admin/analytics` -> `feedback-admin/src/app/(admin)/admin/analytics/page.tsx`
- `/admin/funnel` -> `feedback-admin/src/app/(admin)/admin/funnel/page.tsx`
- `/admin/stores` -> `feedback-admin/src/app/(admin)/admin/stores/page.tsx`
- `/admin/users` -> `feedback-admin/src/app/(admin)/admin/users/page.tsx`
- `/admin/audit` -> `feedback-admin/src/app/(admin)/admin/audit/page.tsx`
- `/admin/tools` -> `feedback-admin/src/app/(admin)/admin/tools/page.tsx`
- `/admin/settings` -> `feedback-admin/src/app/(admin)/admin/settings/page.tsx`

Verified shell/menu links:
- `feedback-admin/src/lib/admin/menu.tsx` declares all nine admin sidebar routes.
- `feedback-admin/src/components/admin/AdminShell.tsx` renders sidebar links through `menuItemRender`.
- `AdminShell` keeps RBAC filtering: `/admin/analytics`, `/admin/funnel`, and `/admin/audit` are visible only for `super_admin`.
