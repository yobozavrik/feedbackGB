import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { markAllNotificationsRead } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/notifications/read-all
 * Admin-only. Marks all of the current admin's unread notifications as read.
 */
export async function POST() {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  await markAllNotificationsRead(supabase, sess.uid);
  return NextResponse.json({ ok: true });
}
