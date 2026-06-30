import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  type UserRole,
} from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { logAudit, uaFromRequest } from "@/lib/audit";
import { geoipToAuditMeta, geoipToUserUpdate, lookupIp } from "@/lib/geoip";

export const runtime = "nodejs";
const APP_SURFACE = "web_app";

interface UserRow {
  id: string;
  full_name: string;
  role: UserRole;
  store_id: number | null;
  display_label: string | null;
}

// Rate-limit: 10 attempts / 10 minutes / IP.
//
// Per-user lockout still lives in the DB (`users.locked_until`, populated
// after 10 wrong attempts via the legacy verify_pin path). The new
// PIN-only login flow can't increment failed_attempts on a wrong PIN
// because the wrong PIN doesn't identify a user — IP rate limit is the
// primary defence here.
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 10;

/**
 * POST /api/auth/login   { pin: "123456" }
 *
 * Accepts only a 6-digit PIN. Calls `feedbackgb.verify_pin_global(pin)`,
 * which returns the matching active user row (or null if no/multiple
 * matches). On success sets an httpOnly session cookie and returns the
 * user payload.
 *
 * Backwards-compat note: the request body intentionally tolerates a
 * stale `user_id` field (older clients still send it). The field is
 * ignored — the PIN alone identifies the user.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  let ipLimit;
  try {
    ipLimit = await rateLimit(`login:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  } catch (err) {
    console.error("Rate limiting failed on login route:", err);
    return NextResponse.json(
      { error: "Послуга тимчасово недоступна. Будь ласка, спробуйте пізніше." },
      { status: 503 }
    );
  }

  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: "Забагато спроб, спробуй за декілька хвилин." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(ipLimit.reset_ms / 1000)),
        },
      },
    );
  }

  let body: { pin?: string };
  try {
    body = (await req.json()) as { pin?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = (body.pin ?? "").trim();
  if (!/^\d{6}$/.test(pin)) {
    return NextResponse.json({ error: "PIN має бути 6 цифр" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend ще не налаштовано" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc("verify_pin_global", {
    p_pin: pin,
  });
  if (error) {
    // Never echo DB error text to the client.
    console.error("verify_pin_global rpc error", { code: error.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const user = (data ?? null) as UserRow | null;
  if (!user || !user.id) {
    // Failed-login branch intentionally does NOT call lookupIp:
    //   1. Wastes ipinfo quota during credential-stuffing attacks
    //      (high-cardinality source IPs blow through the cache).
    //   2. Adds avoidable latency to the 401 response path.
    //   3. The audit_log already records `ip` per event, so geo can
    //      always be back-filled later via a CRON join against
    //      `users.last_login_*` or a re-lookup if needed.
    //
    // We can't tell which user the wrong PIN belonged to — log the
    // attempt anonymously with the IP and remaining bucket count.
    await logAudit("auth.login.failure", {
      targetType: "session",
      ip,
      userAgent: uaFromRequest(req),
      meta: {
        app_surface: APP_SURFACE,
        ip_attempts_remaining: ipLimit.remaining,
      },
    });
    return NextResponse.json({ error: "Невірний PIN" }, { status: 401 });
  }

  const displayName = user.display_label ?? user.full_name;

  const token = await signSession({
    uid: user.id,
    full_name: displayName,
    role: user.role,
    store_id: user.store_id ?? null,
    iat: Date.now(),
  });

  // Resolve geo info for the audit log meta. Bounded by FETCH_TIMEOUT_MS
  // (~800ms) and never throws — failures degrade to "no geo" in the
  // audit entry, login still succeeds. Subsequent same-IP logins hit
  // the in-process cache so this is a one-API-call-per-day-per-IP cost.
  const geo = await lookupIp(ip).catch(() => null);
  const geoMeta = geo ? geoipToAuditMeta(geo) : null;

  // Persist last-login location for /admin/users. Only columns whose
  // new value is non-null are included, so a partial ipinfo response
  // (e.g. country='UA' but no city/asn/isp) does not null out
  // previously-stored richer data on the user row.
  const updatePayload = geo ? geoipToUserUpdate(geo) : null;

  // logAudit and the users.update are independent of each other and of
  // the cookie write. Run them concurrently so the user pays the cost
  // of the slower one, not the sum.
  const auditPromise = logAudit("auth.login.success", {
    actorUserId: user.id,
    targetType: "session",
    ip,
    userAgent: uaFromRequest(req),
    meta: {
      app_surface: APP_SURFACE,
      role: user.role,
      store_id: user.store_id,
      ...(geoMeta ? { geoip: geoMeta } : {}),
    },
  });
  const updatePromise = updatePayload
    ? supabase
        .from("users")
        .update(updatePayload)
        .eq("id", user.id)
        .then(({ error: upErr }) => {
          if (upErr) {
            console.error("[auth.login] last_login_* update failed", {
              code: upErr.code,
              message: upErr.message,
              fields: Object.keys(updatePayload),
            });
          }
        })
    : Promise.resolve();
  await Promise.all([auditPromise, updatePromise]);

  const res = NextResponse.json({
    ok: true,
    user: {
      uid: user.id,
      full_name: displayName,
      role: user.role,
      store_id: user.store_id,
    },
  });
  const isProd = process.env.NODE_ENV === "production";
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
