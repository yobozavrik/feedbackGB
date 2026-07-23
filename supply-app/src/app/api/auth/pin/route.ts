import { NextResponse } from "next/server";
import { writeLoginAudit } from "@/lib/audit";
import { limitLogin, pinBucket, requestIp } from "@/lib/loginRateLimit";
import { getServerSupabase } from "@/lib/supabase";
import { signSupplySession, SUPPLY_SESSION_COOKIE, SUPPLY_SESSION_MAX_AGE, type SupplyRole } from "@/lib/session";

export const runtime = "nodejs";

const WINDOW_MS = 10 * 60_000;
const LIMIT = 10;
function denied(status = 401) {
  return NextResponse.json({ error: "Вхід недоступний." }, { status });
}

export async function POST(request: Request) {
  let body: { pin?: unknown };
  try {
    body = await request.json() as { pin?: unknown };
  } catch {
    return denied(400);
  }

  const pin = typeof body.pin === "string" ? body.pin.trim() : "";
  if (!/^\d{6}$/.test(pin)) return denied(400);

  try {
    const [ip, credential] = await Promise.all([
      limitLogin(`supply:ip:${requestIp(request)}`, LIMIT, WINDOW_MS),
      limitLogin(pinBucket(pin), LIMIT, WINDOW_MS),
    ]);
    if (!ip.ok || !credential.ok) {
      return NextResponse.json(
        { error: "Вхід недоступний." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(Math.max(ip.resetMs, credential.resetMs) / 1000)) } },
      );
    }
  } catch {
    return NextResponse.json({ error: "Сервіс входу тимчасово недоступний." }, { status: 503 });
  }

  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Сервіс входу тимчасово недоступний." }, { status: 503 });
  const { data, error } = await supabase.rpc("verify_pin_for_app", {
    p_pin: pin,
    p_app_key: "supply_app",
  });
  if (error) {
    console.error("[supply-auth] verify_pin_for_app failed", { code: error.code });
    return NextResponse.json({ error: "Сервіс входу тимчасово недоступний." }, { status: 503 });
  }

  const user = data as {
    id?: string;
    full_name?: string;
    display_label?: string | null;
    role?: SupplyRole;
    facility_id?: string | null;
  } | null;
  if (!user?.id || !user.full_name || !user.role || !["supply_worker", "admin", "super_admin"].includes(user.role)) {
    await writeLoginAudit("auth.login.failure", request);
    return denied();
  }

  await writeLoginAudit("auth.login.success", request, user.id);
  const token = await signSupplySession({
    uid: user.id,
    full_name: user.display_label ?? user.full_name,
    role: user.role,
    facility_id: user.facility_id ?? null,
    iat: Date.now(),
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SUPPLY_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SUPPLY_SESSION_MAX_AGE,
  });
  return response;
}
