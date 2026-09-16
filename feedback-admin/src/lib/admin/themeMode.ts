/**
 * N1 — admin theme mode (light / dark / system), framework-free so it can
 * be read on the server (cookie) and in the browser (inline script +
 * AdminThemeProvider) without pulling in React or Next types here.
 */
export type AdminThemeMode = "system" | "light" | "dark";
export type ResolvedAdminTheme = "light" | "dark";

export const ADMIN_THEME_COOKIE = "admin-theme";
/** The attribute the no-flash inline script and AdminThemeProvider both
 * write to, on `<html>` (not `.admin-shell`) so it's set before that
 * element even exists in the DOM. Scoped to admin-only CSS selectors
 * (`html[data-admin-theme] .admin-shell`) — never read outside the
 * `.admin-shell` scope, so the seller Mini App's own `:root`/dark-media
 * styling (globals.css) is untouched. */
export const ADMIN_THEME_ATTR = "data-admin-theme";

export function isAdminThemeMode(value: string | undefined): value is AdminThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function resolveAdminTheme(
  mode: AdminThemeMode,
  prefersDark: boolean,
): ResolvedAdminTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** Inlined verbatim into a `<script>` tag by AdminThemeScript (N6) — must
 * stay dependency-free ES5-ish so it runs before any bundle loads. Reads
 * the cookie AdminThemeProvider writes on toggle, so a hard reload lands
 * on the same theme the user picked last, with no flash of the other one. */
export const ADMIN_THEME_INLINE_SCRIPT = `
(function () {
  try {
    var m = document.cookie.match(/(?:^|; )${ADMIN_THEME_COOKIE}=([^;]*)/);
    var mode = m ? decodeURIComponent(m[1]) : "system";
    if (mode !== "light" && mode !== "dark" && mode !== "system") mode = "system";
    var resolved = mode === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : mode;
    document.documentElement.setAttribute("${ADMIN_THEME_ATTR}", resolved);
  } catch (e) {}
})();
`;
