import { ADMIN_THEME_INLINE_SCRIPT } from "@/lib/admin/themeMode";

/**
 * N6 — a plain (non-`next/script`) inline script so it runs synchronously
 * while the HTML is still parsing, before `.admin-shell` paints. It sets
 * `data-admin-theme` on `<html>` straight from the cookie AdminThemeProvider
 * writes on toggle, so a hard reload lands on the same theme with no flash
 * of the other one. `next/script` `beforeInteractive` isn't an option here:
 * Next.js only allows that strategy in the root layout, and this one is
 * nested under `(admin)`.
 */
export function AdminThemeScript() {
  // eslint-disable-next-line react/no-danger -- static, dependency-free script; see themeMode.ts
  return <script dangerouslySetInnerHTML={{ __html: ADMIN_THEME_INLINE_SCRIPT }} />;
}
