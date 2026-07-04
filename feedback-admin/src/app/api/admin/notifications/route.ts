import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase";
import { requireAdminSession } from "@/lib/adminAuth";
import { listNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications?unread=1&limit=50
 * Admin-only. Returns the current admin's own notifications (bell dropdown).
 */
export async function GET(req: Request) {
  const sess = await requireAdminSession();
  if (!sess) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "1";
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 50;

  const { notifications, unreadCount } = await listNotifications(supabase, {
    recipientUserId: sess.uid,
    unreadOnly,
    limit,
  });

  return NextResponse.json({ notifications, unread_count: unreadCount });
}
