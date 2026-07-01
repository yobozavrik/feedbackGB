import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Недійсний UUID" }, { status: 400 });
  }

  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // 1. Fetch target user's role from DB (Database-first RBAC)
  const { data: targetUser, error: userErr } = await supabase
    .from("users")
    .select("role")
    .eq("id", id)
    .maybeSingle();

  if (userErr) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!targetUser) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // 2. Admin cannot view activity of other admins or super_admins
  if (sess.role === "admin" && (targetUser.role === "admin" || targetUser.role === "super_admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // 3. Fetch latest 100 audit log entries where this user was the actor
  const { data: logs, error: logsErr } = await supabase
    .from("v_audit_log")
    .select("occurred_at, action_title, ip, user_agent, meta, diff")
    .eq("actor_user_id", id)
    .order("occurred_at", { ascending: false })
    .limit(100);

  if (logsErr) {
    console.error("[users.id.activity] fetch logs error", { code: logsErr.code });
    return NextResponse.json({ error: "failed to fetch activity log" }, { status: 500 });
  }

  return NextResponse.json({ logs: logs || [] });
}
