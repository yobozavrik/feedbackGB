import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_RE = /^\d{6}$/;

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
  if (!sess || !isAdminTier(sess.role)) {
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
      { error: "PIN має бути ровно 6 цифр" },
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

  // Fetch target user to check existence and role
  const { data: targetUser, error: targetErr } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (targetErr) {
    console.error("error fetching target user", targetErr);
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }

  if (!targetUser) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // RBAC check: ordinary admin can only modify sellers or themselves
  if (sess.role === "admin" && sess.uid !== userId && targetUser.role !== "seller") {
    return NextResponse.json({ error: "forbidden: admin can only reset pin for sellers" }, { status: 403 });
  }

  const { error } = await supabase.rpc("set_user_pin", {
    p_user_id: userId,
    p_pin: pin,
  });
  if (error) {
    console.error("set_user_pin rpc error", { code: error.code, message: error.message });
    if (error.code === "P0001" || error.code === "23505") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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
