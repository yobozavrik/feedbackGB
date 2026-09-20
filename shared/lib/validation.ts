// Shared request-input validators. Pure, no I/O, no framework imports —
// safe to use from both API route handlers and (if ever needed) UI code.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Control characters (C0 range + DEL) that must never appear in a redirect
// target — they can smuggle a scheme past the leading-slash checks.
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f]/;

/**
 * Sanitize a post-login `?next=` redirect target so it can only point back
 * into this same origin. Anything else — an absolute URL, a protocol-relative
 * `//evil.com`, a `/\evil.com` backslash trick, or a value carrying control
 * characters — collapses to "/".
 *
 * Prevents an open redirect: the login page reads `next` from the query string
 * (fully attacker-controlled) and navigates to it after a successful PIN, so
 * an unsanitized value bounces the just-authenticated user to a phishing site.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  // Must be a single-slash, same-origin absolute path.
  if (raw[0] !== "/") return "/";
  // "//host" (protocol-relative) and "/\host" are treated as a host by browsers.
  if (raw[1] === "/" || raw[1] === "\\") return "/";
  if (CONTROL_CHARS_RE.test(raw)) return "/";
  return raw;
}
