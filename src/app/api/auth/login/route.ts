import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";

interface UserRow {
  id: string;
  full_name: string;
  role: "seller" | "admin";
  store_id: number | null;
}

// Rate-limits:
//   * 10 attempts / 10 minutes / IP (dumb-brute mitigation).
//   * 30 attempts / hour / (IP, user_id) window on top of the DB-level
//     lockout (verify_pin flips `locked_until` after 10 wrong PINs).
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 10;
const USER_WINDOW_MS = 60 * 60_000;
const USER_LIMIT = 30;

/**
 * POST /api/auth/login   { user_id: "<uuid>", pin: "123456" }
 * Verifies PIN for the selected user via SQL function `feedbackgb.verify_pin(uuid, text)`.
 * On success sets an httpOnly session cookie and returns the user payload.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);

  const ipLimit = rateLimit(`login:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
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

  let body: { user_id?: string; pin?: string };
  try {
    body = (await req.json()) as { user_id?: string; pin?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pin = (body.pin ?? "").trim();
  const userId = (body.user_id ?? "").trim();

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json(
      { error: "Оберіть користувача." },
      { status: 400 },
    );
  }
  if (!/^\d{4,8}$/.test(pin)) {
    return NextResponse.json({ error: "Невірний формат PIN" }, { status: 400 });
  }

  const userBucketKey = `login:user:${userId}:ip:${ip}`;
  const userLimit = rateLimit(userBucketKey, USER_LIMIT, USER_WINDOW_MS);
  if (!userLimit.ok) {
    return NextResponse.json(
      { error: "Забагато спроб для цього користувача, зачекай." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(userLimit.reset_ms / 1000)),
        },
      },
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend ще не налаштовано" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc("verify_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) {
    // Never echo DB error text to the client.
    console.error("verify_pin rpc error", { code: error.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }
  const user = (data ?? null) as UserRow | null;
  if (!user || !user.id) {
    await logAudit("auth.login.failure", {
      targetUserId: userId,
      targetType: "user",
      ip,
      userAgent: uaFromRequest(req),
      meta: { ip_attempts_remaining: ipLimit.remaining },
    });
    return NextResponse.json({ error: "Невірний PIN" }, { status: 401 });
  }

  const token = await signSession({
    uid: user.id,
    full_name: user.full_name,
    role: user.role,
    store_id: user.store_id ?? null,
    iat: Date.now(),
  });

  await logAudit("auth.login.success", {
    actorUserId: user.id,
    targetType: "session",
    ip,
    userAgent: uaFromRequest(req),
    meta: { role: user.role, store_id: user.store_id },
  });

  const res = NextResponse.json({
    ok: true,
    user: {
      full_name: user.full_name,
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
