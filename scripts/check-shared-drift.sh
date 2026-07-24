#!/usr/bin/env sh
# Guard against drift between the duplicated "shared" files of the apps.
#
# feedback-app/, feedback-admin/ and supply-app/ are independent Vercel
# deployments. Two guards run:
#
#   1. COPY_FILES — files feedback-app and feedback-admin carry as byte-
#      identical copies (they import app-local packages, so they can't move to
#      shared/lib). History shows these drift (a constant-time CRON_SECRET fix
#      once landed in only one app), so any difference fails the commit.
#
#   2. PURE_SHARED_FILES — pure logic single-sourced in shared/lib. Any app
#      (including supply-app, which compiles shared/lib via externalDir) may
#      carry a copy, but it MUST be a thin `export *` re-export of shared/lib,
#      never a re-implementation. This catches the "edited the copy, not the
#      source" failure across all three apps.
#
# If you changed one COPY on purpose, apply the same change to the sibling app.
# If a file legitimately stops being shared, remove it from the list.
#
# Run from anywhere inside the repo; resolves paths from the repo root.

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1

COPY_FILES="
middleware.ts
app/api/auth/me/route.ts
app/api/cron/daily-report/route.ts
app/api/cron/mirror-to-drive/route.ts
app/api/r/photo/[id]/route.ts
app/api/stores/route.ts
components/PostHogProvider.tsx
lib/analytics.ts
lib/categories.ts
lib/cronAuth.ts
lib/dailyReport.ts
lib/driveMirror.ts
lib/geoip.ts
lib/googleDrive.ts
lib/notifications.ts
lib/posthog/api.ts
lib/posthog/funnel.ts
lib/posthog/types.ts
lib/rateLimit.ts
lib/session.ts
lib/sla.ts
lib/summary.ts
lib/supabase.ts
lib/telegram.ts
lib/types.ts
lib/validation.ts
lib/__tests__/cronAuth.test.ts
lib/__tests__/geoip.test.ts
lib/__tests__/rateLimit.test.ts
lib/__tests__/session.test.ts
lib/__tests__/telegram-escape.test.ts
"

status=0
for f in $COPY_FILES; do
  a="feedback-app/src/$f"
  b="feedback-admin/src/$f"
  if [ ! -f "$a" ] || [ ! -f "$b" ]; then
    echo "[shared-drift] MISSING copy: $f (expected in both apps)" >&2
    status=1
    continue
  fi
  if ! cmp -s "$a" "$b"; then
    echo "[shared-drift] DRIFT: $f differs between feedback-app and feedback-admin" >&2
    status=1
  fi
done

# Pure logic single-sourced in shared/lib: any app-local copy must be a thin
# re-export, never a re-implementation. Missing copies are fine (an app just
# doesn't use that module); a present copy that doesn't reference shared/lib is
# a re-implementation and fails.
PURE_SHARED_FILES="
lib/categories.ts
lib/types.ts
lib/validation.ts
lib/hrTopics.ts
lib/feedbackValidation.ts
lib/sla.ts
lib/summary.ts
lib/assignment.ts
lib/consumablesCatalog.ts
lib/consumablesStatusMeta.ts
lib/consumablesOrderError.ts
lib/consumablesOrder.ts
"
for f in $PURE_SHARED_FILES; do
  for app in feedback-app feedback-admin supply-app; do
    p="$app/src/$f"
    [ -f "$p" ] || continue
    if ! grep -q 'shared/lib/' "$p"; then
      echo "[shared-drift] RE-IMPL: $p is a local copy; must \`export * from shared/lib/...\`" >&2
      status=1
    fi
  done
done

# warehouseCrm.ts imports @supabase/supabase-js from the app's own node_modules,
# so it must stay per-app (like supabase.ts) — but the two seller/supply copies
# still need to be byte-identical. feedback-admin doesn't use it.
if [ -f feedback-app/src/lib/warehouseCrm.ts ] && [ -f supply-app/src/lib/warehouseCrm.ts ]; then
  if ! cmp -s feedback-app/src/lib/warehouseCrm.ts supply-app/src/lib/warehouseCrm.ts; then
    echo "[shared-drift] DRIFT: lib/warehouseCrm.ts differs between feedback-app and supply-app" >&2
    status=1
  fi
fi

if [ "$status" -ne 0 ]; then
  cat <<'EOF' >&2

[shared-drift] Shared files must stay byte-identical across both apps.
Sync the sibling copy (usually: cp feedback-app/src/<file> feedback-admin/src/<file>
or the other way around), or update scripts/check-shared-drift.sh if the
file is intentionally no longer shared.
EOF
fi

exit "$status"
