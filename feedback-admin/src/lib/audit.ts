import { getServerSupabase } from "@/lib/supabase";

/**
 * Discrete event identifiers the application writes into `audit_log.action`.
 *
 * Convention: `<section>.<verb>` — e.g. `auth.login.success`. The Postgres
 * trigger on `feedback` writes `feedback.<verb>` independently, so values
 * here MUST NOT collide with the trigger-managed prefix (`feedback.*`).
 */
export type AuditAction =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "admin.user.pin_reset"
  | "admin.user.unlock"
  | "admin.send_report"
  | "admin.mirror_to_drive"
  | "admin.feedback.note"
  | "admin.user.create"
  | "admin.user.update"
  | "admin.user.deactivate"
  | "admin.user.activate"
  | "admin.direction.create"
  | "admin.direction.update"
  | "admin.direction.deactivate";

interface AuditOptions {
  /** UUID of the user who performed the action (null for failed logins). */
  actorUserId?: string | null;
  /** UUID of the user the action was about (e.g. PIN reset target). */
  targetUserId?: string | null;
  /** Free-form classification: 'user', 'feedback', 'session', etc. */
  targetType?: string | null;
  /** Linked feedback row, if applicable. */
  feedbackId?: string | null;
  /** Client IP, taken from `x-forwarded-for` / `req.ip`. */
  ip?: string | null;
  /** Browser UA string. */
  userAgent?: string | null;
  /** Additional structured context — kept JSON-serialisable and small. */
  meta?: Record<string, unknown> | null;
}

/**
 * Fire-and-forget audit write. Designed to never throw — if the database is
 * unreachable or the schema mismatches, we log to stderr and let the caller
 * continue. Audit failure must NEVER prevent a successful user action.
 */
export async function logAudit(
  action: AuditAction,
  opts: AuditOptions = {},
): Promise<void> {
  const supabase = getServerSupabase();
  if (!supabase) {
    console.warn("[audit] Supabase not configured; event dropped:", action);
    return;
  }

  const row = {
    action,
    actor:
      opts.actorUserId ??
      (opts.meta && typeof opts.meta === "object" && "actor_label" in opts.meta
        ? String((opts.meta as Record<string, unknown>).actor_label)
        : "service_role"),
    actor_user_id: opts.actorUserId ?? null,
    target_user_id: opts.targetUserId ?? null,
    target_type: opts.targetType ?? null,
    feedback_id: opts.feedbackId ?? null,
    ip: opts.ip ?? null,
    user_agent: opts.userAgent ?? null,
    meta: opts.meta ?? null,
  };

  const { error } = await supabase.from("audit_log").insert(row);
  if (error) {
    console.error("[audit] insert failed", { action, code: error.code });
  }
}

/**
 * Extract the originating client IP from a Request. Honours
 * `x-forwarded-for` (Vercel sets this), falls back to `x-real-ip`. Returns
 * the FIRST address in the XFF chain (the actual client, not the proxy).
 */
export function ipFromRequest(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xRealIp = req.headers.get("x-real-ip");
  if (xRealIp) return xRealIp.trim();
  return null;
}

/** Truncate a User-Agent to a sensible length before persisting. */
export function uaFromRequest(req: Request, maxLen = 500): string | null {
  const ua = req.headers.get("user-agent");
  if (!ua) return null;
  return ua.length > maxLen ? ua.slice(0, maxLen) : ua;
}
