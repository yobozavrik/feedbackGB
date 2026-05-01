import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { ipFromRequest, logAudit, uaFromRequest } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!sess || sess.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userId = params.id;
  if (!UUID_RE.test(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Backend ще не налаштовано" },
      { status: 503 },
    );
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
