import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import {
  signSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/session";

export const runtime = "nodejs";

interface UserRow {
  id: string;
  full_name: string;
  role: "seller" | "admin";
  store_id: number | null;
}

/**
 * POST /api/auth/login   { pin: "1234" }
 * Verifies PIN via the SQL function `feedbackgb.verify_pin(pin)`. On success
 * sets an httpOnly session cookie and returns the user payload.
 */
export async function POST(req: Request) {
  let body: { pin?: string };
  try {
    body = (await req.json()) as { pin?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pin = (body.pin ?? "").trim();
  if (!/^\d{4,6}$/.test(pin)) {
    return NextResponse.json({ error: "Невірний формат PIN" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend ще не налаштовано" },
      { status: 503 },
    );
  }

  const { data, error } = await supabase.rpc("verify_pin", { p_pin: pin });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const user = (data ?? null) as UserRow | null;
  if (!user || !user.id) {
    return NextResponse.json({ error: "Невірний PIN" }, { status: 401 });
  }

  const token = await signSession({
    uid: user.id,
    full_name: user.full_name,
    role: user.role,
    store_id: user.store_id ?? null,
    iat: Date.now(),
  });

  const res = NextResponse.json({
    ok: true,
    user: {
      full_name: user.full_name,
      role: user.role,
      store_id: user.store_id,
    },
  });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
