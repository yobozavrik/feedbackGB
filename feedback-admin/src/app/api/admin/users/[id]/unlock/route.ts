import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, isAdminTier, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/<uuid>/unlock
 * Admin-only. Clears the lockout state (failed_attempts, locked_until) for a
 * user that triggered the 10-failed-attempt lockout in verify_pin.
 * Does NOT change the PIN.
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
  if (!isUuid(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
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

  // RBAC check: ordinary admin can only unlock sellers
  if (sess.role === "admin" && targetUser.role !== "seller") {
    return NextResponse.json({ error: "forbidden: admin can only unlock sellers" }, { status: 403 });
  }

  const { error } = await supabase
    .from("users")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("id", userId);

  if (error) {
    console.error("unlock user error", { code: error.code });
    return NextResponse.json({ error: "Помилка сервера" }, { status: 500 });
  }

  await logAudit("admin.user.unlock", {
    actorUserId: sess.uid,
    targetUserId: userId,
    targetType: "user",
    ip: ipFromRequest(req),
    userAgent: uaFromRequest(req),
  });

  return NextResponse.json({ ok: true });
}
