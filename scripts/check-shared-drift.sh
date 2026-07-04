#!/usr/bin/env sh
# Guard against drift between the duplicated "shared" files of the two apps.
#
# feedback-app/ and feedback-admin/ are independent Vercel deployments that
# deliberately carry copies of the same lib/route files. History shows the
# copies drift (a constant-time CRON_SECRET fix once landed in only one app),
# so this script fails the commit when any file in the list below differs
# between the two packages.
#
# If you changed one copy on purpose, apply the same change to the sibling
# app. If a file legitimately stops being shared, remove it from the list.
#
# Run from anywhere inside the repo; resolves paths from the repo root.

ROOT="$(git rev-parse --show-toplevel)" || exit 1
cd "$ROOT" || exit 1

SHARED_FILES="
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
for f in $SHARED_FILES; do
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

if [ "$status" -ne 0 ]; then
  cat <<'EOF' >&2

[shared-drift] Shared files must stay byte-identical across both apps.
Sync the sibling copy (usually: cp feedback-app/src/<file> feedback-admin/src/<file>
or the other way around), or update scripts/check-shared-drift.sh if the
file is intentionally no longer shared.
EOF
fi

exit "$status"
