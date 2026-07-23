import { getServerSupabase } from "@/lib/supabase";

type SupplyAuditAction =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout";

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

/**
 * Extract a DB-safe client IP for an `inet` column. Takes the first hop of the
 * X-Forwarded-For chain, strips a `:port` suffix, and returns null for anything
 * that isn't a plausible IPv4/IPv6 literal — an invalid value would otherwise
 * make the whole audit insert fail and get silently swallowed.
 */
export function clientIp(request: Request): string | null {
  const raw =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "";
  if (!raw) return null;
  const v4 = raw.replace(/:\d+$/, ""); // strip :port (IPv4 only)
  if (IPV4.test(v4)) {
    return v4.split(".").every((o) => Number(o) <= 255) ? v4 : null;
  }
  if (raw.includes(":") && IPV6.test(raw)) return raw;
  return null;
}

export async function writeLoginAudit(
  action: SupplyAuditAction,
  request: Request,
  actorUserId?: string,
) {
  const supabase = getServerSupabase();
  if (!supabase) return;
  const ip = clientIp(request);
  const rawForwarded = request.headers.get("x-forwarded-for");
  const userAgent = request.headers.get("user-agent");
  const { error } = await supabase.from("audit_log").insert({
    action,
    // Repo convention: actor is the actor UUID, or "service_role" for
    // anonymous/system events. The app surface lives in meta, not in actor.
    actor: actorUserId ?? "service_role",
    actor_user_id: actorUserId ?? null,
    target_type: "supply_session",
    ip,
    user_agent: userAgent ? userAgent.slice(0, 500) : null,
    meta: {
      app_surface: "supply_app",
      ...(ip === null && rawForwarded ? { raw_forwarded_for: rawForwarded.slice(0, 200) } : {}),
    },
  });
  if (error) console.error("[supply-auth] audit write failed", { code: error.code });
}
