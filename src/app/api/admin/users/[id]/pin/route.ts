import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\d{6,8}$/;

/**
 * POST /api/admin/users/<uuid>/pin   { pin: "123456" }
 * Admin-only. Sets a fresh PIN for the target user via
 * feedbackgb.set_user_pin(uuid, text). The new PIN must be 6-8 digits.
 * The DB function also clears failed_attempts + locked_until atomically.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userId = params.id;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  let body: { pin?: string };
  try {
    body = (await req.json()) as { pin?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pin = (body.pin ?? "").trim();
  if (!PIN_RE.test(pin)) {
    return NextResponse.json(
      { error: "PIN має бути 6–8 цифр" },
      { status: 400 },
    );
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend ще не налаштовано" },
      { status: 503 },
    );
  }

  const { error } = await supabase.rpc("set_user_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) {
    console.error("set_user_pin rpc error", { code: error.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }

  await logAudit("admin.user.pin_reset", {
    actorUserId: sess.uid,
    targetUserId: userId,
    targetType: "user",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
  });

  return NextResponse.json({ ok: true });
}
