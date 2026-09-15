import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  type UserRole,
} from "@/lib/session";
import { clientIp, rateLimit, rateLimitStatus } from "@/lib/rateLimit";
import { logAudit, uaFromRequest } from "@/lib/audit";
import { geoipToAuditMeta, geoipToUserUpdate, lookupIp } from "@/lib/geoip";
import { pinLookup } from "../../../../../../shared/lib/pinLookup";

export const runtime = "nodejs";
const APP_SURFACE = "web_app";

interface UserRow {
  id: string;
  full_name: string;
  role: UserRole;
  store_id: number | null;
  display_label: string | null;
}

const IP_WINDOW_MS = 10 * 60_000;
const IP_FAILURE_LIMIT = 10;
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_FAILURE_LIMIT = 50;

async function failedLogin(req: Request, ip: string): Promise<NextResponse> {
  try {
    const [ipLimit, globalLimit] = await Promise.all([
      rateLimit(`login:failure:ip:${ip}`, IP_FAILURE_LIMIT, IP_WINDOW_MS),
      rateLimit("login:failure:global", GLOBAL_FAILURE_LIMIT, GLOBAL_WINDOW_MS),
    ]);
    if (!ipLimit.ok || !globalLimit.ok) {
      await logAudit("auth.login.failure", {
        targetType: "session", ip, userAgent: uaFromRequest(req),
        meta: { app_surface: APP_SURFACE, reason: !globalLimit.ok ? "global_throttle" : "ip_throttle" },
      });
      const retryMs = !globalLimit.ok ? globalLimit.reset_ms : ipLimit.reset_ms;
      return NextResponse.json({ error: "Забагато спроб, спробуй за декілька хвилин." }, { status: 429, headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) } });
    }
    const failures = IP_FAILURE_LIMIT - ipLimit.remaining;
    if (failures > 5) {
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(2_000, 100 * 2 ** (failures - 6))));
    }
    await logAudit("auth.login.failure", {
      targetType: "session", ip, userAgent: uaFromRequest(req),
      meta: { app_surface: APP_SURFACE, ip_failures: failures, ip_attempts_remaining: ipLimit.remaining },
    });
    return NextResponse.json({ error: "Невірний PIN" }, { status: 401 });
  } catch (err) {
    console.error("login failure protection unavailable", { request_id: req.headers.get("x-request-id"), error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Послуга тимчасово недоступна. Будь ласка, спробуйте пізніше." }, { status: 503 });
  }
}

async function preflightLoginLimit(req: Request, ip: string): Promise<NextResponse | null> {
  try {
    const [ipLimit, globalLimit] = await Promise.all([
      rateLimitStatus(`login:failure:ip:${ip}`, IP_FAILURE_LIMIT, IP_WINDOW_MS),
      rateLimitStatus("login:failure:global", GLOBAL_FAILURE_LIMIT, GLOBAL_WINDOW_MS),
    ]);
    if (ipLimit.ok && globalLimit.ok) return null;
    const retryMs = !globalLimit.ok ? globalLimit.reset_ms : ipLimit.reset_ms;
    return NextResponse.json({ error: "Забагато спроб, спробуй за декілька хвилин." }, { status: 429, headers: { "Retry-After": String(Math.ceil(retryMs / 1000)) } });
  } catch (err) {
    console.error("login limit preflight unavailable", { request_id: req.headers.get("x-request-id"), error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Послуга тимчасово недоступна. Будь ласка, спробуйте пізніше." }, { status: 503 });
  }
}

/**
 * POST /api/auth/login   { pin: "123456" }
 *
 * Accepts only a 6-digit PIN. It HMACs the PIN locally, then calls the
 * indexed verifier. The bcrypt hash remains the final credential check.
 *
 * Backwards-compat note: the request body intentionally tolerates a
 * stale `user_id` field (older clients still send it). The field is
 * ignored — the PIN alone identifies the user.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

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

  let lookup: string;
  try {
    lookup = pinLookup(pin);
  } catch {
    console.error("PIN lookup is not configured");
    return NextResponse.json({ error: "Помилка конфігурації сервера" }, { status: 503 });
  }

  const blocked = await preflightLoginLimit(req, ip);
  if (blocked) return blocked;

  let { data, error } = await supabase.rpc("verify_pin_lookup", {
    p_pin_lookup_hex: lookup,
    p_pin: pin,
  });
  // The fallback exists only for the explicitly enabled migration window.
  // Disable it after all active PINs have a lookup value: invalid PINs must
  // never be able to trigger the legacy full-table bcrypt scan afterwards.
  if (!data && !error && process.env.PIN_LOOKUP_LEGACY_FALLBACK === "true") {
    const legacy = await supabase.rpc("verify_pin_global", { p_pin: pin });
    data = legacy.data;
    error = legacy.error;
    if (data) {
      const backfill = await supabase.rpc("backfill_pin_lookup", {
        p_user_id: (data as UserRow).id,
        p_pin: pin,
        p_pin_lookup_hex: lookup,
      });
      if (backfill.error || !backfill.data) {
        console.error("PIN lookup backfill failed", { code: backfill.error?.code });
        return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
      }
    }
  }
  if (error) {
    // Never echo DB error text to the client.
    console.error("PIN verifier rpc error", { code: error.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const user = (data ?? null) as UserRow | null;
  if (!user || !user.id) {
    return failedLogin(req, ip);
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
