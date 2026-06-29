import posthog from "posthog-js";

/**
 * Stable, exhaustive list of every custom event we send to PostHog.
 *
 * Why a closed union? It guarantees that every call site uses a known
 * event name, so the PostHog dashboard never grows accidental "typo"
 * events from rogue tracking calls.
 */
export type AnalyticsEvent =
  // Authentication funnel
  | "login_pin_input_started"
  | "login_submit_click"
  | "login_success"
  | "login_failure"
  | "logout_click"
  // Home page (category picker)
  | "home_category_open"
  // Feedback creation funnel — sellers spend most time here
  | "feedback_form_started"
  | "feedback_product_picked"
  | "feedback_quantity_set"
  | "feedback_photo_attached"
  | "feedback_photo_removed"
  | "feedback_submit_click"
  | "feedback_submit_success"
  | "feedback_submit_failure"
  | "feedback_form_abandon"
  // Admin actions (Galya's own behaviour)
  | "admin_send_report_click"
  | "admin_mirror_drive_click"
  | "admin_users_open"
  | "admin_audit_open"
  | "admin_export_click";

/** Event payload shape — never include PII (PIN values, comment text, etc). */
export type AnalyticsProps = Record<string, string | number | boolean | null>;

/**
 * Fire a typed PostHog event. No-op when:
 *   * SSR (no `window`) — components calling this should generally be
 *     "use client" but this guard avoids accidents.
 *   * PostHog isn't initialised (NEXT_PUBLIC_POSTHOG_KEY missing).
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.capture(event, props);
}

/**
 * Associate the current browser session with a backend user UUID.
 * Call once at app boot (after /api/auth/me resolves) and immediately
 * after a successful login.
 */
export function identifyUser(
  uid: string,
  traits?: { full_name?: string; role?: string; store_id?: number | null },
): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.identify(uid, {
    full_name: traits?.full_name,
    role: traits?.role,
    store_id: traits?.store_id ?? null,
  });
}

/** Drop user association — call on logout. */
export function resetIdentity(): void {
  if (typeof window === "undefined") return;
  if (!posthog.__loaded) return;
  posthog.reset();
}
